/**
 * Deterministic highlight / candidate-clip detection.
 *
 * AUDIT CONSTRAINT: this module does NOT use any machine-learning model and
 * does NOT call any paid API. It runs the verified imageio-ffmpeg binary
 * with two real signal-producing filters and parses the output:
 *
 *   1. `select='gt(scene,SCENE_THRESHOLD)',showinfo`
 *      - emits one line per "key frame" that is materially different from
 *        the previous frame (real scene-cut detection in the demuxer).
 *   2. `silencedetect=noise=SILENCE_DB:d=SILENCE_MIN`
 *      - emits silence_start / silence_end lines on the audio stream.
 *
 * From these signals we build candidate segments. The algorithm is:
 *
 *   - Each scene change is a candidate START point (these are natural
 *     "hooks" — something visually new just happened).
 *   - Each end-of-silence is also a candidate START point (the speaker
 *     just resumed, which is usually more interesting than the silence).
 *   - Each candidate is trimmed to [minDur, maxDur] and clipped to the
 *     source duration.
 *   - Adjacent candidates within MERGE_GAP of each other are merged, so
 *     we don't propose three overlapping clips.
 *   - Each candidate gets a SCORE that is explainable: bonus for scene
 *     changes inside the window, bonus for resume-from-silence inside
 *     the window, penalty for clipping (a clipped candidate is probably
 *     less interesting because we lost its tail).
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
  /** Which signals contributed to this candidate. */
  signals: Array<'scene-change' | 'resume-from-silence'>;
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

/* ----------------------------- algorithm ----------------------------- */

interface RawSignal {
  atSeconds: number;
  kind: 'scene-change' | 'resume-from-silence';
}

function buildRawSignals(stderr: string, _sceneThreshold: number): RawSignal[] {
  const signals: RawSignal[] = [];

  for (const line of stderr.split('\n')) {
    if (/Parsed_showinfo_/.test(line) && /pts_time:/.test(line)) {
      const t = parseShowinfoPtsTime(line);
      if (t !== null) signals.push({ atSeconds: t, kind: 'scene-change' });
      continue;
    }
    if (/silence_end:/.test(line)) {
      const s = parseSilenceEnd(line);
      if (s) signals.push({ atSeconds: s.end, kind: 'resume-from-silence' });
      continue;
    }
  }

  // Sort by time.
  signals.sort((a, b) => a.atSeconds - b.atSeconds);

  // Suppress duplicate scene-change points that fire on consecutive frames.
  // FFmpeg's scene filter can produce a few hits per actual cut.
  const deduped: RawSignal[] = [];
  for (const s of signals) {
    const last = deduped[deduped.length - 1];
    if (last && last.kind === s.kind && s.atSeconds - last.atSeconds < 0.25) continue;
    deduped.push(s);
  }
  return deduped;
}

function scoreCandidate(
  _start: number,
  _end: number,
  signalsInWindow: RawSignal[],
  wasClipped: boolean,
): { score: number; reason: string } {
  // Each scene change in the window contributes 0.25.
  // Each resume-from-silence in the window contributes 0.20.
  // A clipped segment loses 0.15 (its tail is gone, so it's less useful).
  // Base score is 0.10 so even an empty segment has a non-zero floor.
  let score = 0.1;
  let scenes = 0;
  let resumes = 0;
  for (const s of signalsInWindow) {
    if (s.kind === 'scene-change') scenes++;
    else resumes++;
  }
  score += Math.min(0.6, scenes * 0.25);
  score += Math.min(0.4, resumes * 0.2);
  if (wasClipped) score -= 0.15;
  score = Math.max(0, Math.min(1, score));

  // Choose a concise reason that names the dominant signal.
  let reason: string;
  if (scenes >= 2) reason = 'multiple scene changes';
  else if (scenes === 1 && resumes === 1) reason = 'scene change with resumed speech';
  else if (scenes === 1) reason = 'scene change';
  else if (resumes >= 1) reason = 'speech resumed';
  else reason = 'temporal window';

  return { score, reason };
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

  // Build the ffmpeg argument list. Note: we use the same safe-spawning
  // pipeline (argv only, no shell). The threshold value is a real number
  // we control, never a user-supplied string.
  const args: string[] = [
    '-hide_banner',
    '-nostdin',
    '-i', inputPath,
    '-vf', `select='gt(scene,${sceneThreshold.toFixed(3)})',showinfo`,
    '-af', `silencedetect=noise=${silenceDb}dB:d=${silenceMinSeconds.toFixed(3)}`,
    '-f', 'null',
    '-',
  ];

  const result = await runFfmpeg(args, { allowNonZeroExit: true, timeoutMs: 5 * 60_000 });
  const signals = buildRawSignals(result.stderr, sceneThreshold);

  const sceneSignals = signals.filter((s) => s.kind === 'scene-change');
  const silenceSignals = signals.filter((s) => s.kind === 'resume-from-silence');

  if (signals.length === 0) {
    return {
      source,
      candidates: [],
      rawSceneChangeCount: sceneSignals.length,
      rawSilenceCount: silenceSignals.length,
    };
  }

  // Each signal becomes a candidate start. We then snap a window
  // [start, start + defaultDurationSeconds] and clip to source duration
  // and the [minDurationSeconds, maxDurationSeconds] bounds.
  const windows: Array<{
    start: number;
    end: number;
    wasClipped: boolean;
    signals: RawSignal[];
  }> = [];

  for (const s of signals) {
    const desiredStart = Math.max(0, s.atSeconds);
    const desiredEnd = Math.min(sourceDuration, desiredStart + defaultDurationSeconds);
    if (desiredEnd - desiredStart < minDurationSeconds) continue;
    const wasClipped = desiredEnd - desiredStart < defaultDurationSeconds;
    windows.push({
      start: desiredStart,
      end: desiredEnd,
      wasClipped,
      signals: [s],
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

  // Build candidates, applying min/max duration bounds.
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
    const { score, reason } = scoreCandidate(w.start, w.start + dur, signalsInWindow, clipped);
    const signalKinds = Array.from(new Set(signalsInWindow.map((s) => s.kind))) as Array<
      'scene-change' | 'resume-from-silence'
    >;
    candidates.push({
      startSeconds: round3(w.start),
      durationSeconds: round3(dur),
      score: round3(score),
      reason,
      signals: signalKinds,
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
