/** Project persistence layer. All SQL lives here. */
import { randomUUID } from 'node:crypto';
import { getDb } from './database.ts';
import type { MediaInfo } from '../media/inspect.ts';

export type ProjectStatus = 'created' | 'preparing' | 'processing' | 'completed' | 'failed';

export interface ProjectRow {
  id: string;
  name: string;
  source_filename: string;
  source_path: string;
  source_bytes: number;
  output_path: string | null;
  status: ProjectStatus;
  error_message: string | null;
  media_json: string | null;
  output_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutputInfo {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  bytes: number;
  audioPreserved: boolean;
}

/** Shape sent to the browser. Deliberately excludes server filesystem paths. */
export interface ProjectDto {
  id: string;
  name: string;
  sourceFilename: string;
  sourceBytes: number;
  status: ProjectStatus;
  errorMessage: string | null;
  media: MediaInfo | null;
  output: OutputInfo | null;
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

export function toDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    sourceFilename: row.source_filename,
    sourceBytes: row.source_bytes,
    status: row.status,
    errorMessage: row.error_message,
    media: safeParse<MediaInfo>(row.media_json),
    output: safeParse<OutputInfo>(row.output_json),
    hasOutput: Boolean(row.output_path),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateProjectInput {
  name: string;
  sourceFilename: string;
  sourcePath: string;
  sourceBytes: number;
  media: MediaInfo | null;
}

export function createProject(input: CreateProjectInput): ProjectRow {
  const db = getDb();
  const id = randomUUID();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO projects
       (id, name, source_filename, source_path, source_bytes, status, media_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'created', ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.sourceFilename,
    input.sourcePath,
    input.sourceBytes,
    input.media ? JSON.stringify(input.media) : null,
    ts,
    ts,
  );
  return getProject(id)!;
}

export function getProject(id: string): ProjectRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  return row ?? null;
}

export function listProjects(): ProjectRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as unknown as ProjectRow[];
}

export function setStatus(id: string, status: ProjectStatus, errorMessage: string | null = null): void {
  getDb()
    .prepare('UPDATE projects SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
    .run(status, errorMessage, nowIso(), id);
}

export function setOutput(id: string, outputPath: string, output: OutputInfo): void {
  getDb()
    .prepare(
      `UPDATE projects
         SET output_path = ?, output_json = ?, status = 'completed',
             error_message = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(outputPath, JSON.stringify(output), nowIso(), id);
}

export function deleteProject(id: string): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
}
