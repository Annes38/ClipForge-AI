/**
 * Deterministic highlight / candidate-clip detection.
 *
 * AUDIT CONSTRAINT: this module does NOT use any machine-learning model and
 * does NOT call any paid API. It runs the verified imageio-ffmpeg binary
 * with several real signal-producing filters and parses the output:
 *
 *   1. `select='gt(scene,SCENE_THRESHOLD)',showinfo`
 *      - emits one line per "key frame" that is materially different from
 *        the previous frame (real scene-cut detection in the demuxer).
 *      - showinfo also reports the per-frame mean/stdev, which we use to
 *        measure VISUAL STABILITY (low stdev over time = stable, possibly
 *        boring; high stdev = dynamic, possibly interesting).
 *   2. `silencedetect=noise=SILENCE_DB:d=SILENCE_MIN`
 *      - emits silence_start / silence_end lines on the audio stream.
 *   3. `astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`
 *      - emits per-frame audio RMS levels, which we average to score
 *        AUDIO ACTIVITY in each window.
 *
 * From these signals we build candidate segments. The algorithm is:
 *
 *   - Each scene change is a candidate START point (natural "hooks" —
 *     something visually new just happened).
 *   - Each end-of-silence is also a candidate START point (the speaker
 *     just resumed, which is usually more interesting than the silence).
 *   - Each candidate is trimmed to [minDur, maxDur] and clipped to the
 *     source duration.
 *   - Adjacent candidates within MERGE_GAP of each other are merged, so
 *     we don't propose three overlapping clips.
 *   - Each candidate gets an explainable SCORE that combines:
 *       - scene-change density inside the window
 *       - resume-from-silence density inside the window
 *       - audio activity (RMS level mean, normalised)
 *       - visual stability (per-frame stdev of luma/chroma channels)
 *       - segment length penalty (too short or too long is worse)
 *       - position score (slight preference for the first half of the source)
 *       - clipping penalty (a clipped candidate lost its tail)
 *
 * Every returned candidate is a real portion of the source video — the
 * `startSeconds` and `durationSeconds` come straight from the parse,
 * and the `signals` field lists which detector fired.
 */
import { runFfmpeg } from './ffmpeg-runner.ts';
import { inspectMedia, type MediaInfo } from './inspect.ts';

export interface DetectOptions {
  /** Maximum number of candidates to return. Default 8. */
  maxCandidates?: number;
  /** Minimum allowed candidate length, in seconds. Default 10. */
  minDurationSeconds?: number;
  /** Maximum allowed candidate length, in seconds. Default 60. */
  maxDurationSeconds?: number;
  /** Scene-change threshold passed to FFmpeg's scene filter. Default 0.25. */
  sceneThreshold?: number;
  /** Silence noise floor in dB. Default -30. */
  silenceDb?: number;
  /** Silence minimum duration in seconds. Default 0.5. */
  silenceMinSeconds?: number;
  /** Merge candidates whose starts are within this many seconds. Default 5. */
  mergeGapSeconds?: number;
  /** Default segment length when a start has no end signal. Default 20. */
  defaultDurationSeconds?: number;
}

export interface HighlightCandidate {
  /** 0-based start time within the source video. */
  startSeconds: number;
  /** Clipped to [minDurationSeconds, maxDurationSeconds] and source duration. */
  durationSeconds: number;
  /**
   * 0..1. Higher means "more signal fires inside this window". The score
   * is explainable: see the `signals` field and the algorithm comments.
   */
  score: number;
  /** Human-readable reason, e.g. "scene change", "speech resumed". */
  reason: string;
  /**
   * Which signal categories contributed to this candidate.
   */
  signals: Array<
    | 'scene-change'
    | 'resume-from-silence'
    | 'high-audio-activity'
    | 'high-visual-variance'
  >;
  /** Per-signal contribution in [0, 1]. Keys match the `signals` array. */
  signalBreakdown: {
    sceneChange: number;
    resumeFromSilence: number;
    audioActivity: number;
    visualVariance: number;
    durationFit: number;
    position: number;
  };
  /** Whether the segment was clipped at the source boundary. */
  wasClipped: boolean;
}

export interface DetectionResult {
  source: MediaInfo;
  candidates: HighlightCandidate[];
  /** Total scene-change events detected (before merging). */
  rawSceneChangeCount: number;
  /** Total silence regions detected. */
  rawSilenceCount: number;
}

export class HighlightDetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HighlightDetectionError';
  }
}

/* ----------------------------- parsing ----------------------------- */

