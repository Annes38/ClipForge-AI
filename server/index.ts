import express from 'express';
import { API_PORT, ensureDirectories } from './config.ts';
import { getDb } from './db/database.ts';
import { projectsRouter } from './routes/projects.ts';
import { capabilitiesRouter } from './routes/capabilities.ts';
import { probeFfmpeg } from './media/ffmpeg-locator.ts';

export function createApp(): express.Express {
  ensureDirectories();
  getDb();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/capabilities', capabilitiesRouter);
  app.use('/api/projects', projectsRouter);

  // JSON 404 for unknown API routes (avoids HTML error pages reaching fetch()).
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));

  return app;
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);

if (isDirectRun || process.env.CLIPFORGE_START === '1') {
  const app = createApp();
  app.listen(API_PORT, '0.0.0.0', () => {
    const ff = probeFfmpeg();
    console.log(`[clipforge] API listening on http://0.0.0.0:${API_PORT}`);
    console.log(
      ff.available
        ? `[clipforge] FFmpeg: ${ff.version} (imageio-ffmpeg)`
        : `[clipforge] FFmpeg UNAVAILABLE: ${ff.reason}`,
    );
  });
}
