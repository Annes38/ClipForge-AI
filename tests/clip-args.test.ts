import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClipArgs } from '../server/media/clip-renderer.ts';

const base = {
  inputPath: '/tmp/in.mp4',
  outputPath: '/tmp/out.mp4',
  startSeconds: 1.5,
  durationSeconds: 4,
  hasAudio: true,
  targetWidth: 1080,
  targetHeight: 1920,
};

test('vertical mode builds a scale+pad filter to 1080x1920', () => {
  const args = buildClipArgs({ ...base, aspect: 'vertical' });
  const vf = args[args.indexOf('-vf') + 1]!;
  assert.match(vf, /scale=1080:1920:force_original_aspect_ratio=decrease/);
  assert.match(vf, /pad=1080:1920/);
  assert.match(vf, /setsar=1/);
});

test('source mode applies no video filter', () => {
  const args = buildClipArgs({ ...base, aspect: 'source' });
  assert.equal(args.includes('-vf'), false);
});

test('audio is encoded when the source has audio', () => {
  const args = buildClipArgs({ ...base, aspect: 'vertical', hasAudio: true });
  assert.equal(args.includes('-an'), false);
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
});

test('audio is disabled when the source has none', () => {
  const args = buildClipArgs({ ...base, aspect: 'vertical', hasAudio: false });
  assert.equal(args.includes('-an'), true);
  assert.equal(args.includes('-c:a'), false);
});

test('trim flags use the requested start and duration', () => {
  const args = buildClipArgs({ ...base, aspect: 'vertical' });
  assert.equal(args[args.indexOf('-ss') + 1], '1.500');
  assert.equal(args[args.indexOf('-t') + 1], '4.000');
});

test('filenames with spaces and shell metacharacters stay single argv entries', () => {
  const nasty = '/tmp/my video; rm -rf $(pwd).mp4';
  const args = buildClipArgs({ ...base, inputPath: nasty, aspect: 'vertical' });
  // The whole dangerous string must appear as exactly one argument.
  assert.equal(args.filter((a) => a === nasty).length, 1);
  assert.equal(args[args.indexOf('-i') + 1], nasty);
});

test('output path is the final argument', () => {
  const args = buildClipArgs({ ...base, aspect: 'vertical' });
  assert.equal(args.at(-1), '/tmp/out.mp4');
});
