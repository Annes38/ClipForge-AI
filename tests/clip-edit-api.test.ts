/**
 * Tests for clip editing endpoints: PATCH /api/clips/:id, duplicate,
 * title-only edit, and re-render flow.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { rmSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Application } from 'express';

const dataDir = mkdtempSync(path.join(tmpdir(), 'clipforge-edit-'));
process.env.CLIPFORGE_DATA_DIR = dataDir;
process.env.CLIPFORGE_DB = path.join(dataDir, 'clipforge.db');
process.env.PORT = '0';
process.env.CLIPFORGE_START = '0';

const { createApp } = await import('../server/index.ts');
const { runFfmpeg } = await import('../server/media/ffmpeg-runner.ts');
const { probeFfmpeg } = await import('../server/media/ffmpeg-locator.ts');

const ffmpeg = probeFfmpeg();
if (!ffmpeg.available) {
  throw new Error(
    `FFmpeg is required for the edit tests but is unavailable: ${ffmpeg.reason}. ` +
      'Run `npm run setup:ffmpeg`.',
  );
}

let server: Server | null = null;
let baseUrl = '';

const app: Application = createApp();

test.after(() => {
  if (server) {
    server.close();
    server = null;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

async function api<T = unknown>(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const init: RequestInit = { method };
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body;
    } else {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  init.headers = headers;
  const res = await fetch(`${baseUrl}${urlPath}`, init);
  const text = await res.text();
  let parsed: T = undefined as T;
  if (text) {
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      parsed = text as T;
    }
  }
  return { status: res.status, body: parsed };
}

async function makeSource(): Promise<string> {
  const out = path.join(dataDir, 'source.mp4');
  await runFfmpeg([
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:size=320x240:rate=15:duration=8',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
    '-filter_complex',
      '[0:v]format=yuv420p[v];[1:a]aresample=44100[a]',
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-shortest', '-r', '15',
    out,
  ]);
  return out;
}

async function upload(): Promise<string> {
  const localSrc = await makeSource();
  const form = new FormData();
  form.append('video', new Blob([readFileSync(localSrc)], { type: 'video/mp4' }), 'src.mp4');
  const r = await api<{ project: { id: string } }>('POST', '/api/projects', form);
  assert.equal(r.status, 201);
  return r.body.project.id;
}

async function createClip(projectId: string, opts: {
  title?: string;
  startSeconds?: number;
  durationSeconds?: number;
  aspect?: 'vertical' | 'source';
} = {}): Promise<{ id: string }> {
  const r = await api<{ clip: { id: string } }>('POST', `/api/projects/${projectId}/clips`, {
    title: opts.title ?? 'clip',
    startSeconds: opts.startSeconds ?? 0,
    durationSeconds: opts.durationSeconds ?? 2,
    aspect: opts.aspect ?? 'vertical',
  });
  assert.equal(r.status, 201);
  return r.body.clip;
}

async function pollClip(
  clipId: string,
  timeoutMs = 60_000,
): Promise<{ status: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await api<{ clip: { status: string } }>('GET', `/api/clips/${clipId}`);
    if (r.body.clip.status === 'completed' || r.body.clip.status === 'failed') {
      return r.body.clip;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`clip ${clipId} did not complete within ${timeoutMs}ms`);
}

/* ---------------- PATCH title-only ---------------- */

test('PATCH /api/clips/:id can change the title without re-rendering', async () => {
  const projectId = await upload();
  const c = await createClip(projectId, { title: 'Original' });
  await pollClip(c.id);

  const r = await api<{ clip: { title: string; status: string; hasOutput: boolean } }>(
    'PATCH',
    `/api/clips/${c.id}`,
    { title: 'Renamed', startSeconds: 0, durationSeconds: 2, aspect: 'vertical' },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.clip.title, 'Renamed');
  // Title-only should keep the output (no render params changed).
  assert.equal(r.body.clip.hasOutput, true);
});

test('PATCH /api/clips/:id rejects an empty title', async () => {
  const projectId = await upload();
  const c = await createClip(projectId);
  await pollClip(c.id);
  const r = await api('PATCH', `/api/clips/${c.id}`, {
    title: '   ',
    startSeconds: 0,
    durationSeconds: 2,
    aspect: 'vertical',
  });
  assert.equal(r.status, 400);
});

/* ---------------- PATCH trim changes ---------------- */

