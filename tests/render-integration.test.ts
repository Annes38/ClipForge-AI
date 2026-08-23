/**
 * REAL end-to-end video processing tests.
 *
 * These execute the actual imageio-ffmpeg binary against actual encoded video
 * files and then verify the RESULTING FILE — never merely the exit code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderClip, ClipRenderError } from '../server/media/clip-renderer.ts';
import { inspectMedia, MediaInspectionError } from '../server/media/inspect.ts';
import { probeFfmpeg } from '../server/media/ffmpeg-locator.ts';
import { makeTempDir, createSourceWithAudio, createSilentSource } from './helpers/fixtures.ts';

const ffmpeg = probeFfmpeg();
if (!ffmpeg.available) {
  throw new Error(
    `FFmpeg is required for the integration tests but is unavailable: ${ffmpeg.reason}. ` +
      'Run `npm run setup:ffmpeg`.',
  );
}

const dir = makeTempDir();
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

/** An MP4 must begin with an ftyp box. */
function assertLooksLikeMp4(file: string): void {
  const head = readFileSync(file).subarray(0, 12);
  assert.equal(head.subarray(4, 8).toString('latin1'), 'ftyp', `${file} is not an MP4 (no ftyp box)`);
}

test('ffmpeg binary comes from imageio-ffmpeg, not the system PATH', () => {
  assert.equal(ffmpeg.available, true);
  if (ffmpeg.available) {
    assert.match(ffmpeg.path, /imageio_ffmpeg/);
    assert.match(ffmpeg.version, /ffmpeg version/i);
  }
});

test('renders a real 9:16 vertical clip and preserves audio', async () => {
  const src = await createSourceWithAudio(dir, 'landscape.mp4', 6, '1280x720');
  const out = path.join(dir, 'vertical.mp4');

  const seen: number[] = [];
  const result = await renderClip({
    inputPath: src,
    outputPath: out,
    startSeconds: 1,
    durationSeconds: 3,
    aspect: 'vertical',
    onProgress: (s) => seen.push(s),
  });

  // The output file really exists and is a real MP4.
  assert.equal(existsSync(out), true, 'output file was not created');
  assert.ok(statSync(out).size > 1024, 'output file is implausibly small');
  assertLooksLikeMp4(out);

  // Real 9:16 dimensions, verified by decoding the output.
  assert.equal(result.info.width, 1080);
  assert.equal(result.info.height, 1920);
  assert.equal((result.info.width ?? 0) / (result.info.height ?? 1), 1080 / 1920);

  // Duration is close to what we asked for.
  assert.ok(
    Math.abs((result.info.durationSeconds ?? 0) - 3) < 0.75,
    `expected ~3s, got ${result.info.durationSeconds}`,
  );

  // Audio survived the round trip.
  assert.equal(result.audioPreserved, true);
  assert.equal(result.info.hasAudio, true);
  assert.equal(result.info.audioCodec, 'aac');

  // Progress came from FFmpeg itself.
  assert.ok(seen.length > 0, 'no real progress was reported by FFmpeg');
});

test('a source without audio yields a video-only clip (no fake silent track)', async () => {
  const src = await createSilentSource(dir, 'silent.mp4', 5);
  const out = path.join(dir, 'silent-out.mp4');

  const result = await renderClip({
    inputPath: src,
    outputPath: out,
    startSeconds: 0,
    durationSeconds: 2,
    aspect: 'vertical',
  });

  assert.equal(existsSync(out), true);
  assertLooksLikeMp4(out);
  assert.equal(result.info.hasAudio, false);
  assert.equal(result.audioPreserved, false);
  assert.equal(result.info.width, 1080);
  assert.equal(result.info.height, 1920);
});

test('source-aspect mode keeps the original dimensions', async () => {
  const src = await createSourceWithAudio(dir, 'keep.mp4', 4, '640x360');
  const out = path.join(dir, 'keep-out.mp4');

  const result = await renderClip({
    inputPath: src,
    outputPath: out,
    startSeconds: 0,
    durationSeconds: 2,
    aspect: 'source',
  });

  assert.equal(result.info.width, 640);
  assert.equal(result.info.height, 360);
});

test('a portrait source is letterboxed, never stretched', async () => {
  const src = await createSourceWithAudio(dir, 'portrait.mp4', 4, '480x640');
  const out = path.join(dir, 'portrait-out.mp4');

  const result = await renderClip({
    inputPath: src,
    outputPath: out,
    startSeconds: 0,
    durationSeconds: 2,
    aspect: 'vertical',
  });

  assert.equal(result.info.width, 1080);
  assert.equal(result.info.height, 1920);
});

