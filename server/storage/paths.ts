/**
 * Path safety helpers.
 *
 * SECURITY: the browser never sends a filesystem path. It sends a project id
 * (a UUID). Every path the server touches is built from a validated id plus a
 * server-controlled directory, and is then re-checked to ensure it really is
 * inside the directory we intended (defence in depth against traversal).
 */
import path from 'node:path';
import { OUTPUT_DIR, UPLOAD_DIR, ALLOWED_VIDEO_EXTENSIONS } from '../config.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidProjectId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** Throw unless `candidate` resolves to a location inside `root`. */
export function assertInside(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Refusing to access a path outside the permitted directory.');
  }
  return resolved;
}

/**
 * Reduce an arbitrary client-supplied filename to a harmless label.
 * Strips directory components, control characters and leading dots.
 */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '')
    .trim();
  const cleaned = base.replace(/^\.+/, '').slice(0, 180);
  return cleaned.length > 0 ? cleaned : 'upload';
}

/** Human-friendly project name derived from a filename (extension removed). */
export function deriveProjectName(filename: string): string {
  const base = path.basename(filename ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '')
    .trim();
  // Drop the extension first, so a bare ".mp4" collapses to nothing rather
  // than surviving as the literal word "mp4" once leading dots are stripped.
  const withoutExt = base.replace(/\.[^.]*$/, '');
  const pretty = withoutExt.replace(/^\.+/, '').replace(/[_-]+/g, ' ').trim();
  return (pretty || 'Untitled project').slice(0, 100);
}

export function hasAllowedVideoExtension(filename: string): boolean {
  return ALLOWED_VIDEO_EXTENSIONS.has(path.extname(sanitizeFilename(filename)).toLowerCase());
}

/** Canonical on-disk location for a project's uploaded source. */
export function uploadPathFor(projectFileId: string, originalName: string): string {
  const ext = path.extname(sanitizeFilename(originalName)).toLowerCase() || '.mp4';
  return assertInside(UPLOAD_DIR, path.join(UPLOAD_DIR, `${projectFileId}${ext}`));
}

/** Canonical on-disk location for a project's rendered clip. */
export function outputPathFor(projectId: string): string {
  if (!isValidProjectId(projectId)) throw new Error('Invalid project id.');
  return assertInside(OUTPUT_DIR, path.join(OUTPUT_DIR, `${projectId}.mp4`));
}

/**
 * Clip ids are also UUIDs. We validate separately so the API can return a
 * distinct "invalid clip id" error and so future format changes to clip
 * identifiers don't accidentally loosen project id validation.
 */
const CLIP_UUID_RE = UUID_RE;

export function isValidClipId(id: unknown): id is string {
  return typeof id === 'string' && CLIP_UUID_RE.test(id);
}

/** Canonical on-disk location for a clip's rendered output. */
export function clipOutputPathFor(clipId: string): string {
  if (!isValidClipId(clipId)) throw new Error('Invalid clip id.');
  return assertInside(OUTPUT_DIR, path.join(OUTPUT_DIR, `clip-${clipId}.mp4`));
}

/** Filename offered to the user when downloading a clip. */
export function clipDownloadFilenameFor(title: string, clipId: string): string {
  const slug =
    sanitizeFilename(title)
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'clip';
  const short = clipId.slice(0, 8);
  return `${slug}-${short}-clipforge.mp4`;
}

/** Filename offered to the user on download. */
export function downloadFilenameFor(projectName: string): string {
  const slug =
    sanitizeFilename(projectName)
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'clip';
  return `${slug}-clipforge.mp4`;
}
