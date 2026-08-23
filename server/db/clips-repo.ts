/**
 * Clips persistence layer. All SQL lives here.
 *
 * A clip is a per-project record describing a single rendered segment. The
 * underlying `output_path` lives on disk; the database only stores metadata
 * plus a path reference. Server filesystem paths are NEVER exposed to the
 * browser: the DTO deliberately omits them.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from './database.ts';
import type { MediaInfo } from '../media/inspect.ts';
import type { AspectMode } from '../media/clip-renderer.ts';

export type ClipStatus = 'pending' | 'processing' | 'completed' | 'failed';

export const ALLOWED_CLIP_ASPECTS: ReadonlyArray<AspectMode> = ['vertical', 'source'];

export interface ClipRow {
  id: string;
  project_id: string;
  title: string;
  start_seconds: number;
  duration_seconds: number;
  aspect: string;
  status: ClipStatus;
  output_path: string | null;
  error_message: string | null;
  media_json: string | null;
  output_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClipOutputInfo {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  bytes: number;
  audioPreserved: boolean;
}

/** Shape sent to the browser. Deliberately excludes server filesystem paths. */
export interface ClipDto {
  id: string;
  projectId: string;
  title: string;
  startSeconds: number;
  durationSeconds: number;
  aspect: AspectMode;
  status: ClipStatus;
  errorMessage: string | null;
  media: MediaInfo | null;
  output: ClipOutputInfo | null;
  hasOutput: boolean;
  createdAt: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeParse<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function normalizeAspect(aspect: string): AspectMode {
  return aspect === 'source' ? 'source' : 'vertical';
}

function normalizeStatus(status: string): ClipStatus {
  switch (status) {
    case 'pending':
    case 'processing':
    case 'completed':
    case 'failed':
      return status;
    default:
      return 'pending';
  }
}

function rowToDto(row: ClipRow): ClipDto {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    startSeconds: row.start_seconds,
    durationSeconds: row.duration_seconds,
    aspect: normalizeAspect(row.aspect),
    status: normalizeStatus(row.status),
    errorMessage: row.error_message,
    media: safeParse<MediaInfo>(row.media_json),
    output: safeParse<ClipOutputInfo>(row.output_json),
    hasOutput: Boolean(row.output_path),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toDto(row: ClipRow): ClipDto {
  return rowToDto(row);
}

export interface CreateClipInput {
  projectId: string;
  title: string;
  startSeconds: number;
  durationSeconds: number;
  aspect: AspectMode;
}

export function createClip(input: CreateClipInput): ClipRow {
  const db = getDb();
  const id = randomUUID();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO clips
       (id, project_id, title, start_seconds, duration_seconds, aspect,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.title,
    input.startSeconds,
    input.durationSeconds,
    input.aspect,
    ts,
    ts,
  );
  return getClip(id)!;
}

export function getClip(id: string): ClipRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM clips WHERE id = ?').get(id) as ClipRow | undefined;
  return row ?? null;
}

export function listClips(projectId: string): ClipRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM clips WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as unknown as ClipRow[];
}

export function setClipStatus(
  id: string,
  status: ClipStatus,
  errorMessage: string | null = null,
): void {
  getDb()
    .prepare('UPDATE clips SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
    .run(status, errorMessage, nowIso(), id);
}

export function setClipOutput(id: string, outputPath: string, output: ClipOutputInfo): void {
  getDb()
    .prepare(
      `UPDATE clips
         SET output_path = ?, output_json = ?, status = 'completed',
             error_message = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(outputPath, JSON.stringify(output), nowIso(), id);
}

export function setClipMedia(id: string, media: MediaInfo): void {
  getDb()
    .prepare('UPDATE clips SET media_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(media), nowIso(), id);
}

export function deleteClip(id: string): void {
  getDb().prepare('DELETE FROM clips WHERE id = ?').run(id);
}

/** Count of clips that reference a project. Used by tests. */
export function countClipsForProject(projectId: string): number {
  const db = getDb();
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM clips WHERE project_id = ?')
    .get(projectId) as { c: number };
  return row.c;
}

/** Most recent clip for a project. */
export function latestClipForProject(projectId: string): ClipRow | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM clips WHERE project_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(projectId) as ClipRow | undefined;
  return row ?? null;
}
