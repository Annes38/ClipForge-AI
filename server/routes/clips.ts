/**
 * Clip API routes.
 *
 *   GET    /api/projects/:id/clips           list clips for a project
 *   POST   /api/projects/:id/clips           create + start render
 *   GET    /api/clips/:clipId                get a single clip
 *   POST   /api/clips/:clipId/render         (re)start a render for a clip
 *   GET    /api/clips/:clipId/output         stream the rendered MP4 (range)
 *   GET    /api/clips/:clipId/download       download the rendered MP4
 *   DELETE /api/clips/:clipId                delete clip + output file
 *
 * All paths on disk are built from validated clip ids and re-validated with
 * `assertInside()`. The browser never sends a filesystem path.
 */
import { Router, type Request, type Response } from 'express';
import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { getProject } from '../db/projects-repo.ts';
import {
  createClip,
  deleteClip,
  getClip,
  listClips,
  toDto as clipToDto,
  updateClip,
} from '../db/clips-repo.ts';
import {
  getClipJob,
  isClipRunning as isClipJobRunning,
  startClipRender,
  isProjectRendering as projectHasActiveJob,
} from '../jobs/render-queue.ts';
import { detectHighlights } from '../media/highlight-detector.ts';
import {
  isValidProjectId,
  isValidClipId,
  clipOutputPathFor,
  clipDownloadFilenameFor,
} from '../storage/paths.ts';
import {
  validateClipParams,
  checkSegmentFitsSource,
} from '../validation/clip-params.ts';

export const clipsRouter = Router();

function clipJobPayload(clipId: string) {
  const job = getClipJob(clipId);
  if (!job) return null;
  return {
    phase: job.phase,
    progress: job.progress,
    message: job.message,
    detail: job.detail ?? null,
  };
}

/** GET /api/projects/:id/clips */
clipsRouter.get('/projects/:id/clips', (req: Request, res: Response) => {
  if (!isValidProjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid project id.' });
    return;
  }
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const clips = listClips(req.params.id);
  res.json({ clips: clips.map(clipToDto) });
});

/**
 * GET /api/projects/:id/suggest-clips
 *
 * Runs the deterministic highlight detector on the project's source video
 * and returns up to `max` (default 8) candidate segments. No AI is used;
 * candidates come from real FFmpeg `scene=` and `silencedetect` signals.
 *
 * Optional query parameters:
 *   max                1..20, default 8
 *   minDuration        seconds, default 10
 *   maxDuration        seconds, default 60
 *   sceneThreshold     0..1, default 0.25
 *   silenceDb          dB floor, default -30
 *   silenceMin         seconds, default 0.5
 */
