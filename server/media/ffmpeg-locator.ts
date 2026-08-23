/**
 * FFmpeg binary locator.
 *
 * AUDIT CONSTRAINT: system `ffmpeg` / `ffprobe` are NOT available and `apt`
 * cannot be used. The verified working binary comes from the `imageio-ffmpeg`
 * Python package. We therefore resolve the binary from the local virtualenv
 * and NEVER fall back to `ffmpeg` on PATH.
 *
 * Resolution order:
 *   1. CLIPFORGE_FFMPEG env var (explicit override, must exist + be executable)
 *   2. Direct filesystem scan of the venv's imageio_ffmpeg/binaries directory
 *   3. Ask the venv python for imageio_ffmpeg.get_ffmpeg_exe()
 */
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PROJECT_ROOT } from '../config.ts';

export class FfmpegUnavailableError extends Error {
  readonly attempts: string[];
  constructor(attempts: string[]) {
    super(
      'No usable FFmpeg binary could be located. ClipForge requires the ' +
        '`imageio-ffmpeg` package (system ffmpeg is not available in this ' +
        'environment). Run `npm run setup:ffmpeg` to provision it.',
    );
    this.name = 'FfmpegUnavailableError';
    this.attempts = attempts;
  }
}

function isExecutableFile(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const VENV_PYTHON = path.join(PROJECT_ROOT, '.venv', 'bin', 'python');

/** Scan `<venv>/lib/pythonX.Y/site-packages/imageio_ffmpeg/binaries` for the binary. */
function scanVenvBinaries(attempts: string[]): string | null {
  const libDir = path.join(PROJECT_ROOT, '.venv', 'lib');
  if (!existsSync(libDir)) {
    attempts.push(`venv lib dir missing: ${libDir}`);
    return null;
  }
  for (const pyDir of readdirSync(libDir)) {
    const binDir = path.join(libDir, pyDir, 'site-packages', 'imageio_ffmpeg', 'binaries');
    if (!existsSync(binDir)) continue;
    for (const entry of readdirSync(binDir)) {
      if (!entry.startsWith('ffmpeg-')) continue;
      const candidate = path.join(binDir, entry);
      if (isExecutableFile(candidate)) return candidate;
      attempts.push(`found but not executable: ${candidate}`);
    }
  }
  attempts.push(`no ffmpeg-* binary under ${libDir}/*/site-packages/imageio_ffmpeg/binaries`);
  return null;
}

/** Ask imageio_ffmpeg itself (handles non-standard layouts / user installs). */
function askImageioFfmpeg(attempts: string[]): string | null {
  const python = isExecutableFile(VENV_PYTHON) ? VENV_PYTHON : 'python3';
  try {
    const out = execFileSync(
      python,
      ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],
      { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    if (out && isExecutableFile(out)) return out;
    attempts.push(`imageio_ffmpeg returned unusable path via ${python}: ${out || '<empty>'}`);
  } catch (err) {
    attempts.push(`imageio_ffmpeg import failed via ${python}: ${(err as Error).message}`);
  }
  return null;
}

let cached: string | null = null;

/** Resolve the FFmpeg executable. Throws FfmpegUnavailableError if none exists. */
export function resolveFfmpegPath(): string {
  if (cached) return cached;

  const attempts: string[] = [];

  const override = process.env.CLIPFORGE_FFMPEG;
  if (override) {
    if (isExecutableFile(override)) {
      cached = override;
      return cached;
    }
    attempts.push(`CLIPFORGE_FFMPEG not executable: ${override}`);
  }

  const found = scanVenvBinaries(attempts) ?? askImageioFfmpeg(attempts);
  if (!found) throw new FfmpegUnavailableError(attempts);

  cached = found;
  return cached;
}

/** Non-throwing capability probe used by the /api/capabilities endpoint. */
export function probeFfmpeg():
  | { available: true; path: string; version: string }
  | { available: false; reason: string; attempts: string[] } {
  let binary: string;
  try {
    binary = resolveFfmpegPath();
  } catch (err) {
    const e = err as FfmpegUnavailableError;
    return { available: false, reason: e.message, attempts: e.attempts ?? [] };
  }
  try {
    const out = execFileSync(binary, ['-hide_banner', '-version'], {
      encoding: 'utf8',
      timeout: 20_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const version = out.split('\n', 1)[0]?.trim() ?? 'unknown';
    return { available: true, path: binary, version };
  } catch (err) {
    return {
      available: false,
      reason: `FFmpeg binary found but failed to execute: ${(err as Error).message}`,
      attempts: [binary],
    };
  }
}

/** Reset the memoised path (tests only). */
export function __resetFfmpegCache(): void {
  cached = null;
}
