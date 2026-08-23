/**
 * Test fixtures.
 *
 * These generate REAL video files with the real FFmpeg binary using lavfi
 * synthetic sources. They are genuine encoded MP4s, not placeholders — the
 * point is to exercise the actual pipeline end to end.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFfmpeg } from '../../server/media/ffmpeg-runner.ts';

export function makeTempDir(prefix = 'clipforge-test-'): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** Create a real landscape MP4 with an audio track. */
export async function createSourceWithAudio(
  dir: string,
  name = 'source-audio.mp4',
  seconds = 6,
  size = '1280x720',
): Promise<string> {
  const out = path.join(dir, name);
  await runFfmpeg([
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-shortest',
    out,
  ]);
  return out;
}

/** Create a real MP4 with NO audio stream. */
export async function createSilentSource(
  dir: string,
  name = 'source-silent.mp4',
  seconds = 5,
): Promise<string> {
  const out = path.join(dir, name);
  await runFfmpeg([
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', `testsrc=size=640x480:rate=25:duration=${seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-an',
    out,
  ]);
  return out;
}
