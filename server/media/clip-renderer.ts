/**
 * Real clip rendering with the verified imageio-ffmpeg binary.
 *
 * What this module actually does (no simulation, no placeholders):
 *   - cuts a real time segment out of the source file
 *   - optionally reframes to a real vertical 9:16 canvas using scale + pad
 *   - re-encodes video with libx264 and audio with AAC
 *   - preserves audio when (and only when) the source has an audio stream
 *   - writes to a temp file and atomically renames on success, so a failed or
 *     killed render never leaves a half-written file presented as a result
 */
import { rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg, FfmpegExecutionError } from './ffmpeg-runner.ts';
import { inspectMedia, type MediaInfo } from './inspect.ts';

export type AspectMode = 'vertical' | 'source';

export interface RenderClipOptions {
  inputPath: string;
  outputPath: string;
  /** Segment start in seconds (>= 0). */
  startSeconds: number;
  /** Segment length in seconds (> 0). */
  durationSeconds: number;
  aspect: AspectMode;
  /** Target vertical canvas. Defaults to 1080x1920. */
  targetWidth?: number;
  targetHeight?: number;
  /** Progress callback: seconds of output encoded so far. */
  onProgress?: (encodedSeconds: number) => void;
  timeoutMs?: number;
}

export interface RenderClipResult {
  outputPath: string;
  bytes: number;
  info: MediaInfo;
  audioPreserved: boolean;
}

export class ClipRenderError extends Error {
  readonly detail: string | undefined;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'ClipRenderError';
    this.detail = detail;
  }
}

/** Parse `time=00:00:03.20` progress lines out of FFmpeg's stderr stream. */
function extractProgressSeconds(chunk: string): number | null {
  let last: number | null = null;
  for (const m of chunk.matchAll(/time=\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)) {
    last = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return last;
}

/**
 * Build the FFmpeg argv for a clip render.
 * Exported so tests can assert the filter graph without executing anything.
 */
export function buildClipArgs(opts: {
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  durationSeconds: number;
  aspect: AspectMode;
  hasAudio: boolean;
  targetWidth: number;
  targetHeight: number;
}): string[] {
  const { inputPath, outputPath, startSeconds, durationSeconds, aspect, hasAudio } = opts;
  const { targetWidth: W, targetHeight: H } = opts;

  const args: string[] = ['-hide_banner', '-nostdin', '-y'];

  // Accurate seek: -ss before -i is fast, and re-encoding makes it frame-exact.
  args.push('-ss', startSeconds.toFixed(3), '-i', inputPath, '-t', durationSeconds.toFixed(3));

  if (aspect === 'vertical') {
    // Fit the whole frame inside a 9:16 canvas, then pad with black bars.
    // force_original_aspect_ratio=decrease never crops; setsar=1 keeps square
    // pixels so the output is a true WxH raster.
    args.push(
      '-vf',
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
    );
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
  );

  if (hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  } else {
    args.push('-an');
  }

  args.push(outputPath);
  return args;
}

export async function renderClip(options: RenderClipOptions): Promise<RenderClipResult> {
  const {
    inputPath,
    outputPath,
    startSeconds,
    durationSeconds,
    aspect,
    targetWidth = 1080,
    targetHeight = 1920,
    onProgress,
    timeoutMs = 15 * 60_000,
  } = options;

  if (!Number.isFinite(startSeconds) || startSeconds < 0) {
    throw new ClipRenderError('Clip start time must be a non-negative number.');
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new ClipRenderError('Clip duration must be greater than zero.');
  }

  // Verify the source is real and readable before spending time encoding.
  const sourceInfo = await inspectMedia(inputPath);

  if (sourceInfo.durationSeconds !== null && startSeconds >= sourceInfo.durationSeconds) {
    throw new ClipRenderError(
      `Clip start (${startSeconds.toFixed(2)}s) is beyond the end of the source ` +
        `(${sourceInfo.durationSeconds.toFixed(2)}s).`,
    );
  }

  // Clamp so we never ask for more footage than exists.
  const available =
    sourceInfo.durationSeconds !== null
      ? Math.max(0, sourceInfo.durationSeconds - startSeconds)
      : durationSeconds;
  const effectiveDuration = Math.min(durationSeconds, available);
  if (effectiveDuration <= 0.05) {
    throw new ClipRenderError('The requested segment is too short to render.');
  }

  const tempPath = path.join(
    path.dirname(outputPath),
    `.tmp-${path.basename(outputPath)}`,
  );

  const args = buildClipArgs({
    inputPath,
    outputPath: tempPath,
    startSeconds,
    durationSeconds: effectiveDuration,
    aspect,
    hasAudio: sourceInfo.hasAudio,
    targetWidth,
    targetHeight,
  });

  try {
    await runFfmpeg(args, {
      timeoutMs,
      onStderr: onProgress
        ? (chunk) => {
            const t = extractProgressSeconds(chunk);
            if (t !== null) onProgress(t);
          }
        : undefined,
    });
  } catch (err) {
    await rm(tempPath, { force: true }).catch(() => {});
    if (err instanceof FfmpegExecutionError) {
      throw new ClipRenderError(
        'FFmpeg failed while rendering the clip.',
        err.stderrTail.split('\n').filter(Boolean).slice(-6).join('\n'),
      );
    }
    throw err;
  }

  // Never trust the exit code alone: verify a real, non-trivial file exists.
  let bytes: number;
  try {
    bytes = (await stat(tempPath)).size;
  } catch {
    throw new ClipRenderError('FFmpeg reported success but produced no output file.');
  }
  if (bytes < 1024) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw new ClipRenderError(`FFmpeg produced an implausibly small output file (${bytes} bytes).`);
  }

  // Verify the output is a decodable video, and capture its real dimensions.
  let info: MediaInfo;
  try {
    info = await inspectMedia(tempPath);
  } catch (err) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw new ClipRenderError(
      `The rendered file could not be verified as valid video: ${(err as Error).message}`,
    );
  }

  await rename(tempPath, outputPath);

  return {
    outputPath,
    bytes,
    info,
    audioPreserved: sourceInfo.hasAudio && info.hasAudio,
  };
}
