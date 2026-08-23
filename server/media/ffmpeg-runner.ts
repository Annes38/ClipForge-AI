/**
 * Safe FFmpeg process execution.
 *
 * SECURITY: every invocation uses `spawn(binary, argsArray)` with NO shell.
 * Arguments are passed as a real argv array, so filenames containing spaces,
 * quotes, semicolons or `$(...)` are inert data and can never be interpreted
 * as shell syntax. There is no code path that concatenates user input into a
 * command string.
 */
import { spawn } from 'node:child_process';
import { resolveFfmpegPath } from './ffmpeg-locator.ts';

export class FfmpegExecutionError extends Error {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderrTail: string;
  constructor(message: string, exitCode: number | null, signal: NodeJS.Signals | null, stderrTail: string) {
    super(message);
    this.name = 'FfmpegExecutionError';
    this.exitCode = exitCode;
    this.signal = signal;
    this.stderrTail = stderrTail;
  }
}

export interface FfmpegRunResult {
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  /** Milliseconds before the process is killed. Default 10 minutes. */
  timeoutMs?: number;
  /** Called with each chunk of stderr (FFmpeg writes progress there). */
  onStderr?: (chunk: string) => void;
  /** Treat a non-zero exit as success (used by probing, where ffmpeg exits 1). */
  allowNonZeroExit?: boolean;
}

const MAX_STDERR_CHARS = 256 * 1024;

function tail(text: string, n = 4000): string {
  return text.length <= n ? text : text.slice(-n);
}

/**
 * Run the verified FFmpeg binary with an explicit argument array.
 * Never uses a shell.
 */
export function runFfmpeg(args: string[], options: RunOptions = {}): Promise<FfmpegRunResult> {
  const { timeoutMs = 10 * 60_000, onStderr, allowNonZeroExit = false } = options;

  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    return Promise.reject(new TypeError('FFmpeg arguments must be an array of strings'));
  }

  const binary = resolveFfmpegPath();

  return new Promise<FfmpegRunResult>((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false, // explicit: no shell interpretation, ever
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });

    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_STDERR_CHARS) stderr += chunk;
      onStderr?.(chunk);
    });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.on('error', (err) => {
      finish(() =>
        reject(
          new FfmpegExecutionError(
            `Failed to start FFmpeg: ${err.message}`,
            null,
            null,
            tail(stderr),
          ),
        ),
      );
    });

    child.on('close', (code, signal) => {
      finish(() => {
        if (timedOut) {
          reject(
            new FfmpegExecutionError(
              `FFmpeg timed out after ${timeoutMs}ms and was terminated`,
              code,
              signal,
              tail(stderr),
            ),
          );
          return;
        }
        if (code === 0 || allowNonZeroExit) {
          resolve({ stderr, exitCode: code ?? -1 });
          return;
        }
        reject(
          new FfmpegExecutionError(
            `FFmpeg exited with code ${code}${signal ? ` (signal ${signal})` : ''}`,
            code,
            signal,
            tail(stderr),
          ),
        );
      });
    });
  });
}