test('PATCH /api/clips/:id with a new trim invalidates the previous output', async () => {
  const projectId = await upload();
  const c = await createClip(projectId, {
    startSeconds: 0,
    durationSeconds: 1,
  });
  await pollClip(c.id);
  // Confirm output exists.
  const head1 = await fetch(`${baseUrl}/api/clips/${c.id}/output`);
  assert.equal(head1.status, 200);

  const r = await api<{ clip: { status: string; hasOutput: boolean } }>(
    'PATCH',
    `/api/clips/${c.id}`,
    {
      title: 'clip',
      startSeconds: 2,
      durationSeconds: 2,
      aspect: 'vertical',
    },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Output was invalidated.
  assert.equal(r.body.clip.status, 'pending');
  assert.equal(r.body.clip.hasOutput, false);
});

test('PATCH /api/clips/:id?render=1 updates and renders in one call', async () => {
  const projectId = await upload();
  const c = await createClip(projectId, {
    startSeconds: 0,
    durationSeconds: 1,
  });
  await pollClip(c.id);

  const r = await api<{ clip: { status: string; hasOutput: boolean }; job: { phase: string } }>(
    'PATCH',
    `/api/clips/${c.id}?render=1`,
    {
      title: 'clip',
      startSeconds: 1,
      durationSeconds: 2,
      aspect: 'vertical',
    },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.job, 'expected a job to be started');
  await pollClip(c.id);
  // After polling, the new output must exist.
  const head = await fetch(`${baseUrl}/api/clips/${c.id}/output`);
  assert.equal(head.status, 200);
});

test('PATCH /api/clips/:id rejects an out-of-range segment', async () => {
  const projectId = await upload();
  const c = await createClip(projectId);
  await pollClip(c.id);
  const r = await api('PATCH', `/api/clips/${c.id}`, {
    title: 'clip',
    startSeconds: 6,
    durationSeconds: 10,
    aspect: 'vertical',
  });
  assert.equal(r.status, 400);
});

test('PATCH /api/clips/:id rejects an invalid aspect', async () => {
  const projectId = await upload();
  const c = await createClip(projectId);
  await pollClip(c.id);
  const r = await api('PATCH', `/api/clips/${c.id}`, {
    title: 'clip',
    startSeconds: 0,
    durationSeconds: 2,
    aspect: '4:3',
  });
  assert.equal(r.status, 400);
});

test('PATCH /api/clips/:id rejects a non-UUID id', async () => {
  const r = await api('PATCH', '/api/clips/not-a-uuid', {
    title: 'x',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(r.status, 400);
});

test('PATCH /api/clips/:id returns 404 for a missing clip', async () => {
  const r = await api('PATCH', '/api/clips/11111111-1111-1111-1111-111111111111', {
    title: 'x',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(r.status, 404);
});

/* ---------------- Duplicate ---------------- */

test('POST /api/clips/:id/duplicate creates a new pending clip with the same trim', async () => {
  const projectId = await upload();
  const c = await createClip(projectId, {
    title: 'orig',
    startSeconds: 1,
    durationSeconds: 2,
  });
  await pollClip(c.id);

  const r = await api<{ clip: { id: string; title: string; startSeconds: number; durationSeconds: number; aspect: string; status: string } }>(
    'POST',
    `/api/clips/${c.id}/duplicate`,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.notEqual(r.body.clip.id, c.id);
  assert.equal(r.body.clip.startSeconds, 1);
  assert.equal(r.body.clip.durationSeconds, 2);
  assert.equal(r.body.clip.aspect, 'vertical');
  assert.equal(r.body.clip.status, 'pending');
  assert.match(r.body.clip.title, /orig/);
});

test('POST /api/clips/:id/duplicate returns 404 for a missing clip', async () => {
  const r = await api('POST', '/api/clips/11111111-1111-1111-1111-111111111111/duplicate');
  assert.equal(r.status, 404);
});

test('POST /api/clips/:id/duplicate returns 400 for a non-UUID id', async () => {
  const r = await api('POST', '/api/clips/not-a-uuid/duplicate');
  assert.equal(r.status, 400);
});

/* ---------------- Original render endpoint still works ---------------- */

test('POST /api/clips/:id/render still works after the PATCH changes', async () => {
  const projectId = await upload();
  const c = await createClip(projectId);
  await pollClip(c.id);
  const r = await api<{ job: { phase: string } }>('POST', `/api/clips/${c.id}/render`);
  assert.equal(r.status, 202);
  assert.ok(r.body.job);
  await pollClip(c.id);
});
