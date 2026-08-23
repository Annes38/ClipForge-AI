/**
 * Unit tests for the clip parameter validation module.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateClipParams,
  checkSegmentFitsSource,
  MAX_CLIP_DURATION_SECONDS,
  MAX_CLIP_TITLE_LENGTH,
} from '../server/validation/clip-params.ts';

test('accepts a well-formed request', () => {
  const v = validateClipParams({
    title: 'Hook',
    startSeconds: 1,
    durationSeconds: 5,
    aspect: 'vertical',
  });
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.value.title, 'Hook');
    assert.equal(v.value.startSeconds, 1);
    assert.equal(v.value.durationSeconds, 5);
    assert.equal(v.value.aspect, 'vertical');
  }
});

test('rejects missing / non-object body', () => {
  for (const body of [undefined, null, 'hello', 42, []]) {
    const v = validateClipParams(body);
    assert.equal(v.ok, false, `expected fail for ${JSON.stringify(body)}`);
  }
});

test('rejects missing/empty title', () => {
  for (const t of [undefined, null, '', '   ', '\t']) {
    const v = validateClipParams({
      title: t,
      startSeconds: 0,
      durationSeconds: 1,
      aspect: 'vertical',
    });
    assert.equal(v.ok, false, `expected fail for title=${JSON.stringify(t)}`);
  }
});

test('strips control characters from title and caps length', () => {
  const longish = 'a'.repeat(200);
  const v = validateClipParams({
    title: `clip\u0000name${longish}`,
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.value.title.length, MAX_CLIP_TITLE_LENGTH);
    assert.equal(v.value.title.startsWith('clipname'), true);
  }
});

test('rejects negative start time', () => {
  for (const s of [-1, -0.0001, -1000]) {
    const v = validateClipParams({
      title: 't',
      startSeconds: s,
      durationSeconds: 1,
      aspect: 'vertical',
    });
    assert.equal(v.ok, false, `expected fail for startSeconds=${s}`);
  }
});

test('rejects non-finite start time', () => {
  for (const s of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1', null, undefined]) {
    const v = validateClipParams({
      title: 't',
      startSeconds: s,
      durationSeconds: 1,
      aspect: 'vertical',
    });
    assert.equal(v.ok, false, `expected fail for startSeconds=${String(s)}`);
  }
});

test('rejects zero, negative, and oversized duration', () => {
  for (const d of [0, -1, -0.1, MAX_CLIP_DURATION_SECONDS + 1, 1e9]) {
    const v = validateClipParams({
      title: 't',
      startSeconds: 0,
      durationSeconds: d,
      aspect: 'vertical',
    });
    assert.equal(v.ok, false, `expected fail for durationSeconds=${d}`);
  }
});

test('rejects non-finite duration', () => {
  for (const d of [Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined]) {
    const v = validateClipParams({
      title: 't',
      startSeconds: 0,
      durationSeconds: d,
      aspect: 'vertical',
    });
    assert.equal(v.ok, false, `expected fail for durationSeconds=${String(d)}`);
  }
});

test('rejects invalid aspect', () => {
  for (const a of ['square', '1:1', '', 'PORTRAIT', null, undefined, 42]) {
    const v = validateClipParams({
      title: 't',
      startSeconds: 0,
      durationSeconds: 1,
      aspect: a,
    });
    assert.equal(v.ok, false, `expected fail for aspect=${String(a)}`);
  }
});

test('accepts both allowed aspect values', () => {
  for (const a of ['vertical', 'source']) {
    const v = validateClipParams({
      title: 't',
      startSeconds: 0,
      durationSeconds: 1,
      aspect: a,
    });
    assert.equal(v.ok, true, `expected pass for aspect=${a}`);
  }
});

test('reframe is optional and defaults to pad', () => {
  const v = validateClipParams({
    title: 't',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.value.reframe, 'pad');
});

test('accepts all four reframe modes', () => {
  for (const r of ['pad', 'crop-center', 'crop-top', 'crop-bottom']) {
    const v = validateClipParams({
      title: 't',
      startSeconds: 0,
      durationSeconds: 1,
      aspect: 'vertical',
      reframe: r,
    });
    assert.equal(v.ok, true, `expected pass for reframe=${r}`);
    if (v.ok) assert.equal(v.value.reframe, r);
  }
});

test('rejects an unknown reframe value', () => {
  for (const r of ['smart', 'face', 'pad!', 'crop center', 42, true]) {
    const v = validateClipParams({
      title: 't',
      startSeconds: 0,
      durationSeconds: 1,
      aspect: 'vertical',
      reframe: r,
    });
    assert.equal(v.ok, false, `expected fail for reframe=${String(r)}`);
  }
});

test('empty-string reframe falls back to the default (pad)', () => {
  const v = validateClipParams({
    title: 't',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
    reframe: '',
  });
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.value.reframe, 'pad');
});

test('checkSegmentFitsSource allows exact end equal to source duration (within tolerance)', () => {
  assert.equal(checkSegmentFitsSource(2, 3, 5), null);
  assert.equal(checkSegmentFitsSource(0, 5, 5), null);
});

test('checkSegmentFitsSource rejects overshoot', () => {
  const msg = checkSegmentFitsSource(2, 4, 5);
  assert.ok(msg);
  assert.match(msg!, /beyond/);
});

test('checkSegmentFitsSource allows unknown source duration', () => {
  // If we don't know the source length we can't reject — the renderer will
  // clamp to whatever is available. This is the documented behavior.
  assert.equal(checkSegmentFitsSource(0, 600, null), null);
  assert.equal(checkSegmentFitsSource(1, 5, null), null);
});

test('checkSegmentFitsSource tolerates tiny floating-point overshoot', () => {
  // 0.5s tolerance is built in to handle FFmpeg banner rounding.
  assert.equal(checkSegmentFitsSource(2, 3.2, 5), null);
  const msg = checkSegmentFitsSource(2, 3.6, 5);
  assert.ok(msg, '0.6s over should still be rejected');
});
