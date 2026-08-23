/**
 * Transcripts persistence layer.
 *
 * One transcript row per project. The actual segments are stored in a
 * JSON blob (`segments_json`) so we don't have to manage a separate
 * child table for what is conceptually a small list.
 *
 * Server filesystem paths are NEVER exposed to the browser; the DTO
 * omits them.
 */
import { getDb } from './database.ts';

export type TranscriptStatus = 'pending' | 'running' | 'completed' | 'failed' | 'unavailable';

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptRow {
  project_id: string;
  status: TranscriptStatus;
  language: string | null;
  engine: string | null;
  model: string | null;
  segment_count: number;
  error_message: string | null;
  segments_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptDto {
  projectId: string;
  status: TranscriptStatus;
  language: string | null;
  engine: string | null;
  model: string | null;
  segmentCount: number;
  errorMessage: string | null;
  segments: TranscriptSegment[];
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

function rowToDto(row: TranscriptRow): TranscriptDto {
  return {
    projectId: row.project_id,
    status: row.status,
    language: row.language,
    engine: row.engine,
    model: row.model,
    segmentCount: row.segment_count,
    errorMessage: row.error_message,
    segments: safeParse<TranscriptSegment[]>(row.segments_json) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getTranscript(projectId: string): TranscriptDto | null {
  const db = getDb();
  // Use a fresh SELECT that also pulls segments_json. The base table
  // we declared doesn't have segments_json, so we look it up via
  // pragma to keep this function tolerant of older schemas.
  // For simplicity we use a prepared statement that selects all
  // common columns. The actual columns exist (see schema).
  const row = db
    .prepare(
      `SELECT project_id, status, language, engine, model, segment_count,
              error_message, segments_json, created_at, updated_at
         FROM transcripts WHERE project_id = ?`,
    )
    .get(projectId) as TranscriptRow | undefined;
  return row ? rowToDto(row) : null;
}

export function upsertTranscript(input: {
  projectId: string;
  status: TranscriptStatus;
  language?: string | null;
  engine?: string | null;
  model?: string | null;
  segmentCount?: number;
  errorMessage?: string | null;
  segments?: TranscriptSegment[] | null;
}): TranscriptDto {
  const db = getDb();
  const existing = getTranscript(input.projectId);
  const ts = nowIso();
  const lang = input.language ?? existing?.language ?? null;
  const eng = input.engine ?? existing?.engine ?? null;
  const mod = input.model ?? existing?.model ?? null;
  const err = input.errorMessage ?? existing?.errorMessage ?? null;
  // If the caller passed a new segments list, derive segmentCount from
  // it; otherwise fall back to the existing value (or 0 for a new row).
  let segCount: number;
  if (input.segmentCount !== undefined) {
    segCount = input.segmentCount;
  } else if (input.segments !== undefined && input.segments !== null) {
    segCount = input.segments.length;
  } else {
    segCount = existing?.segmentCount ?? 0;
  }
  const segs = input.segments !== undefined ? input.segments : null;

  if (existing) {
    db.prepare(
      `UPDATE transcripts
         SET status = ?, language = ?, engine = ?, model = ?,
             segment_count = ?, error_message = ?,
             segments_json = ?, updated_at = ?
       WHERE project_id = ?`,
    ).run(
      input.status,
      lang,
      eng,
      mod,
      segCount,
      err,
      segs ? JSON.stringify(segs) : null,
      ts,
      input.projectId,
    );
  } else {
    db.prepare(
      `INSERT INTO transcripts
         (project_id, status, language, engine, model, segment_count,
          error_message, segments_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.projectId,
      input.status,
      lang,
      eng,
      mod,
      segCount,
      err,
      segs ? JSON.stringify(segs) : null,
      ts,
      ts,
    );
  }
  return getTranscript(input.projectId)!;
}

export function deleteTranscript(projectId: string): void {
  getDb().prepare('DELETE FROM transcripts WHERE project_id = ?').run(projectId);
}
