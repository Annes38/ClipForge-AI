/**
 * Server-side validation for clip parameters.
 *
 * The browser only sends start time, duration, aspect, reframe and a title.
 * The server clamps and rejects explicitly — we never silently coerce bad input.
 */
import type { AspectMode, ReframeMode } from '../media/clip-renderer.ts';
import { ALLOWED_CLIP_ASPECTS, ALLOWED_CLIP_REFRAMES } from '../db/clips-repo.ts';

export const MAX_CLIP_TITLE_LENGTH = 80;
export const MAX_CLIP_DURATION_SECONDS = 600;
export const MIN_CLIP_DURATION_SECONDS = 0.1;

export type ValidatedClipParams = {
  title: string;
  startSeconds: number;
  durationSeconds: number;
  aspect: AspectMode;
  reframe: ReframeMode;
};

export type ValidationFailure = { ok: false; error: string };
export type ValidationSuccess = { ok: true; value: ValidatedClipParams };
export type ValidationResult = ValidationSuccess | ValidationFailure;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function sanitizeTitle(input: unknown): string {
  if (typeof input !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const cleaned = input.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.slice(0, MAX_CLIP_TITLE_LENGTH);
}

export function validateClipParams(body: unknown): ValidationResult {
  const obj =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

  const title = sanitizeTitle(obj.title);
  if (title.length === 0) {
    return { ok: false, error: 'A clip title is required.' };
  }

  const startRaw = obj.startSeconds;
  if (!isFiniteNumber(startRaw) || startRaw < 0) {
    return { ok: false, error: 'startSeconds must be a non-negative number.' };
  }
  const durationRaw = obj.durationSeconds;
  if (!isFiniteNumber(durationRaw)) {
    return { ok: false, error: 'durationSeconds must be a finite number.' };
  }
  if (durationRaw <= 0) {
    return { ok: false, error: 'durationSeconds must be greater than zero.' };
  }
  if (durationRaw > MAX_CLIP_DURATION_SECONDS) {
    return {
      ok: false,
      error: `durationSeconds must be ${MAX_CLIP_DURATION_SECONDS} seconds or less.`,
    };
  }

  const aspectRaw = obj.aspect;
  if (typeof aspectRaw !== 'string' || !ALLOWED_CLIP_ASPECTS.includes(aspectRaw as AspectMode)) {
    return {
      ok: false,
      error: `aspect must be one of: ${ALLOWED_CLIP_ASPECTS.join(', ')}.`,
    };
  }

  // Reframe is optional and defaults to 'pad'. When present it must be one
  // of the allowed values. It only takes effect when aspect === 'vertical'.
  let reframe: ReframeMode = 'pad';
  if (obj.reframe !== undefined && obj.reframe !== null && obj.reframe !== '') {
    if (typeof obj.reframe !== 'string' || !ALLOWED_CLIP_REFRAMES.includes(obj.reframe as ReframeMode)) {
      return {
        ok: false,
        error: `reframe must be one of: ${ALLOWED_CLIP_REFRAMES.join(', ')}.`,
      };
    }
    reframe = obj.reframe as ReframeMode;
  }

  return {
    ok: true,
    value: {
      title,
      startSeconds: startRaw,
      durationSeconds: durationRaw,
      aspect: aspectRaw as AspectMode,
      reframe,
    },
  };
}

export function checkSegmentFitsSource(
  startSeconds: number,
  durationSeconds: number,
  sourceDurationSeconds: number | null,
): string | null {
  if (sourceDurationSeconds === null) return null;
  const end = startSeconds + durationSeconds;
  if (end - sourceDurationSeconds > 0.5) {
    return (
      `Clip end (${end.toFixed(2)}s) is beyond the source duration ` +
      `(${sourceDurationSeconds.toFixed(2)}s). ` +
      `Maximum allowed start + duration is ${sourceDurationSeconds.toFixed(2)}s.`
    );
  }
  return null;
}
