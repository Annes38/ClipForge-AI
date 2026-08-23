/**
 * In-process render job tracker.
 *
 * Progress reporting is REAL: it comes from FFmpeg's own `time=` output
 * divided by the clip duration we asked for. When we cannot compute a
 * meaningful ratio we report `null` and the UI shows an indeterminate state
 * rather than inventing a percentage.
 */
import { renderClip, ClipRenderError, type AspectMode } from '../media/clip-renderer.ts';
import { FfmpegUnavailableError } from '../media/ffmpeg-locator.ts';
import { getProject, setStatus, setOutput } from '../db/projects-repo.ts';
import { outputPathFor } from '../storage/paths.ts';

export interface JobState {
  projectId: string;
  phase: 'preparing' | 'processing' | 'completed' | 'failed';
  /** 0..1, or null when FFmpeg has not reported usable timing yet. */
  progress: number | null;
  message: string;
  detail?: string;
}

const jobs = new Map<string, JobState>();

export function getJob(projectId: string): JobState | null {
  return jobs.get(projectId) ?? null;
}

export function isRunning(projectId: string): boolean {
  const j = jobs.get(projectId);
  return j?.phase === 'preparing' || j?.phase === 'processing';
}

export interface StartRenderOptions {
  projectId: string;
  startSeconds: number;
  durationSeconds: number;
  aspect: AspectMode;
}

/** Kick off a render. Returns immediately; poll the project/job for status. */
export function startRender(opts: StartRenderOptions): JobState {
  const { projectId, startSeconds, durationSeconds, aspect } = opts;

  const project = getProject(projectId);
  if (!project) throw new Error('Project not found.');
  if (isRunning(projectId)) return jobs.get(projectId)!;

  const state: JobState = {
    projectId,
    phase: 'preparing',
    progress: null,
    message: 'Preparing render…',
  };
  jobs.set(projectId, state);
  setStatus(projectId, 'preparing');

  const outputPath = outputPathFor(projectId);

  void (async () => {
    try {
      state.phase = 'processing';
      state.message = 'Processing video…';
      setStatus(projectId, 'processing');

      const result = await renderClip({
        inputPath: project.source_path,
        outputPath,
        startSeconds,
        durationSeconds,
        aspect,
        onProgress: (encodedSeconds) => {
          if (durationSeconds > 0) {
            state.progress = Math.max(0, Math.min(1, encodedSeconds / durationSeconds));
          }
        },
      });

      setOutput(projectId, result.outputPath, {
        width: result.info.width,
        height: result.info.height,
        durationSeconds: result.info.durationSeconds,
        bytes: result.bytes,
        audioPreserved: result.audioPreserved,
      });

      state.phase = 'completed';
      state.progress = 1;
      state.message = 'Clip ready.';
    } catch (err) {
      state.phase = 'failed';
      state.progress = null;

      if (err instanceof FfmpegUnavailableError) {
        state.message = 'Video processing is unavailable: no FFmpeg binary is installed.';
        state.detail = 'Run `npm run setup:ffmpeg` on the server.';
      } else if (err instanceof ClipRenderError) {
        state.message = err.message;
        if (err.detail) state.detail = err.detail;
      } else {
        state.message = `Unexpected processing error: ${(err as Error).message}`;
      }
      setStatus(projectId, 'failed', state.message);
    }
  })();

  return state;
}