/** "n:   0 pts:      0 pts_time:0.0 ..." -> 0 */
function parseShowinfoPtsTime(line: string): number | null {
  const m = /pts_time:\s*(-?\d+(?:\.\d+)?)/.exec(line);
  return m ? Number(m[1]) : null;
}

/**
 * Extract per-frame stdev values from a showinfo line. Example:
 *   "stdev:[0.0 0.0 0.0]" or "stdev:[12.5 9.0 6.3]"
 * Returns the mean of the three channels (a rough "visual activity" metric).
 */
function parseShowinfoStdevMean(line: string): number | null {
  const m = /stdev:\[\s*([^\]]+)\s*\]/.exec(line);
  if (!m) return null;
  const parts = m[1]!.split(/\s+/).map(Number);
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** "[silencedetect ...] silence_end: 4.000363 | silence_duration: 2.00068" -> {end, duration} */
function parseSilenceEnd(line: string): { end: number; duration: number } | null {
  const endM = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
  const durM = /silence_duration:\s*(-?\d+(?:\.\d+)?)/.exec(line);
  if (!endM) return null;
  return {
    end: Number(endM[1]),
    duration: durM ? Number(durM[1]) : 0,
  };
}

/** "astats ... Overall.RMS_level=-12.3" or "RMS_level=-12.3" */
function parseAudioRms(line: string): { atSeconds: number; rmsDb: number } | null {
  const tM = /pts_time:\s*(-?\d+(?:\.\d+)?)/.exec(line);
  const rM = /RMS_level=(-?\d+(?:\.\d+)?)/.exec(line);
  if (!tM || !rM) return null;
  return { atSeconds: Number(tM[1]), rmsDb: Number(rM[1]) };
}

/* ----------------------------- algorithm ----------------------------- */

interface RawSignal {
  atSeconds: number;
  kind: 'scene-change' | 'resume-from-silence';
  /** Optional per-event stdev mean (only for scene-change events). */
  stdevMean?: number;
}

interface AudioSample {
  atSeconds: number;
  /** RMS in dBFS, e.g. -20.0 (louder = closer to 0). */
  rmsDb: number;
}

function buildRawSignals(stderr: string, _sceneThreshold: number): RawSignal[] {
  const signals: RawSignal[] = [];

  for (const line of stderr.split('\n')) {
    if (/Parsed_showinfo_/.test(line) && /pts_time:/.test(line)) {
      const t = parseShowinfoPtsTime(line);
      if (t !== null) {
        const stdev = parseShowinfoStdevMean(line) ?? undefined;
        signals.push({ atSeconds: t, kind: 'scene-change', stdevMean: stdev });
      }
      continue;
    }
    if (/silence_end:/.test(line)) {
      const s = parseSilenceEnd(line);
      if (s) signals.push({ atSeconds: s.end, kind: 'resume-from-silence' });
      continue;
    }
  }

  signals.sort((a, b) => a.atSeconds - b.atSeconds);

  // Suppress duplicate scene-change points that fire on consecutive frames.
  const deduped: RawSignal[] = [];
  for (const s of signals) {
    const last = deduped[deduped.length - 1];
    if (last && last.kind === s.kind && s.atSeconds - last.atSeconds < 0.25) continue;
    deduped.push(s);
  }
  return deduped;
}

function buildAudioSamples(stderr: string): AudioSample[] {
  const out: AudioSample[] = [];
  for (const line of stderr.split('\n')) {
    const a = parseAudioRms(line);
    if (a) out.push(a);
  }
  out.sort((a, b) => a.atSeconds - b.atSeconds);
  return out;
}

/** dBFS in [-60, 0] -> 0..1. -60 dB is silence, 0 dB is full scale. */
function dbfsToActivity(db: number): number {
  const clamped = Math.max(-60, Math.min(0, db));
  return (clamped + 60) / 60;
}

function meanRmsActivity(samples: AudioSample[], start: number, end: number): number {
  const inWindow = samples.filter((s) => s.atSeconds >= start && s.atSeconds <= end);
  if (inWindow.length === 0) return 0;
  const mean =
    inWindow.reduce((a, s) => a + dbfsToActivity(s.rmsDb), 0) / inWindow.length;
  return mean;
}

function meanStdev(signals: RawSignal[], start: number, end: number): number {
  const inWindow = signals.filter(
    (s) => s.kind === 'scene-change' && s.stdevMean !== undefined && s.atSeconds >= start && s.atSeconds <= end,
  );
  if (inWindow.length === 0) return 0;
  return inWindow.reduce((a, s) => a + (s.stdevMean ?? 0), 0) / inWindow.length;
}