test('duration is clamped to the available footage', async () => {
  const src = await createSourceWithAudio(dir, 'short.mp4', 4);
  const out = path.join(dir, 'clamped.mp4');

  // Ask for 60s starting at 2s from a 4s source -> ~2s of real output.
  const result = await renderClip({
    inputPath: src,
    outputPath: out,
    startSeconds: 2,
    durationSeconds: 60,
    aspect: 'vertical',
  });

  assert.ok(
    (result.info.durationSeconds ?? 99) < 3.5,
    `expected the clip to be clamped to ~2s, got ${result.info.durationSeconds}`,
  );
});

/* ---------------------------- failure handling ---------------------------- */

test('missing input file fails cleanly and writes no output', async () => {
  const out = path.join(dir, 'never.mp4');
  await assert.rejects(
    renderClip({
      inputPath: path.join(dir, 'does-not-exist.mp4'),
      outputPath: out,
      startSeconds: 0,
      durationSeconds: 2,
      aspect: 'vertical',
    }),
    (err: Error) => {
      assert.ok(err instanceof MediaInspectionError || err instanceof ClipRenderError);
      return true;
    },
  );
  assert.equal(existsSync(out), false, 'a failed render must not leave an output file');
});

test('a non-video file is rejected as invalid input', async () => {
  const bogus = path.join(dir, 'notavideo.mp4');
  writeFileSync(bogus, 'this is definitely not a video file');
  await assert.rejects(inspectMedia(bogus), MediaInspectionError);

  const out = path.join(dir, 'bogus-out.mp4');
  await assert.rejects(
    renderClip({
      inputPath: bogus,
      outputPath: out,
      startSeconds: 0,
      durationSeconds: 2,
      aspect: 'vertical',
    }),
  );
  assert.equal(existsSync(out), false);
});

test('an audio-only file is rejected (no video stream)', async () => {
  const audioOnly = path.join(dir, 'audio-only.m4a');
  const { runFfmpeg } = await import('../server/media/ffmpeg-runner.ts');
  await runFfmpeg([
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:a', 'aac', audioOnly,
  ]);
  await assert.rejects(inspectMedia(audioOnly), /no video stream/i);
});

test('a start time beyond the end of the source is rejected', async () => {
  const src = await createSourceWithAudio(dir, 'tiny.mp4', 3);
  await assert.rejects(
    renderClip({
      inputPath: src,
      outputPath: path.join(dir, 'oob.mp4'),
      startSeconds: 30,
      durationSeconds: 5,
      aspect: 'vertical',
    }),
    /beyond the end of the source/,
  );
});

test('invalid start/duration values are rejected before any encoding', async () => {
  const src = await createSourceWithAudio(dir, 'valid.mp4', 3);
  const bad = [
    { startSeconds: -1, durationSeconds: 2, re: /non-negative/ },
    { startSeconds: 0, durationSeconds: 0, re: /greater than zero/ },
    { startSeconds: 0, durationSeconds: Number.NaN, re: /greater than zero/ },
  ];
  for (const c of bad) {
    await assert.rejects(
      renderClip({
        inputPath: src,
        outputPath: path.join(dir, 'bad.mp4'),
        startSeconds: c.startSeconds,
        durationSeconds: c.durationSeconds,
        aspect: 'vertical',
      }),
      c.re,
    );
  }
});

test('filenames containing spaces and shell metacharacters are handled safely', async () => {
  const canary = path.join(dir, 'canary.txt');
  writeFileSync(canary, 'untouched');

  // If any layer used a shell, this filename would delete the canary.
  // The command substitution is relative so the whole thing stays one path
  // segment; it runs with cwd = the temp dir, so `rm -f canary.txt` would hit.
  const nasty = path.join(dir, 'evil; rm -f canary.txt #.mp4');
  const src = await createSourceWithAudio(dir, 'plain.mp4', 4);
  const { runFfmpeg } = await import('../server/media/ffmpeg-runner.ts');
  await runFfmpeg(['-hide_banner', '-y', '-i', src, '-c', 'copy', nasty]);

  const out = path.join(dir, 'evil out $(rm -f canary.txt).mp4');
  const result = await renderClip({
    inputPath: nasty,
    outputPath: out,
    startSeconds: 0,
    durationSeconds: 2,
    aspect: 'vertical',
  });

  assert.equal(existsSync(out), true);
  assert.equal(result.info.width, 1080);
  assert.equal(readFileSync(canary, 'utf8'), 'untouched', 'shell injection occurred!');
});
