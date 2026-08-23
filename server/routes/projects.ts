import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_DIR,
  ALLOWED_MIME_PREFIXES,
} from '../config.ts';
import {
  createProject,
  getProject,
  listProjects,
  toDto,
  deleteProject,
} from '../db/projects-repo.ts';
import {
  createClip,
  listClips,
  toDto as clipToDto,
} from '../db/clips-repo.ts';
import { inspectMedia, MediaInspectionError } from '../media/inspect.ts';
import { FfmpegUnavailableError } from '../media/ffmpeg-locator.ts';
import {
  isClipRunning,
  startClipRender,
  jobPayloadForProject,
} from '../jobs/render-queue.ts';
import {
  isValidProjectId,
  hasAllowedVideoExtension,
  sanitizeFilename,
  deriveProjectName,
  uploadPathFor,
  downloadFilenameFor,
} from '../storage/paths.ts';
import { validateClipParams, checkSegmentFitsSource } from '../validation/clip-params.ts';

export const projectsRouter = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    // Server-generated name: the client filename never becomes a real path.
    filename: (_req, file, cb) => {
      const target = uploadPathFor(randomUUID(), file.originalname);
      cb(null, target.split('/').pop()!);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mimeOk = ALLOWED_MIME_PREFIXES.some((p) => (file.mimetype ?? '').startsWith(p));
    const extOk = hasAllowedVideoExtension(file.originalname);
    if (!extOk) {
      cb(new Error('Unsupported file type. Upload an MP4, MOV, M4V, WEBM, MKV or AVI video.'));
      return;
    }
    if (!mimeOk) {
      cb(new Error('Unsupported content type. Please upload a video file.'));
      return;
    }
    cb(null, true);
  },
});

function jobPayload(projectId: string) {
  const job = jobPayloadForProject(projectId);
  if (!job) return null;
  return {
    phase: job.phase,
    progress: job.progress,
    message: job.message,
    detail: job.detail ?? null,
  };
}

/** GET /api/projects */
projectsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ projects: listProjects().map(toDto) });
});

/** GET /api/projects/:id */
projectsRouter.get('/:id', (req: Request, res: Response) => {
  if (!isValidProjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid project id.' });
    return;
  }
  const row = getProject(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const clips = listClips(req.params.id).map(clipToDto);
  res.json({ project: toDto(row), job: jobPayload(row.id), clips });
});

/**
 * POST /api/projects  (multipart: field `video`)
 * Uploads a source video, inspects it and creates the project record.
 */
projectsRouter.post('/', (req: Request, res: Response) => {
  upload.single('video')(req, res, async (err: unknown) => {
    if (err) {
      const message =
        (err as { code?: string }).code === 'LIMIT_FILE_SIZE'
          ? `File is too large. Maximum upload size is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`
          : (err as Error).message;
      res.status(400).json({ error: message });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No video file was provided.' });
      return;
    }

    // Inspect the real file. If it is not decodable video, reject and clean up.
    try {
      const media = await inspectMedia(file.path);
      const originalName = sanitizeFilename(file.originalname);
      const project = createProject({
        name: deriveProjectName(originalName),
        sourceFilename: originalName,
        sourcePath: file.path,
        sourceBytes: file.size,
        media,
      });
      res.status(201).json({ project: toDto(project) });
    } catch (inspectErr) {
      await rm(file.path, { force: true }).catch(() => {});
      if (inspectErr instanceof FfmpegUnavailableError) {
        res.status(503).json({
          error:
            'Video inspection is unavailable because no FFmpeg binary is installed on the server.',
        });
        return;
      }
      if (inspectErr instanceof MediaInspectionError) {
        res.status(400).json({ error: inspectErr.message });
        return;
      }
      res.status(500).json({ error: `Upload failed: ${(inspectErr as Error).message}` });
    }
  });
});

/**
 * POST /api/projects/:id/process  { startSeconds, durationSeconds, aspect, title? }
 *
 * Legacy bridge from the MVP. Creates a clip and starts rendering it, so
 * clients that still call the old endpoint keep working while the new
 * clip-based flow becomes available.
 */
projectsRouter.post('/:id/process', (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidProjectId(id)) {
    res.status(400).json({ error: 'Invalid project id.' });
    return;
  }
  const project = getProject(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  if (isProjectBusy(id)) {
    res.status(409).json({ error: 'This project is already being processed.' });
    return;
  }

  const validation = validateClipParams(req.body);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const { title, startSeconds, durationSeconds, aspect } = validation.value;

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

  const clip = createClip({
    projectId: id,
    title,
    startSeconds,
    durationSeconds,
    aspect,
  });

  try {
    const job = startClipRender({ clipId: clip.id });
    res.status(202).json({
      clip: clipToDto(clip),
      job: {
        phase: job.phase,
        progress: job.progress,
        message: job.message,
        detail: null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Shared handler for streaming the rendered clip (preview + download). */
async function sendOutput(req: Request, res: Response, asAttachment: boolean): Promise<void> {
  const id = req.params.id;
  if (!isValidProjectId(id)) {
    res.status(400).json({ error: 'Invalid project id.' });
    return;
  }
  const project = getProject(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  // Prefer the project's own legacy output, but fall back to its most recent
  // completed clip — this keeps the MVP preview/download working after
  // migrations to the new clip-based model.
  let outputPath = project.output_path;
  if (!outputPath) {
    const completed = listClips(id).find((c) => c.status === 'completed' && c.output_path);
    outputPath = completed?.output_path ?? null;
  }
  if (!outputPath) {
    res.status(404).json({ error: 'No rendered clip is available for this project.' });
    return;
  }

  let size: number;
  try {
    size = (await stat(outputPath)).size;
  } catch {
    res.status(404).json({ error: 'The rendered clip is missing from disk.' });
    return;
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  if (asAttachment) {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${downloadFilenameFor(project.name)}"`,
    );
  }

  // Range support so <video> can seek during preview.
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
    createReadStream(outputPath, { start, end: safeEnd }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', String(size));
  createReadStream(outputPath).pipe(res);
}

projectsRouter.get('/:id/output', (req, res) => void sendOutput(req, res, false));
projectsRouter.get('/:id/download', (req, res) => void sendOutput(req, res, true));

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

function isProjectBusy(projectId: string): boolean {
  for (const c of listClips(projectId)) {
    if (isClipRunning(c.id)) return true;
  }
  return false;
}

/** DELETE /api/projects/:id — removes the record and its files. */
projectsRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidProjectId(id)) {
    res.status(400).json({ error: 'Invalid project id.' });
    return;
  }
  const project = getProject(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  if (isProjectBusy(id)) {
    res.status(409).json({ error: 'Cannot delete a project while it is processing.' });
    return;
  }
  // Remove every clip's rendered output (the DB rows go via FK cascade).
  for (const c of listClips(id)) {
    if (c.output_path) await rm(c.output_path, { force: true }).catch(() => {});
  }
  await rm(project.source_path, { force: true }).catch(() => {});
  if (project.output_path) await rm(project.output_path, { force: true }).catch(() => {});
  deleteProject(id);
  res.status(204).end();
});