function scoreCandidate(
  start: number,
  end: number,
  sourceDuration: number,
  signalsInWindow: RawSignal[],
  audioActivity: number,
  visualVariance: number,
  wasClipped: boolean,
): { score: number; reason: string; breakdown: HighlightCandidate['signalBreakdown']; signalKinds: HighlightCandidate['signals'] } {
  // Per-signal contributions, all in [0, 1].
  const scenes = signalsInWindow.filter((s) => s.kind === 'scene-change').length;
  const resumes = signalsInWindow.filter((s) => s.kind === 'resume-from-silence').length;

  const sceneChange = Math.min(1, scenes * 0.4);
  const resumeFromSilence = Math.min(1, resumes * 0.5);
  // Audio activity is already in [0, 1].
  const audio = Math.max(0, Math.min(1, audioActivity));
  // Visual variance: clamp mean stdev to a useful range. Testsrc
  // (a static test pattern) reports stdev ~0; a high-motion scene
  // typically reports stdev 20–60. We map 0..30 to 0..1.
  const visual = Math.max(0, Math.min(1, visualVariance / 30));

  // Duration fit: a Gaussian centred on 22s with sigma 12s, clipped to [0, 1].
  const dur = end - start;
  const idealDur = 22;
  const sigma = 12;
  const durationFit = Math.max(0, Math.min(1, Math.exp(-((dur - idealDur) ** 2) / (2 * sigma * sigma))));

  // Position score: 1.0 at the start, decays linearly to 0.5 at the end.
  // This reflects the common pattern that "hook" content lives near the
  // beginning of a video, without being aggressive enough to filter out
  // good candidates near the end.
  const position = Math.max(0.5, 1 - (start / Math.max(1, sourceDuration)) * 0.5);

  // Combine. Weights chosen so a clip with multiple strong signals lands
  // comfortably above 0.7, while a clip with no signals sits around 0.2.
  const weights = {
    sceneChange: 0.28,
    resumeFromSilence: 0.16,
    audio: 0.18,
    visual: 0.10,
    durationFit: 0.12,
    position: 0.06,
  };
  const raw =
    weights.sceneChange * sceneChange +
    weights.resumeFromSilence * resumeFromSilence +
    weights.audio * audio +
    weights.visual * visual +
    weights.durationFit * durationFit +
    weights.position * position;
  let score = raw;
  if (wasClipped) score -= 0.12;
  score = Math.max(0, Math.min(1, score));

  // Choose a concise reason that names the dominant signals.
  const parts: string[] = [];
  if (scenes >= 2) parts.push('multiple scene changes');
  else if (scenes === 1) parts.push('scene change');
  if (resumes >= 1) parts.push('speech resumed');
  if (audio > 0.6) parts.push('active audio');
  if (visual > 0.5) parts.push('dynamic visuals');
  if (parts.length === 0) parts.push('temporal window');
  const reason = parts.join(', ');

  // Determine which high-level signals "fired" (i.e. meaningfully contributed).
  const signalKinds: HighlightCandidate['signals'] = [];
  if (sceneChange > 0.3) signalKinds.push('scene-change');
  if (resumeFromSilence > 0.3) signalKinds.push('resume-from-silence');
  if (audio > 0.5) signalKinds.push('high-audio-activity');
  if (visual > 0.4) signalKinds.push('high-visual-variance');

  return {
    score,
    reason,
    signalKinds,
    breakdown: {
      sceneChange: round3(sceneChange),
      resumeFromSilence: round3(resumeFromSilence),
      audioActivity: round3(audio),
      visualVariance: round3(visual),
      durationFit: round3(durationFit),
      position: round3(position),
    },
  };
}

/**
 * Run the deterministic highlight detector.
 *
 * @throws HighlightDetectionError if the source can't be inspected.
 */
