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
`;

export function getDb(dbPath: string = DB_PATH): DatabaseSync {
  if (db) return db;
  mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
