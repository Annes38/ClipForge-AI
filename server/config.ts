import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repository root. */
export const PROJECT_ROOT = path.resolve(here, '..');

/** Root of all runtime state (gitignored). Override with CLIPFORGE_DATA_DIR. */
export const DATA_DIR = process.env.CLIPFORGE_DATA_DIR
  ? path.resolve(process.env.CLIPFORGE_DATA_DIR)
  : path.join(PROJECT_ROOT, 'data');

/** Original user uploads. */
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
/** Rendered clips. */
export const OUTPUT_DIR = path.join(DATA_DIR, 'outputs');
/** Scratch space for in-flight renders. */
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
/** SQLite database file. */
export const DB_PATH = process.env.CLIPFORGE_DB ?? path.join(DATA_DIR, 'clipforge.db');

export const API_PORT = Number(process.env.PORT ?? 8787);

/** Hard upload ceiling (bytes). */
export const MAX_UPLOAD_BYTES = Number(process.env.CLIPFORGE_MAX_UPLOAD ?? 512 * 1024 * 1024);

/** Container extensions we accept for upload. */
export const ALLOWED_VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.mkv',
  '.avi',
]);

export const ALLOWED_MIME_PREFIXES = ['video/', 'application/octet-stream'];

export function ensureDirectories(): void {
  for (const dir of [DATA_DIR, UPLOAD_DIR, OUTPUT_DIR, TMP_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}
