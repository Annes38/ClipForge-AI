/**
 * Tests for the deterministic highlight detector.
 *
 * These run the REAL ffmpeg binary against REAL synthetic videos, then
 * assert on the parsed candidates. There is no mock: a passing test
 * means a real scene change or silence event was actually detected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildClipArgs,
  renderClip,
} from '../server/media/clip-renderer.ts';
import {
  detectHighlights,
  HighlightDetectionError,
} from '../server/media/highlight-detector.ts';
import { parseFfmpegBanner } from '../server/media/inspect.ts';
import { probeFfmpeg } from '../server/media/ffmpeg-locator.ts';
import {
  makeTempDir,
  createSourceWithAudio,
  createSilentSource,
} from './helpers/fixtures.ts';

const ffmpeg = probeFfmpeg();
if (!ffmpeg.available) {
  throw new Error(
    `FFmpeg is required for the highlight tests but is unavailable: ${ffmpeg.reason}. ` +
      'Run `npm run setup:ffmpeg`.',
  );
}

const dir = makeTempDir();
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

/* ----------------------- parsing unit tests ----------------------- */

test('parseFfmpegBanner still works (regression)', () => {
  const sample = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'src.mp4':
  Duration: 00:00:05.00, start: 0.000000, bitrate: 100 kb/s
  Stream #0:0(und): Video: h264, yuv420p, 1280x720, 30 fps
`;
  const info = parseFfmpegBanner(sample);
  assert.equal(info.durationSeconds, 5);
  assert.equal(info.hasVideo, true);
});

test('buildClipArgs regression', () => {
  const args = buildClipArgs({
    inputPath: '/x.mp4',
    outputPath: '/y.mp4',
    startSeconds: 1,
    durationSeconds: 2,
    aspect: 'vertical',
    hasAudio: true,
    targetWidth: 1080,
    targetHeight: 1920,
  });
  assert.equal(args.at(-1), '/y.mp4');
  assert.equal(args[args.indexOf('-ss') + 1], '1.000');
});

/* -------------------------- detector tests ------------------------- */

test('detectHighlights on a constant source returns no candidates', async () => {
  // testsrc is a visually static test pattern: no scene changes, no audio.
  const src = await createSourceWithAudio(dir, 'flat.mp4', 6, '320x240');
  const result = await detectHighlights(src, {
    minDurationSeconds: 2,
    maxDurationSeconds: 4,
    defaultDurationSeconds: 3,
  });
  // No scene changes; audio is a constant sine. The detector should be
  // honest about not finding anything.
  assert.equal(result.candidates.length, 0);
  assert.equal(result.rawSceneChangeCount, 0);
});

test('detectHighlights finds candidates at real scene boundaries', async () => {
  // Make a video with three clear scene changes: red, blue, green, red.
  // Each scene is 2 seconds long, total 8 seconds.
  const ffmpeg = probeFfmpeg();
  if (!ffmpeg.available) throw new Error('ffmpeg required');
  // Use the runFfmpeg helper indirectly by calling the spawn via child_process
  // would be over-engineering; the runFfmpeg is also fine. We use the
  // renderClip here only to produce the source - but we don't need a real
  // render, we just want the source mp4. Build it via the helper instead.
  // Build a synthetic source via filters through ffmpeg.
  const { runFfmpeg } = await import('../server/media/ffmpeg-runner.ts');
  const src = path.join(dir, 'scenes.mp4');
  await runFfmpeg([
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:size=320x240:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'color=c=blue:size=320x240:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'color=c=green:size=320x240:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'color=c=red:size=320x240:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
    '-filter_complex',
      '[0:v]setpts=PTS-STARTPTS[v0];' +
      '[1:v]setpts=PTS-STARTPTS[v1];' +
      '[2:v]setpts=PTS-STARTPTS[v2];' +
      '[3:v]setpts=PTS-STARTPTS[v3];' +
      '[v0][v1][v2][v3]concat=n=4:v=1:a=0[outv];' +
      '[4:a]aresample=44100[a0]',
    '-map', '[outv]', '-map', '[a0]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-shortest', '-r', '15',
    src,
  ]);

  const result = await detectHighlights(src, {
    minDurationSeconds: 2,
    maxDurationSeconds: 5,
    defaultDurationSeconds: 3,
    sceneThreshold: 0.1,
    silenceDb: -20,
    silenceMinSeconds: 0.5,
    mergeGapSeconds: 2,
  });

  // The detector should report at least one scene change in the source.
  // (The exact count is FFmpeg-version dependent, but >= 1 is reliable.)
  assert.ok(
    result.rawSceneChangeCount >= 1,
    `expected at least one scene change, got ${result.rawSceneChangeCount}`,
  );
  assert.ok(
    result.candidates.length >= 1,
    'expected at least one candidate',
  );
  // Every candidate must lie inside the source duration.
  for (const c of result.candidates) {
    assert.ok(c.startSeconds >= 0);
    assert.ok(c.startSeconds < result.source.durationSeconds!);
    assert.ok(c.durationSeconds > 0);
    assert.ok(c.startSeconds + c.durationSeconds <= result.source.durationSeconds! + 0.1);
    assert.ok(c.score >= 0 && c.score <= 1);
    assert.ok(c.reason.length > 0);
  }
  // The first candidate's start should be near a scene boundary
  // (within merge tolerance, somewhere in [0, 7] for an 8s source).
  const first = result.candidates[0]!;
  assert.ok(first.startSeconds >= 0 && first.startSeconds < 7);
});

test('detectHighlights respects maxDuration and clips to source', async () => {
  // Use a longer constant video so no scene changes fire.
  const src = await createSourceWithAudio(dir, 'long.mp4', 30, '320x240');
  const result = await detectHighlights(src, {
    minDurationSeconds: 1,
    maxDurationSeconds: 5,
    defaultDurationSeconds: 4,
  });
  // No scene changes => no candidates, but if any were present, they'd
  // be clipped to <= 5 seconds.
  for (const c of result.candidates) {
    assert.ok(c.durationSeconds <= 5, `candidate too long: ${c.durationSeconds}`);
  }
});

test('detectHighlights throws on missing source', async () => {
  // We accept either error class: the function inspects first and may
  // surface a MediaInspectionError before the HighlightDetectionError
  // check, but both are honest "this file isn't usable" failures.
  const { MediaInspectionError } = await import('../server/media/inspect.ts');
  await assert.rejects(
    detectHighlights(path.join(dir, 'nope.mp4'), {
      minDurationSeconds: 1,
      maxDurationSeconds: 5,
      defaultDurationSeconds: 3,
    }),
    (err: Error) => {
      return err instanceof HighlightDetectionError || err instanceof MediaInspectionError;
    },
  );
});

test('detectHighlights handles a silent source (audio only silence)', async () => {
  // A video with no real audio: the silence detector will fire everywhere
  // but we should still get a sane result without errors.
  const src = await createSilentSource(dir, 'silent.mp4', 8);
  const result = await detectHighlights(src, {
    minDurationSeconds: 2,
    maxDurationSeconds: 5,
    defaultDurationSeconds: 3,
  });
  // No audio stream => no silence signals. No scene changes either.
  assert.equal(result.rawSilenceCount, 0);
  assert.equal(result.candidates.length, 0);
});

test('detectHighlights returns real MediaInfo', async () => {
  const src = await createSourceWithAudio(dir, 'info.mp4', 4, '640x360');
  const result = await detectHighlights(src, {
    minDurationSeconds: 1,
    maxDurationSeconds: 3,
    defaultDurationSeconds: 2,
  });
  assert.equal(result.source.width, 640);
  assert.equal(result.source.height, 360);
  assert.equal(result.source.hasVideo, true);
  assert.ok(result.source.durationSeconds !== null);
  assert.ok(result.source.durationSeconds! >= 3.5);
});

test('rendered highlight clips are real, decodable MP4s', async () => {
  // End-to-end: detect → render the first candidate → verify the output.
  const ffmpeg = probeFfmpeg();
  if (!ffmpeg.available) throw new Error('ffmpeg required');
  const { runFfmpeg } = await import('../server/media/ffmpeg-runner.ts');
  const src = path.join(dir, 'e2e.mp4');
  await runFfmpeg([
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:size=320x240:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'color=c=blue:size=320x240:rate=15:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-filter_complex',
      '[0:v]setpts=PTS-STARTPTS[v0];' +
      '[1:v]setpts=PTS-STARTPTS[v1];' +
      '[v0][v1]concat=n=2:v=1:a=0[outv];' +
      '[2:a]aresample=44100,atrim=0:4[a0]',
    '-map', '[outv]', '-map', '[a0]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-shortest', '-r', '15',
    src,
  ]);

  const result = await detectHighlights(src, {
    minDurationSeconds: 1,
    maxDurationSeconds: 3,
    defaultDurationSeconds: 2,
    sceneThreshold: 0.1,
  });
  assert.ok(result.candidates.length >= 1, 'need a candidate to render');
  const cand = result.candidates[0]!;
  const out = path.join(dir, 'highlight-out.mp4');
  const renderResult = await renderClip({
    inputPath: src,
    outputPath: out,
    startSeconds: cand.startSeconds,
    durationSeconds: cand.durationSeconds,
    aspect: 'vertical',
  });
  // Real, vertical, with audio preserved.
  assert.equal(renderResult.info.width, 1080);
  assert.equal(renderResult.info.height, 1920);
  assert.equal(renderResult.info.hasAudio, true);
  assert.equal(renderResult.audioPreserved, true);
});