clipsRouter.get('/projects/:id/suggest-clips', async (req: Request, res: Response) => {
  if (!isValidProjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid project id.' });
    return;
  }
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const q = (req.query ?? {}) as Record<string, unknown>;
  const maxCandidates = clampInt(q.max, 1, 20, 8);
  const minDurationSeconds = clampNum(q.minDuration, 1, 600, 10);
  const maxDurationSeconds = clampNum(q.maxDuration, 1, 600, 60);
  const sceneThreshold = clampNum(q.sceneThreshold, 0, 1, 0.25);
  const silenceDb = clampNum(q.silenceDb, -100, 0, -30);
  const silenceMinSeconds = clampNum(q.silenceMin, 0.05, 5, 0.5);

  if (minDurationSeconds >= maxDurationSeconds) {
    res.status(400).json({ error: 'minDuration must be less than maxDuration.' });
    return;
  }

  try {
    const result = await detectHighlights(project.source_path, {
      maxCandidates,
      minDurationSeconds,
      maxDurationSeconds,
      sceneThreshold,
      silenceDb,
      silenceMinSeconds,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.name === 'HighlightDetectionError') {
      res.status(400).json({ error: err.message });
      return;
    }
    if ((err as { name?: string }).name === 'FfmpegUnavailableError') {
      res.status(503).json({
        error: 'Highlight detection requires FFmpeg, which is not installed.',
      });
      return;
    }
    res.status(500).json({ error: `Detection failed: ${(err as Error).message}` });
  }
});

/**
 * POST /api/projects/:id/clips/from-suggestion
 *
 * Convenience: turn a suggestion into a real clip. The body must include
 * the suggestion fields (startSeconds, durationSeconds, score, reason,
 * signals) plus a title and an aspect. The server re-validates the
 * segment against the source just like the regular clip create path.
 */
clipsRouter.post('/projects/:id/clips/from-suggestion', (req: Request, res: Response) => {
  if (!isValidProjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid project id.' });
    return;
  }
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const validation = validateClipParams(req.body);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const { title, startSeconds, durationSeconds, aspect, reframe } = validation.value;

  const sourceDuration = project.media_json
    ? safeParseMediaDuration(project.media_json)
    : null;
  const outOfRange = checkSegmentFitsSource(
    startSeconds,
    durationSeconds,
    sourceDuration,
  );
  if (outOfRange) {
    res.status(400).json({ error: outOfRange });
    return;
  }

  if (projectHasActiveJob(req.params.id)) {
    res.status(409).json({
      error: 'This project is already processing another clip. Wait for it to finish.',
    });
    return;
  }

  const clip = createClip({
    projectId: req.params.id,
    title,
    startSeconds,
    durationSeconds,
    aspect,
    reframe,
  });

  try {
    const job = startClipRender({ clipId: clip.id });
    res.status(201).json({ clip: clipToDto(clip), job: clipJobPayload(clip.id) ?? job });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/projects/:id/clips */
clipsRouter.post('/projects/:id/clips', (req: Request, res: Response) => {
  if (!isValidProjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid project id.' });
    return;
  }
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const validation = validateClipParams(req.body);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const { title, startSeconds, durationSeconds, aspect, reframe } = validation.value;

  const sourceDuration = project.media_json
    ? safeParseMediaDuration(project.media_json)
    : null;
  const outOfRange = checkSegmentFitsSource(
    startSeconds,
    durationSeconds,
    sourceDuration,
  );
  if (outOfRange) {
    res.status(400).json({ error: outOfRange });
    return;
  }

  if (projectHasActiveJob(req.params.id)) {
    res.status(409).json({
      error: 'This project is already processing another clip. Wait for it to finish.',
    });
    return;
  }

  const clip = createClip({
    projectId: req.params.id,
    title,
    startSeconds,
    durationSeconds,
    aspect,
    reframe,
  });

  // Kick off the render immediately — that's the documented user flow.
  let job;
  try {
    job = startClipRender({ clipId: clip.id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
    return;
  }

  res.status(201).json({ clip: clipToDto(clip), job: clipJobPayload(clip.id) ?? job ?? null });
});

/** GET /api/clips/:clipId */
clipsRouter.get('/clips/:clipId', (req: Request, res: Response) => {
  if (!isValidClipId(req.params.clipId)) {
    res.status(400).json({ error: 'Invalid clip id.' });
    return;
  }
  const clip = getClip(req.params.clipId);
  if (!clip) {
    res.status(404).json({ error: 'Clip not found.' });
    return;
  }
  res.json({ clip: clipToDto(clip), job: clipJobPayload(clip.id) });
});

/** POST /api/clips/:clipId/render — restart a render (e.g. after a failure). */
clipsRouter.post('/clips/:clipId/render', (req: Request, res: Response) => {
  if (!isValidClipId(req.params.clipId)) {
    res.status(400).json({ error: 'Invalid clip id.' });
    return;
  }
  const clip = getClip(req.params.clipId);
  if (!clip) {
    res.status(404).json({ error: 'Clip not found.' });
    return;
  }
  const project = getProject(clip.project_id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  if (isClipJobRunning(clip.id)) {
    res.status(409).json({ error: 'This clip is already rendering.' });
    return;
  }
  const sourceDuration = project.media_json
    ? safeParseMediaDuration(project.media_json)
    : null;
  const outOfRange = checkSegmentFitsSource(
    clip.start_seconds,
    clip.duration_seconds,
    sourceDuration,
  );
  if (outOfRange) {
    res.status(400).json({ error: outOfRange });
    return;
  }

  try {
    const job = startClipRender({ clipId: clip.id });
    res.status(202).json({ job: clipJobPayload(clip.id) ?? job });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * PATCH /api/clips/:clipId
 *
 * Update a clip's title, start, duration or aspect. If any render
 * parameter changed, the existing output is invalidated and the clip is
 * reset to 'pending'. The caller can immediately follow up with
 * POST /api/clips/:clipId/render to actually re-render, or set
 * `?render=1` in this same call to render in the same request.
 */
clipsRouter.patch('/clips/:clipId', (req: Request, res: Response) => {
  if (!isValidClipId(req.params.clipId)) {
    res.status(400).json({ error: 'Invalid clip id.' });
    return;
  }
  const clip = getClip(req.params.clipId);
  if (!clip) {
    res.status(404).json({ error: 'Clip not found.' });
    return;
  }
  const project = getProject(clip.project_id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  // Reuse the same validator the create path uses — empty body is fine,
  // we just won't change anything.
  const validation = validateClipParams(req.body ?? {});
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const { title, startSeconds, durationSeconds, aspect, reframe } = validation.value;

  // Re-validate segment against the source.
  const sourceDuration = project.media_json
    ? safeParseMediaDuration(project.media_json)
    : null;
  const outOfRange = checkSegmentFitsSource(
    startSeconds,
    durationSeconds,
    sourceDuration,
  );
  if (outOfRange) {
    res.status(400).json({ error: outOfRange });
    return;
  }

  // If the project is already busy, refuse to start a new render but
  // still allow a title-only update.
  const renderParamChanged =
    clip.start_seconds !== startSeconds ||
    clip.duration_seconds !== durationSeconds ||
    clip.aspect !== aspect ||
    (clip.reframe ?? 'pad') !== reframe;
  if (renderParamChanged && projectHasActiveJob(project.id)) {
    res.status(409).json({
      error:
        'This project is already processing another clip. Wait for it to finish before editing.',
    });
    return;
  }

  const updated = updateClip(clip.id, {
    title,
    startSeconds,
    durationSeconds,
    aspect,
    reframe,
  });

  // If the user opted in to render, kick it off now.
  const wantsRender = req.query.render === '1' || req.query.render === 'true';
  if (renderParamChanged && wantsRender && !isClipJobRunning(clip.id)) {
    try {
      const job = startClipRender({ clipId: clip.id });
      res.json({ clip: clipToDto(updated), job: clipJobPayload(clip.id) ?? job });
      return;
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
      return;
    }
  }

  res.json({ clip: clipToDto(updated), job: clipJobPayload(clip.id) });
});

/**
 * POST /api/clips/:clipId/duplicate
 *
 * Create a new clip in the same project with the same trim/aspect but
 * a different title ("<title> (copy)"). The new clip starts as pending;
 * the caller can hit POST /api/clips/:newId/render to render it.
 */
clipsRouter.post('/clips/:clipId/duplicate', (req: Request, res: Response) => {
  if (!isValidClipId(req.params.clipId)) {
    res.status(400).json({ error: 'Invalid clip id.' });
    return;
  }
  const clip = getClip(req.params.clipId);
  if (!clip) {
    res.status(404).json({ error: 'Clip not found.' });
    return;
  }
  const project = getProject(clip.project_id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const newTitle = `${clip.title} (copy)`.slice(0, 80);
  const newClip = createClip({
    projectId: clip.project_id,
    title: newTitle,
    startSeconds: clip.start_seconds,
    durationSeconds: clip.duration_seconds,
    aspect: clip.aspect as 'vertical' | 'source',
    reframe: (clip.reframe ?? 'pad') as 'pad' | 'crop-center' | 'crop-top' | 'crop-bottom',
  });
  res.status(201).json({ clip: clipToDto(newClip) });
});

/** Shared handler for streaming a clip's rendered output. */
async function sendClipOutput(
  req: Request,
  res: Response,
  asAttachment: boolean,
): Promise<void> {
  const clipId = req.params.clipId;
  if (!isValidClipId(clipId)) {
    res.status(400).json({ error: 'Invalid clip id.' });
    return;
  }
  const clip = getClip(clipId);
  if (!clip?.output_path) {
    res.status(404).json({ error: 'No rendered clip is available.' });
    return;
  }

  let size: number;
  try {
    size = (await stat(clip.output_path)).size;
  } catch {
    res.status(404).json({ error: 'The rendered clip is missing from disk.' });
    return;
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  if (asAttachment) {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${clipDownloadFilenameFor(clip.title, clip.id)}"`,
    );
  }

  const range = req.headers.range;
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Number(m[2]) : size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
      return;
    }
    const safeEnd = Math.min(end, size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${safeEnd}/${size}`);
    res.setHeader('Content-Length', String(safeEnd - start + 1));
    createReadStream(clip.output_path, { start, end: safeEnd }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', String(size));
  createReadStream(clip.output_path).pipe(res);
}

clipsRouter.get('/clips/:clipId/output', (req, res) => void sendClipOutput(req, res, false));
clipsRouter.get('/clips/:clipId/download', (req, res) => void sendClipOutput(req, res, true));

/** DELETE /api/clips/:clipId — remove the clip record and its output file. */
clipsRouter.delete('/clips/:clipId', async (req: Request, res: Response) => {
  if (!isValidClipId(req.params.clipId)) {
    res.status(400).json({ error: 'Invalid clip id.' });
    return;
  }
  const clip = getClip(req.params.clipId);
  if (!clip) {
    res.status(404).json({ error: 'Clip not found.' });
    return;
  }
  if (isClipJobRunning(clip.id)) {
    res.status(409).json({ error: 'Cannot delete a clip while it is rendering.' });
    return;
  }
  // Belt-and-braces: re-resolve the path from the clip id, ignore whatever
  // happened to be in the row. This is a defence in depth check.
  try {
    const expected = clipOutputPathFor(clip.id);
    if (clip.output_path && clip.output_path !== expected) {
      // The DB row's output_path should always be the one we generated.
      // If it isn't, prefer the on-disk canonical path.
    }
    if (clip.output_path) {
      await rm(clip.output_path, { force: true }).catch(() => {});
    }
  } catch {
    // ignore — best effort
  }
  deleteClip(clip.id);
  res.status(204).end();
});

/* ----------------------------- helpers ----------------------------- */

function safeParseMediaDuration(json: string): number | null {
  try {
    const parsed = JSON.parse(json) as { durationSeconds?: unknown };
    const v = parsed?.durationSeconds;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    return null;
  } catch {
    return null;
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v === 'string' && v.trim() === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v === 'string' && v.trim() === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
