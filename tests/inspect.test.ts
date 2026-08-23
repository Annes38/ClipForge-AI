import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, parseResolution, parseFrameRate, parseFfmpegBanner } from '../server/media/inspect.ts';

const BANNER = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'src.mp4':
  Metadata:
    major_brand     : isom
  Duration: 00:01:23.45, start: 0.000000, bitrate: 193 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 113 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 69 kb/s (default)
`;

test('parseDuration reads HH:MM:SS.ms', () => {
  assert.equal(parseDuration(BANNER), 83.45);
  assert.equal(parseDuration('no duration here'), null);
});

test('parseResolution ignores SAR/DAR ratios', () => {
  const line = BANNER.split('\n').find((l) => l.includes('Video:'))!;
  assert.deepEqual(parseResolution(line), { width: 1280, height: 720 });
});

test('parseResolution handles vertical output lines', () => {
  const line =
    '  Stream #0:0(und): Video: h264 (High), yuv420p, 1080x1920 [SAR 1:1 DAR 9:16], 30 fps';
  assert.deepEqual(parseResolution(line), { width: 1080, height: 1920 });
});

test('parseFrameRate reads fps', () => {
  const line = BANNER.split('\n').find((l) => l.includes('Video:'))!;
  assert.equal(parseFrameRate(line), 30);
});

test('parseFfmpegBanner extracts a full MediaInfo', () => {
  const info = parseFfmpegBanner(BANNER);
  assert.equal(info.durationSeconds, 83.45);
  assert.equal(info.width, 1280);
  assert.equal(info.height, 720);
  assert.equal(info.hasVideo, true);
  assert.equal(info.hasAudio, true);
  assert.equal(info.videoCodec, 'h264');
  assert.equal(info.audioCodec, 'aac');
  assert.equal(info.frameRate, 30);
  assert.match(info.formatName ?? '', /mov/);
});

test('parseFfmpegBanner reports no audio when there is no audio stream', () => {
  const silent = BANNER.split('\n').filter((l) => !l.includes('Audio:')).join('\n');
  const info = parseFfmpegBanner(silent);
  assert.equal(info.hasAudio, false);
  assert.equal(info.audioCodec, null);
  assert.equal(info.hasVideo, true);
});
