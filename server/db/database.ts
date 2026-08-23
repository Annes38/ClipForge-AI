/**
 * SQLite persistence via Node's built-in `node:sqlite` module.
 * No remote database, no Supabase, no external service.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH } from '../config.ts';

let db: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  source_path    TEXT NOT NULL,
  source_bytes   INTEGER NOT NULL DEFAULT 0,
  output_path    TEXT,
  status         TEXT NOT NULL DEFAULT 'created',
  error_message  TEXT,
  media_json     TEXT,
  output_json    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);

CREATE TABLE IF NOT EXISTS clips (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  title            TEXT NOT NULL,
  start_seconds    REAL NOT NULL,
  duration_seconds REAL NOT NULL,
  aspect           TEXT NOT NULL,
  reframe          TEXT NOT NULL DEFAULT 'pad',
  status           TEXT NOT NULL DEFAULT 'pending',
  output_path      TEXT,
  error_message    TEXT,
  media_json       TEXT,
  output_json      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_clips_project_id ON clips(project_id, created_at DESC);

/**
 * Transcripts. One per project (the source video). When transcription
 * runs, segments are persisted here. UI never invents segments; the
 * status field distinguishes 'unavailable', 'pending', 'running',
 * 'completed' and 'failed' so the UI can be honest about what is real.
 */
CREATE TABLE IF NOT EXISTS transcripts (
  project_id       TEXT PRIMARY KEY,
  status           TEXT NOT NULL DEFAULT 'pending',
  language         TEXT,
  engine           TEXT,
  model            TEXT,
  segment_count    INTEGER NOT NULL DEFAULT 0,
  error_message    TEXT,
  segments_json    TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
`;

export function getDb(dbPath: string = DB_PATH): DatabaseSync {
  if (db) return db;
  mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // Lightweight in-place migrations. We only run idempotent ALTERs that
  // add columns when missing — older DB files pre-dating the transcripts
  // table would otherwise crash.
  ensureColumn(db, 'transcripts', 'segments_json', 'TEXT');
  return db;
}

function ensureColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  type: string,
): void {
  const rows = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  if (!rows.some((r) => r.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function closeDb(): void {
  db?.close();
  db = null;
}
