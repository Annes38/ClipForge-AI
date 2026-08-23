/**
 * In-process render job tracker for CLIPS.
 *
 * Progress reporting is REAL: it comes from FFmpeg's own `time=` output
 * divided by the clip duration we asked for. When we cannot compute a
 * meaningful ratio we report `null` and the UI shows an indeterminate state
 * rather than inventing a percentage.
 *
 * A job is keyed by clip id (not project id), because each clip is an
 * independent render. Multiple clips of the same project can be processed
 * sequentially — we don't fan them out concurrently in this phase.
 */
import { renderClip, ClipRenderError, type AspectMode } from '../media/clip-renderer.ts';
import { FfmpegUnavailableError } from '../media/ffmpeg-locator.ts';
import { getProject } from '../db/projects-repo.ts';
import {
  getClip,
  setClipStatus,
  setClipOutput,
  setClipMedia,
} from '../db/clips-repo.ts';
import { clipOutputPathFor, isValidClipId } from '../storage/paths.ts';

export type JobPhase = 'preparing' | 'processing' | 'completed' | 'failed';

export interface ClipJobState {
  clipId: string;
  projectId: string;
  phase: JobPhase;
  /** 0..1, or null when FFmpeg has not reported usable timing yet. */
  progress: number | null;
  message: string;
  detail?: string;
}

const jobs = new Map<string, ClipJobState>();

export function getClipJob(clipId: string): ClipJobState | null {
  return jobs.get(clipId) ?? null;
}

export function isClipRunning(clipId: string): boolean {
  const j = jobs.get(clipId);
  return j?.phase === 'preparing' || j?.phase === 'processing';
}

export interface StartClipRenderOptions {
  clipId: string;
}

/** Kick off a render for an already-persisted clip. */
export function startClipRender(opts: StartClipRenderOptions): ClipJobState {
  const { clipId } = opts;
  if (!isValidClipId(clipId)) {
    throw new Error('Invalid clip id.');
  }
  const clip = getClip(clipId);
  if (!clip) {
    throw new Error('Clip not found.');
  }
  const project = getProject(clip.project_id);
  if (!project) {
    throw new Error('Project not found.');
  }

  if (isClipRunning(clipId)) return jobs.get(clipId)!;

  const state: ClipJobState = {
    clipId,
    projectId: clip.project_id,
    phase: 'preparing',
    progress: null,
    message: 'Preparing render…',
  };
  jobs.set(clipId, state);
  setClipStatus(clipId, 'pending');

  const outputPath = clipOutputPathFor(clipId);

  void (async () => {
    try {
      state.phase = 'processing';
      state.message = 'Processing video…';
      setClipStatus(clipId, 'processing');

      const result = await renderClip({
        inputPath: project.source_path,
        outputPath,
        startSeconds: clip.start_seconds,
        durationSeconds: clip.duration_seconds,
        aspect: clip.aspect as AspectMode,
        onProgress: (encodedSeconds) => {
          if (clip.duration_seconds > 0) {
            state.progress = Math.max(
              0,
              Math.min(1, encodedSeconds / clip.duration_seconds),
            );
          }
        },
      });

      setClipMedia(clipId, result.info);
      setClipOutput(clipId, result.outputPath, {
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
      setClipStatus(clipId, 'failed', state.message);
    }
  })();

  return state;
}

/** Convenience for tests and the legacy bridge: project-level "is anything rendering". */
export function isProjectRendering(projectId: string): boolean {
  for (const j of jobs.values()) {
    if (j.projectId === projectId && (j.phase === 'preparing' || j.phase === 'processing')) {
      return true;
    }
  }
  return false;
}

/** Job payload for a project, derived from any in-flight clip. */
export function jobPayloadForProject(projectId: string): ClipJobState | null {
  for (const j of jobs.values()) {
    if (j.projectId !== projectId) continue;
    if (j.phase !== 'preparing' && j.phase !== 'processing') continue;
    return j;
  }
  return null;
}