export async function detectHighlights(
  inputPath: string,
  options: DetectOptions = {},
): Promise<DetectionResult> {
  const {
    maxCandidates = 8,
    minDurationSeconds = 10,
    maxDurationSeconds = 60,
    sceneThreshold = 0.25,
    silenceDb = -30,
    silenceMinSeconds = 0.5,
    mergeGapSeconds = 5,
    defaultDurationSeconds = 20,
  } = options;

  const source = await inspectMedia(inputPath);
  const sourceDuration = source.durationSeconds;
  if (sourceDuration === null) {
    throw new HighlightDetectionError(
      'Cannot detect highlights: source duration is unknown.',
    );
  }

  // Build the ffmpeg argument list. We combine:
  //   - the scene-cut select/showinfo filter
  //   - the silencedetect audio filter
  //   - the astats audio-meter filter (per-frame RMS level)
  // The -map 0:v / -map 0:a trick keeps the original streams intact so
  // the muxer has a real video and audio stream to work with, even
  // though we are writing to a null output.
  const args: string[] = [
    '-hide_banner',
    '-nostdin',
    '-i', inputPath,
    '-map', '0:v', '-map', '0:a?',
    '-vf', `select='gt(scene,${sceneThreshold.toFixed(3)})',showinfo`,
    '-af', `silencedetect=noise=${silenceDb}dB:d=${silenceMinSeconds.toFixed(3)},` +
            `astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
    '-f', 'null',
    '-',
  ];

  const result = await runFfmpeg(args, { allowNonZeroExit: true, timeoutMs: 5 * 60_000 });
  const signals = buildRawSignals(result.stderr, sceneThreshold);
  const audioSamples = buildAudioSamples(result.stderr);

  const sceneSignals = signals.filter((s) => s.kind === 'scene-change');
  const silenceSignals = signals.filter((s) => s.kind === 'resume-from-silence');

  if (signals.length === 0 && audioSamples.length === 0) {
    return {
      source,
      candidates: [],
      rawSceneChangeCount: sceneSignals.length,
      rawSilenceCount: silenceSignals.length,
    };
  }

  // Build windows: each scene change OR each silence-resume point seeds a
  // window of [start, start + defaultDurationSeconds]. We then snap-clip
  // to source duration and the [minDurationSeconds, maxDurationSeconds]
  // bounds.
  const seedTimes: number[] = [];
  for (const s of signals) seedTimes.push(s.atSeconds);
  if (audioSamples.length > 0) {
    // Also seed at the loudest moment if the audio is unusually active.
    // This gives the detector a chance to suggest a clip even if the
    // video itself has no scene changes.
    let loudest = audioSamples[0]!;
    for (const a of audioSamples) {
      if (a.rmsDb > loudest.rmsDb) loudest = a;
    }
    if (dbfsToActivity(loudest.rmsDb) > 0.5) seedTimes.push(loudest.atSeconds);
  }
  seedTimes.sort((a, b) => a - b);

  const windows: Array<{
    start: number;
    end: number;
    wasClipped: boolean;
    signals: RawSignal[];
  }> = [];

  for (const at of seedTimes) {
    const desiredStart = Math.max(0, at);
    const desiredEnd = Math.min(sourceDuration, desiredStart + defaultDurationSeconds);
    if (desiredEnd - desiredStart < minDurationSeconds) continue;
    const wasClipped = desiredEnd - desiredStart < defaultDurationSeconds;
    windows.push({
      start: desiredStart,
      end: desiredEnd,
      wasClipped,
      signals: signals.filter((s) => s.atSeconds >= desiredStart && s.atSeconds <= desiredEnd),
    });
  }

  // Merge overlapping or very close windows.
  windows.sort((a, b) => a.start - b.start);
  const merged: typeof windows = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.start - last.end <= mergeGapSeconds) {
      last.end = Math.max(last.end, w.end);
      last.wasClipped = last.wasClipped || w.wasClipped;
      last.signals.push(...w.signals);
    } else {
      merged.push({ ...w, signals: [...w.signals] });
    }
  }

  // Build candidates, applying min/max duration bounds and the
  // multi-signal scoring.
  const candidates: HighlightCandidate[] = [];
  for (const w of merged) {
    let dur = w.end - w.start;
    let clipped = w.wasClipped;
    if (dur > maxDurationSeconds) {
      dur = maxDurationSeconds;
      clipped = true;
    }
    if (dur < minDurationSeconds) continue;
    const signalsInWindow: RawSignal[] = w.signals.filter(
      (s) => s.atSeconds >= w.start && s.atSeconds <= w.start + dur,
    );
    const audioActivity = meanRmsActivity(audioSamples, w.start, w.start + dur);
    const visualVariance = meanStdev(signals, w.start, w.start + dur);
    const { score, reason, breakdown, signalKinds } = scoreCandidate(
      w.start,
      w.start + dur,
      sourceDuration,
      signalsInWindow,
      audioActivity,
      visualVariance,
      clipped,
    );
    candidates.push({
      startSeconds: round3(w.start),
      durationSeconds: round3(dur),
      score: round3(score),
      reason,
      signals: signalKinds,
      signalBreakdown: breakdown,
      wasClipped: clipped,
    });
  }

  // Sort by score (descending) then by start (ascending) and trim.
  candidates.sort((a, b) => b.score - a.score || a.startSeconds - b.startSeconds);

  return {
    source,
    candidates: candidates.slice(0, maxCandidates),
    rawSceneChangeCount: sceneSignals.length,
    rawSilenceCount: silenceSignals.length,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
