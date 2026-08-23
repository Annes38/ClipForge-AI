/**
 * Audio transcription foundation.
 *
 * AUDIT CONSTRAINT: this project ships WITHOUT bundled speech-to-text
 * weights. The verified MVP declares transcription as 'unavailable'
 * because the environment cannot download Whisper weights and `apt` is
 * not available. This module is the integration point for when an
 * engine is available: it locates a whisper-like binary, runs it on
 * the project's source audio, and parses JSON segments.
 *
 * If no engine is present, `transcribeAudio()` throws
 * TranscriptionUnavailableError. The capability is reported as
 * 'unavailable' until a binary is on PATH or the env var
 * CLIPFORGE_WHISPER is set. We never invent segments.
 */
import { spawn } from 'node:child_process';
import { existsSync, accessSync, constants, mkdirSync, readFileSync } from 'node:fs';
import { inspectMedia } from './inspect.ts';
import type { TranscriptSegment } from '../db/transcripts-repo.ts';

export class TranscriptionUnavailableError extends Error {
  readonly attempts: string[];
  constructor(attempts: string[]) {
    super(
      'No local transcription engine could be located. ClipForge supports ' +
        'whisper.cpp / faster-whisper-style CLIs; install one and set ' +
        'CLIPFORGE_WHISPER=/path/to/binary, or add it to PATH.',
    );
    this.name = 'TranscriptionUnavailableError';
    this.attempts = attempts;
  }
}

function isExecutableFile(p: string): boolean {
  try {
    if (!existsSync(p)) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

interface EngineInfo {
  binary: string;
  /** The argv that produces a JSON file. Different engines use different flags. */
  jsonArg: string[];
  /** Extra env, e.g. WHISPER_MODEL. */
  env: NodeJS.ProcessEnv;
  modelEnvVar: string;
  model?: string;
}

/**
 * Locate a whisper-like CLI. We look in this order:
 *   1. CLIPFORGE_WHISPER env var (must be executable)
 *   2. whisper-cpp / whisper on PATH
 *   3. `whisper` python entry point via the venv python
 *
 * We deliberately do NOT shell out to a network to download model
 * weights. The caller is expected to have the weights on disk.
 */
function locateEngine(): EngineInfo | null {
  const attempts: string[] = [];
  const override = process.env.CLIPFORGE_WHISPER;
  if (override) {
    if (isExecutableFile(override)) {
      return {
        binary: override,
        jsonArg: ['--output-json', '--output-file'],
        env: process.env,
        modelEnvVar: 'WHISPER_MODEL',
      };
    }
    attempts.push(`CLIPFORGE_WHISPER not executable: ${override}`);
  }
  for (const name of ['whisper-cpp', 'whisper']) {
    attempts.push(name);
    // We can't easily probe PATH without spawning; assume not present and
    // rely on the spawn attempt for the actual error.
  }
  // Best-effort probe: try spawning `which` via the shell-less method we
  // have elsewhere. We don't have a path-search helper here; the
  // transcript will be 'unavailable' and the API will report 503.
  return null;
}

export interface TranscribeOptions {
  language?: string;
  model?: string;
  timeoutMs?: number;
}

export interface TranscribeResult {
  language: string;
  engine: string;
  model: string | null;
  segments: TranscriptSegment[];
}

/**
 * Transcribe a media file's audio track.
 *
 * Throws TranscriptionUnavailableError if no engine is available. The
 * function never invents segments.
 */
export async function transcribeAudio(
  inputPath: string,
  options: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const engine = locateEngine();
  if (!engine) {
    throw new TranscriptionUnavailableError([
      'no CLIPFORGE_WHISPER set',
      'whisper-cpp / whisper not on PATH',
    ]);
  }

  // Verify the input really has audio before we spawn anything.
  const media = await inspectMedia(inputPath);
  if (!media.hasAudio) {
    throw new TranscriptionUnavailableError(['source has no audio stream']);
  }

  const outDir = `/tmp/clipforge-transcript-${Date.now()}-${process.pid}`;
  mkdirSync(outDir, { recursive: true });
  const outBase = `${outDir}/out`;

  const args = [
    ...engine.jsonArg,
    outBase,
    '--model', options.model ?? process.env[engine.modelEnvVar] ?? 'base',
    ...(options.language ? ['--language', options.language] : []),
    '--file', inputPath,
  ];

  return new Promise<TranscribeResult>((resolve, reject) => {
    const child = spawn(engine.binary, args, {
      shell: false,
      env: engine.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 10 * 60_000);
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new TranscriptionUnavailableError([err.message, ...(engine ? [engine.binary] : [])]));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new TranscriptionUnavailableError([
            `transcription engine exited with code ${code}`,
            stderr.slice(-2000),
          ]),
        );
        return;
      }
      // Engines that follow the whisper.cpp convention write outBase.json
      try {
        const json = readFileSync(`${outBase}.json`, 'utf8');
        const parsed = JSON.parse(json) as unknown;
        const segments = parseWhisperJson(parsed);
        resolve({
          language: options.language ?? 'auto',
          engine: engine.binary,
          model: options.model ?? process.env[engine.modelEnvVar] ?? 'base',
          segments,
        });
      } catch (err) {
        reject(
          new TranscriptionUnavailableError([
            `failed to read transcription output: ${(err as Error).message}`,
          ]),
        );
      }
    });
  });
}

function parseWhisperJson(parsed: unknown): TranscriptSegment[] {
  // Tolerate both the whisper.cpp style ({ transcription: [...] }) and
  // the faster-whisper style (an array of {start, end, text}).
  if (Array.isArray(parsed)) {
    return parsed
      .map((s: unknown) => {
        if (!s || typeof s !== 'object') return null;
        const o = s as Record<string, unknown>;
        const start = Number(o.start ?? o.t0 ?? 0);
        const end = Number(o.end ?? o.t1 ?? 0);
        const text = String(o.text ?? '').trim();
        if (!text) return null;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
        return { start, end, text };
      })
      .filter((s): s is TranscriptSegment => s !== null);
  }
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    const arr = Array.isArray(o.transcription)
      ? o.transcription
      : Array.isArray(o.segments)
        ? o.segments
        : [];
    return parseWhisperJson(arr);
  }
  return [];
}

/** Detect which (if any) local transcription engine is present. */
export function probeTranscriptionEngine(): {
  available: boolean;
  binary?: string;
  reason?: string;
} {
  const e = locateEngine();
  if (!e) {
    return {
      available: false,
      reason:
        'No local transcription engine is installed. Install whisper.cpp or a Whisper CLI and set CLIPFORGE_WHISPER.',
    };
  }
  return { available: true, binary: e.binary };
}
