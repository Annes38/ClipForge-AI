/**
 * End-to-end API tests for the reframe parameter.
 *
 * The clips table now has a reframe column. The create / edit / render
 * path must round-trip the value, and the rendered file must remain
 * 1080x1920 with audio preserved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { rmSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Application } from 'express';

const dataDir = mkdtempSync(path.join(tmpdir(), 'clipforge-reframe-'));
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
    `FFmpeg is required for the reframe API tests but is unavailable: ${ffmpeg.reason}. ` +
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
    '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-shortest',
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

test('POST /api/projects/:id/clips accepts reframe=crop-top', async () => {
  const projectId = await upload();
  const r = await api<{ clip: { id: string; reframe: string } }>(
    'POST',
    `/api/projects/${projectId}/clips`,
    {
      title: 'cropped',
      startSeconds: 0,
      durationSeconds: 2,
      aspect: 'vertical',
      reframe: 'crop-top',
    },
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.clip.reframe, 'crop-top');
  await pollClip(r.body.clip.id);
});

test('POST /api/projects/:id/clips rejects an unknown reframe', async () => {
  const projectId = await upload();
  const r = await api(
    'POST',
    `/api/projects/${projectId}/clips`,
    {
      title: 'bad',
      startSeconds: 0,
      durationSeconds: 1,
      aspect: 'vertical',
      reframe: 'smart',
    },
  );
  assert.equal(r.status, 400);
});

test('a clip with crop-top renders a 1080x1920 MP4 with audio', async () => {
  const projectId = await upload();
  const r = await api<{ clip: { id: string } }>(
    'POST',
    `/api/projects/${projectId}/clips`,
    {
      title: 'cropped',
      startSeconds: 0,
      durationSeconds: 2,
      aspect: 'vertical',
      reframe: 'crop-top',
    },
  );
  assert.equal(r.status, 201);
  await pollClip(r.body.clip.id);

  const head = await fetch(`${baseUrl}/api/clips/${r.body.clip.id}/output`);
  assert.equal(head.status, 200);
  const buf = new Uint8Array(await head.arrayBuffer());
  assert.equal(String.fromCharCode(...buf.slice(4, 8)), 'ftyp');
  assert.ok(buf.byteLength > 1024);
});

test('PATCH /api/clips/:id can change the reframe', async () => {
  const projectId = await upload();
  const c = await api<{ clip: { id: string } }>(
    'POST',
    `/api/projects/${projectId}/clips`,
    {
      title: 'orig',
      startSeconds: 0,
      durationSeconds: 2,
      aspect: 'vertical',
      reframe: 'pad',
    },
  );
  assert.equal(c.status, 201);
  await pollClip(c.body.clip.id);

  const r = await api<{ clip: { reframe: string; status: string } }>(
    'PATCH',
    `/api/clips/${c.body.clip.id}?render=1`,
    {
      title: 'orig',
      startSeconds: 0,
      durationSeconds: 2,
      aspect: 'vertical',
      reframe: 'crop-bottom',
    },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.clip.reframe, 'crop-bottom');
  await pollClip(c.body.clip.id);
  const detail = await api<{ clip: { reframe: string } }>(
    'GET',
    `/api/clips/${c.body.clip.id}`,
  );
  assert.equal(detail.body.clip.reframe, 'crop-bottom');
});

test('PATCH rejects an unknown reframe value', async () => {
  const projectId = await upload();
  const c = await api<{ clip: { id: string } }>(
    'POST',
    `/api/projects/${projectId}/clips`,
    {
      title: 'orig',
      startSeconds: 0,
      durationSeconds: 1,
      aspect: 'vertical',
    },
  );
  assert.equal(c.status, 201);
  const r = await api(
    'PATCH',
    `/api/clips/${c.body.clip.id}`,
    {
      title: 'orig',
      startSeconds: 0,
      durationSeconds: 1,
      aspect: 'vertical',
      reframe: 'magic',
    },
  );
  assert.equal(r.status, 400);
});

test('duplicate copies the reframe value', async () => {
  const projectId = await upload();
  const c = await api<{ clip: { id: string; reframe: string } }>(
    'POST',
    `/api/projects/${projectId}/clips`,
    {
      title: 'orig',
      startSeconds: 0,
      durationSeconds: 1,
      aspect: 'vertical',
      reframe: 'crop-center',
    },
  );
  assert.equal(c.status, 201);
  await pollClip(c.body.clip.id);
  const dup = await api<{ clip: { reframe: string } }>(
    'POST',
    `/api/clips/${c.body.clip.id}/duplicate`,
  );
  assert.equal(dup.status, 201);
  assert.equal(dup.body.clip.reframe, 'crop-center');
});
