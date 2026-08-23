/**
 * Media inspection WITHOUT ffprobe.
 *
 * AUDIT CONSTRAINT: `ffprobe` is not installed on this system, and the
 * `imageio-ffmpeg` package ships ONLY the `ffmpeg` binary (verified: its
 * binaries/ directory contains a single ffmpeg-* executable). We therefore
 * derive media metadata by parsing the stream banner FFmpeg writes to stderr
 * when asked to open a file with no output.
 *
 * `ffmpeg -i <file>` exits non-zero ("At least one output file must be
 * specified") even on a perfectly valid file, so we allow a non-zero exit and
 * decide success by whether an Input/Stream banner was actually produced.
 *
 * This is real parsed metadata from the real demuxer. Any field we cannot
 * determine is reported as `null` rather than guessed.
 */
import { runFfmpeg } from './ffmpeg-runner.ts';

export interface MediaInfo {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  formatName: string | null;
  frameRate: number | null;
}

export class MediaInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaInspectionError';
  }
}

/** "00:01:23.45" -> 83.45 */
export function parseDuration(text: string): number | null {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  const [, h, min, s] = m;
  const value = Number(h) * 3600 + Number(min) * 60 + Number(s);
  return Number.isFinite(value) ? value : null;
}

/**
 * Extract WxH from a video stream line, skipping the SAR/DAR ratio fragments
 * (e.g. "1280x720 [SAR 1:1 DAR 16:9]").
 */
export function parseResolution(streamLine: string): { width: number; height: number } | null {
  const cleaned = streamLine.replace(/\[[^\]]*\]/g, ' ');
  const matches = [...cleaned.matchAll(/\b(\d{2,5})x(\d{2,5})\b/g)];
  if (matches.length === 0) return null;
  const [, w, h] = matches[0]!;
  const width = Number(w);
  const height = Number(h);
  if (!width || !height) return null;
  return { width, height };
}

export function parseFrameRate(streamLine: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*fps\b/.exec(streamLine);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Parse the full `ffmpeg -i` banner. Exported for unit testing. */
export function parseFfmpegBanner(stderr: string): MediaInfo {
  const lines = stderr.split(/\r?\n/);

  const videoLine = lines.find((l) => /^\s*Stream #.*:\s*Video:/.test(l)) ?? null;
  const audioLine = lines.find((l) => /^\s*Stream #.*:\s*Audio:/.test(l)) ?? null;

  const resolution = videoLine ? parseResolution(videoLine) : null;

  const formatMatch = /Input #0,\s*([^,]+(?:,[^,]+)*?),\s*from/.exec(stderr);

  return {
    durationSeconds: parseDuration(stderr),
    width: resolution?.width ?? null,
    height: resolution?.height ?? null,
    hasVideo: videoLine !== null,
    hasAudio: audioLine !== null,
    videoCodec: videoLine ? (/Video:\s*([A-Za-z0-9_.-]+)/.exec(videoLine)?.[1] ?? null) : null,
    audioCodec: audioLine ? (/Audio:\s*([A-Za-z0-9_.-]+)/.exec(audioLine)?.[1] ?? null) : null,
    formatName: formatMatch?.[1]?.trim() ?? null,
    frameRate: videoLine ? parseFrameRate(videoLine) : null,
  };
}

/** Inspect a media file on disk. Throws MediaInspectionError for undecodable input. */
export async function inspectMedia(filePath: string): Promise<MediaInfo> {
  const { stderr } = await runFfmpeg(['-hide_banner', '-i', filePath], {
    allowNonZeroExit: true,
    timeoutMs: 60_000,
  });

  if (!/Input #0,/.test(stderr)) {
    const reason =
      /Invalid data found when processing input/.test(stderr)
        ? 'the file is not a readable media container'
        : /No such file or directory/.test(stderr)
          ? 'the file does not exist'
          : 'FFmpeg could not open it';
    throw new MediaInspectionError(`Could not inspect media: ${reason}.`);
  }

  const info = parseFfmpegBanner(stderr);
  if (!info.hasVideo) {
    throw new MediaInspectionError('The uploaded file contains no video stream.');
  }
  return info;
}
