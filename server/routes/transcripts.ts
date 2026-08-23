/**
 * Transcript API routes.
 *
 *   GET  /api/projects/:id/transcript       get the project's transcript
 *   POST /api/projects/:id/transcript       run transcription (or return 503)
 *   DELETE /api/projects/:id/transcript     remove the cached transcript
 *
 * When no local engine is installed, every call responds with 503 and a
 * helpful message. The capability endpoint reports the same state.
 */
import { Router, type Request, type Response } from 'express';
import { getProject } from '../db/projects-repo.ts';
import {
  getTranscript,
  upsertTranscript,
  deleteTranscript,
} from '../db/transcripts-repo.ts';
import {
  transcribeAudio,
  probeTranscriptionEngine,
  TranscriptionUnavailableError,
} from '../media/transcriber.ts';
import { isValidProjectId } from '../storage/paths.ts';

export const transcriptsRouter = Router();

/** GET /api/projects/:id/transcript */
transcriptsRouter.get('/projects/:id/transcript', (req: Request, res: Response) => {
  if (!isValidProjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid project id.' });
    return;
  }
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const existing = getTranscript(req.params.id);
  if (existing) {
    res.json({ transcript: existing });
    return;
  }
  // No row yet. Report the engine status so the UI can show a
  // meaningful empty state.
  const probe = probeTranscriptionEngine();
  res.json({
    transcript: {
      projectId: req.params.id,
      status: probe.available ? 'pending' : 'unavailable',
      language: null,
      engine: null,
      model: null,
      segmentCount: 0,
      errorMessage: probe.available ? null : (probe.reason ?? null),
      segments: [],
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    },
  });
});

/** POST /api/projects/:id/transcript — run (or re-run) transcription. */
transcriptsRouter.post('/projects/:id/transcript', async (req: Request, res: Response) => {
  if (!isValidProjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid project id.' });
    return;
  }
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : undefined;
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;

  // Mark running.
  upsertTranscript({
    projectId: req.params.id,
    status: 'running',
    language: language ?? null,
    errorMessage: null,
  });

  try {
    const result = await transcribeAudio(project.source_path, { language, model });
    const dto = upsertTranscript({
      projectId: req.params.id,
      status: 'completed',
      language: result.language,
      engine: result.engine,
      model: result.model,
      segmentCount: result.segments.length,
      segments: result.segments,
    });
    res.json({ transcript: dto });
  } catch (err) {
    const isUnavailable =
      err instanceof TranscriptionUnavailableError ||
      (err as { name?: string }).name === 'TranscriptionUnavailableError';
    if (isUnavailable) {
      const dto = upsertTranscript({
        projectId: req.params.id,
        status: 'unavailable',
        errorMessage: (err as Error).message,
        segments: [],
      });
      res.status(503).json({
        error: (err as Error).message,
        transcript: dto,
      });
      return;
    }
    upsertTranscript({
      projectId: req.params.id,
      status: 'failed',
      errorMessage: (err as Error).message,
      segments: [],
    });
    res.status(500).json({ error: `Transcription failed: ${(err as Error).message}` });
  }
});

/** DELETE /api/projects/:id/transcript — clear the cached transcript. */
transcriptsRouter.delete('/projects/:id/transcript', (req: Request, res: Response) => {
  if (!isValidProjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid project id.' });
    return;
  }
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  deleteTranscript(req.params.id);
  res.status(204).end();
});
