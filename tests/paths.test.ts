import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  assertInside,
  sanitizeFilename,
  deriveProjectName,
  hasAllowedVideoExtension,
  isValidProjectId,
  downloadFilenameFor,
  isValidClipId,
  clipOutputPathFor,
  clipDownloadFilenameFor,
} from '../server/storage/paths.ts';

test('assertInside allows paths within the root', () => {
  const root = '/var/data';
  assert.equal(assertInside(root, path.join(root, 'a.mp4')), '/var/data/a.mp4');
});

test('assertInside rejects traversal attempts', () => {
  const root = '/var/data';
  for (const bad of ['/var/data/../etc/passwd', '/etc/passwd', '/var/data/../../root/x']) {
    assert.throws(() => assertInside(root, bad), /outside the permitted directory/);
  }
});

test('assertInside rejects the root itself', () => {
  assert.throws(() => assertInside('/var/data', '/var/data'), /outside the permitted directory/);
});

test('sanitizeFilename strips directory components and traversal', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('/absolute/path/clip.mp4'), 'clip.mp4');
  assert.equal(sanitizeFilename('..'), 'upload');
  assert.equal(sanitizeFilename(''), 'upload');
});

test('sanitizeFilename preserves spaces and unicode but drops control chars', () => {
  assert.equal(sanitizeFilename('my holiday video.mp4'), 'my holiday video.mp4');
  assert.equal(sanitizeFilename('clip\u0000name.mp4'), 'clipname.mp4');
});

test('shell metacharacters survive as literal text (they are argv data, not shell)', () => {
  // We do not strip these: spawn() without a shell makes them inert.
  assert.equal(sanitizeFilename('a; rm -rf $(pwd).mp4'), 'a; rm -rf $(pwd).mp4');
});

test('extension allow-list accepts video containers and rejects others', () => {
  for (const ok of ['a.mp4', 'a.MOV', 'b.webm', 'c.mkv', 'd.avi', 'e.m4v']) {
    assert.equal(hasAllowedVideoExtension(ok), true, ok);
  }
  for (const bad of ['a.exe', 'a.sh', 'a.mp3', 'a.txt', 'noext']) {
    assert.equal(hasAllowedVideoExtension(bad), false, bad);
  }
});

test('project id validation only accepts UUIDs', () => {
  assert.equal(isValidProjectId('3f0f5b1e-9a1e-4c2b-9f3a-7b1c2d3e4f5a'), true);
  for (const bad of ['../../etc', 'abc', '', null, 42]) {
    assert.equal(isValidProjectId(bad), false);
  }
});

test('deriveProjectName produces a readable title', () => {
  assert.equal(deriveProjectName('my_great-clip.mp4'), 'my great clip');
  assert.equal(deriveProjectName('.mp4'), 'Untitled project');
});

test('downloadFilenameFor produces a safe filename', () => {
  assert.equal(downloadFilenameFor('My Clip!'), 'My-Clip-clipforge.mp4');
  assert.equal(downloadFilenameFor('../../etc/passwd'), 'passwd-clipforge.mp4');
});

test('isValidClipId accepts UUIDs and rejects anything else', () => {
  assert.equal(isValidClipId('3f0f5b1e-9a1e-4c2b-9f3a-7b1c2d3e4f5a'), true);
  for (const bad of [
    '../../etc',
    'abc',
    '',
    null,
    42,
    '3f0f5b1e-9a1e-4c2b-9f3a-7b1c2d3e4f5', // too short
    '3f0f5b1e-9a1e-4c2b-9f3a-7b1c2d3e4f5aa', // too long
    '../../../clip.mp4',
  ]) {
    assert.equal(isValidClipId(bad), false, `expected reject for ${String(bad)}`);
  }
});

test('clipOutputPathFor builds a path inside the output dir', () => {
  const p = clipOutputPathFor('3f0f5b1e-9a1e-4c2b-9f3a-7b1c2d3e4f5a');
  assert.match(p, /[\\/]clip-3f0f5b1e-9a1e-4c2b-9f3a-7b1c2d3e4f5a\.mp4$/);
});

test('clipOutputPathFor refuses non-UUID ids', () => {
  assert.throws(() => clipOutputPathFor('not-a-uuid'), /Invalid clip id/);
  assert.throws(() => clipOutputPathFor('../etc/passwd'), /Invalid clip id/);
});

test('clipDownloadFilenameFor produces a slugged filename', () => {
  const fn = clipDownloadFilenameFor('My Clip!', '3f0f5b1e-9a1e-4c2b-9f3a-7b1c2d3e4f5a');
  assert.match(fn, /^My-Clip-3f0f5b1e-clipforge\.mp4$/);
});
