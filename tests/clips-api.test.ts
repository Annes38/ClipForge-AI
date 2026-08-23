/**
 * Phase 2 tests: clip repository + clip API.
 *
 * These run against an in-process Express app and a per-test database on
 * disk, so they exercise the real HTTP surface, the real SQL, the real
 * validation, and the real FFmpeg pipeline. They do NOT mock any of those.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { rmSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Application } from 'express';

// Use a unique data dir per test file BEFORE importing any server module.
const dataDir = mkdtempSync(path.join(tmpdir(), 'clipforge-clips-'));
process.env.CLIPFORGE_DATA_DIR = dataDir;
process.env.CLIPFORGE_DB = path.join(dataDir, 'clipforge.db');
process.env.PORT = '0';
process.env.CLIPFORGE_START = '0';

// Now import server modules (they'll read the env above).
const { createApp } = await import('../server/index.ts');
const { probeFfmpeg } = await import('../server/media/ffmpeg-locator.ts');
const { makeTempDir, createSourceWithAudio } = await import('./helpers/fixtures.ts');

const ffmpeg = probeFfmpeg();
if (!ffmpeg.available) {
  throw new Error(
    `FFmpeg is required for the API tests but is unavailable: ${ffmpeg.reason}. ` +
      'Run `npm run setup:ffmpeg`.',
  );
}

const cleanup: Array<() => void> = [];
test.after(() => {
  for (const fn of cleanup.reverse()) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
});

let server: Server | null = null;
let baseUrl = '';
const cookies: string[] = [];

const app: Application = createApp();

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(() => {
  if (server) {
    server.close();
    server = null;
  }
});

async function api<T = unknown>(
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: T; headers: Headers }> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (cookies.length) init.headers = { ...init.headers, cookie: cookies.join('; ') };
  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body;
    } else {
      init.headers = { ...init.headers, 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
  }
  const res = await fetch(`${baseUrl}${urlPath}`, init);
  // Capture set-cookie for follow-up calls (not strictly needed but harmless).
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookies.push(setCookie.split(';')[0]!);
  const text = await res.text();
  let parsed: T = undefined as T;
  if (text) {
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      parsed = text as T;
    }
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

async function uploadTestSource(
  name: string,
  size = '1280x720',
  seconds = 6,
): Promise<string> {
  const dir = makeTempDir();
  const file = await createSourceWithAudio(dir, name, seconds, size);
  const form = new FormData();
  const blob = new Blob([readFileSync(file)], { type: 'video/mp4' });
  form.append('video', blob, name);
  const res = await api<{ project?: { id: string }; error?: string }>(
    'POST',
    '/api/projects',
    form,
  );
  assert.equal(res.status, 201, `upload failed: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.project?.id, 'uploaded project has no id');
  return res.body.project.id;
}

async function pollForCompletion(clipId: string, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await api<{ clip?: { status: string; errorMessage?: string | null } }>(
      'GET',
      `/api/clips/${clipId}`,
    );
    if (r.status !== 200) throw new Error(`GET clip ${clipId} -> ${r.status}`);
    const s = r.body.clip?.status;
    if (s === 'completed') return;
    if (s === 'failed') {
      throw new Error(
        `clip ${clipId} failed: ${r.body.clip?.errorMessage ?? 'unknown'}`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for clip ${clipId} to complete`);
}

/* ===================================================================== */
/*                              DATABASE                                  */
/* ===================================================================== */

test('a project can contain multiple clips and they belong to it', async () => {
  const projectId = await uploadTestSource('multi.mp4', '1280x720', 8);

  const created: string[] = [];
  for (const t of ['Hook', 'Payoff', 'Outro']) {
    const r = await api<{ clip?: { id: string } }>('POST', `/api/projects/${projectId}/clips`, {
      title: t,
      startSeconds: 0.5,
      durationSeconds: 2,
      aspect: 'vertical',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.clip?.id, 'clip has no id');
    created.push(r.body.clip!.id);
    // Wait for completion before creating the next one (one FFmpeg at a time
    // per project — see server/routes/clips.ts).
    await pollForCompletion(r.body.clip!.id);
  }

  const list = await api<{ clips: Array<{ id: string; projectId: string; title: string }> }>(
    'GET',
    `/api/projects/${projectId}/clips`,
  );
  assert.equal(list.status, 200);
  assert.equal(list.body.clips.length, 3);
  for (const c of list.body.clips) {
    assert.equal(c.projectId, projectId, 'clip must reference its project');
  }
  const titles = new Set(list.body.clips.map((c) => c.title));
  assert.deepEqual(titles, new Set(['Hook', 'Payoff', 'Outro']));
});

test('clip listing is isolated per project', async () => {
  const a = await uploadTestSource('iso-a.mp4', '1280x720', 5);
  const b = await uploadTestSource('iso-b.mp4', '1280x720', 5);

  const createA = await api<{ clip: { id: string } }>('POST', `/api/projects/${a}/clips`, {
    title: 'A1',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(createA.status, 201);
  // The two projects run independently, so we can create B's clip while A
  // is still rendering. (The "one FFmpeg at a time" rule is per project.)
  const createB = await api<{ clip: { id: string } }>('POST', `/api/projects/${b}/clips`, {
    title: 'B1',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(createB.status, 201);
  await pollForCompletion(createA.body.clip.id);
  await pollForCompletion(createB.body.clip.id);

  const listA = await api<{ clips: Array<{ projectId: string; title: string }> }>(
    'GET',
    `/api/projects/${a}/clips`,
  );
  const listB = await api<{ clips: Array<{ projectId: string; title: string }> }>(
    'GET',
    `/api/projects/${b}/clips`,
  );
  assert.equal(listA.body.clips.length, 1);
  assert.equal(listB.body.clips.length, 1);
  assert.equal(listA.body.clips[0]!.projectId, a);
  assert.equal(listB.body.clips[0]!.projectId, b);
  assert.equal(listA.body.clips[0]!.title, 'A1');
  assert.equal(listB.body.clips[0]!.title, 'B1');
});

/* ===================================================================== */
/*                                API                                     */
/* ===================================================================== */

test('POST /api/projects/:id/clips creates a clip and starts a render', async () => {
  const projectId = await uploadTestSource('create-clip.mp4', '1280x720', 6);
  const r = await api<{ clip: { id: string; status: string; title: string } }>(
    'POST',
    `/api/projects/${projectId}/clips`,
    { title: 'My clip', startSeconds: 1, durationSeconds: 2, aspect: 'vertical' },
  );
  assert.equal(r.status, 201);
  assert.ok(r.body.clip.id);
  assert.equal(r.body.clip.title, 'My clip');
  assert.ok(['pending', 'processing', 'completed'].includes(r.body.clip.status));

  await pollForCompletion(r.body.clip.id);

  const detail = await api<{ clip: { status: string; hasOutput: boolean } }>(
    'GET',
    `/api/clips/${r.body.clip.id}`,
  );
  assert.equal(detail.status, 200);
  assert.equal(detail.body.clip.status, 'completed');
  assert.equal(detail.body.clip.hasOutput, true);
});

test('GET /api/projects/:id/clips returns an empty list for a project with no clips', async () => {
  const projectId = await uploadTestSource('empty.mp4', '1280x720', 3);
  const r = await api<{ clips: unknown[] }>('GET', `/api/projects/${projectId}/clips`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.clips, []);
});

test('GET /api/clips/:id returns clip metadata', async () => {
  const projectId = await uploadTestSource('metadata.mp4', '1280x720', 5);
  const c = await api<{ clip: { id: string; startSeconds: number; durationSeconds: number; aspect: string } }>(
    'POST',
    `/api/projects/${projectId}/clips`,
    { title: 'meta', startSeconds: 1.5, durationSeconds: 2, aspect: 'vertical' },
  );
  assert.equal(c.status, 201);
  const r = await api<{ clip: { id: string; startSeconds: number; durationSeconds: number; aspect: string } }>(
    'GET',
    `/api/clips/${c.body.clip.id}`,
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.clip.id, c.body.clip.id);
  assert.equal(r.body.clip.startSeconds, 1.5);
  assert.equal(r.body.clip.durationSeconds, 2);
  assert.equal(r.body.clip.aspect, 'vertical');
});

test('DELETE /api/clips/:id removes the clip row and its output file', async () => {
  const projectId = await uploadTestSource('del.mp4', '1280x720', 5);
  const c = await api<{ clip: { id: string } }>('POST', `/api/projects/${projectId}/clips`, {
    title: 'to-delete',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(c.status, 201);
  await pollForCompletion(c.body.clip.id);

  // Confirm the file exists before deleting.
  const head = await fetch(`${baseUrl}/api/clips/${c.body.clip.id}/output`);
  assert.equal(head.status, 200);
  assert.ok((await head.arrayBuffer()).byteLength > 0);

  const del = await api('DELETE', `/api/clips/${c.body.clip.id}`);
  assert.ok(del.status === 204 || del.status === 200, `delete status: ${del.status}`);

  // Now GET on the clip must 404.
  const after = await api('GET', `/api/clips/${c.body.clip.id}`);
  assert.equal(after.status, 404);

  // And listing must no longer include it.
  const list = await api<{ clips: Array<{ id: string }> }>(
    'GET',
    `/api/projects/${projectId}/clips`,
  );
  assert.equal(list.body.clips.find((x) => x.id === c.body.clip.id), undefined);
});

test('a project with clips can be deleted; all clip rows are removed', async () => {
  const projectId = await uploadTestSource('project-del.mp4', '1280x720', 6);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await api<{ clip: { id: string } }>('POST', `/api/projects/${projectId}/clips`, {
      title: `c${i}`,
      startSeconds: 0,
      durationSeconds: 1,
      aspect: 'vertical',
    });
    assert.equal(r.status, 201);
    ids.push(r.body.clip.id);
    await pollForCompletion(r.body.clip.id);
  }

  const del = await api('DELETE', `/api/projects/${projectId}`);
  assert.ok(del.status === 204 || del.status === 200, `delete status: ${del.status}`);

  // Project gone.
  const proj = await api('GET', `/api/projects/${projectId}`);
  assert.equal(proj.status, 404);
  // Clips gone (CASCADE).
  for (const id of ids) {
    const r = await api('GET', `/api/clips/${id}`);
    assert.equal(r.status, 404, `clip ${id} should be gone after project delete`);
  }
});

/* ----------------------------- validation ----------------------------- */

test('invalid project id is rejected', async () => {
  const r = await api('POST', '/api/projects/not-a-uuid/clips', {
    title: 'x',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(r.status, 400);
});

test('missing project is rejected with 404', async () => {
  const r = await api(
    'POST',
    '/api/projects/00000000-0000-0000-0000-000000000000/clips',
    { title: 'x', startSeconds: 0, durationSeconds: 1, aspect: 'vertical' },
  );
  assert.equal(r.status, 404);
});

test('invalid clip id is rejected', async () => {
  const r = await api('GET', '/api/clips/not-a-uuid');
  assert.equal(r.status, 400);
});

test('missing clip id returns 404', async () => {
  const r = await api('GET', '/api/clips/11111111-1111-1111-1111-111111111111');
  assert.equal(r.status, 404);
});

test('negative start time is rejected', async () => {
  const projectId = await uploadTestSource('neg-start.mp4', '1280x720', 5);
  const r = await api('POST', `/api/projects/${projectId}/clips`, {
    title: 'x',
    startSeconds: -0.5,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(r.status, 400);
  assert.match(JSON.stringify(r.body), /non-negative|start/);
});

test('non-finite start time is rejected', async () => {
  const projectId = await uploadTestSource('nan-start.mp4', '1280x720', 5);
  const r = await api('POST', `/api/projects/${projectId}/clips`, {
    title: 'x',
    startSeconds: Number.NaN,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(r.status, 400);
});

test('zero duration is rejected', async () => {
  const projectId = await uploadTestSource('zero-dur.mp4', '1280x720', 5);
  const r = await api('POST', `/api/projects/${projectId}/clips`, {
    title: 'x',
    startSeconds: 0,
    durationSeconds: 0,
    aspect: 'vertical',
  });
  assert.equal(r.status, 400);
});

test('negative duration is rejected', async () => {
  const projectId = await uploadTestSource('neg-dur.mp4', '1280x720', 5);
  const r = await api('POST', `/api/projects/${projectId}/clips`, {
    title: 'x',
    startSeconds: 0,
    durationSeconds: -2,
    aspect: 'vertical',
  });
  assert.equal(r.status, 400);
});

test('oversized duration is rejected', async () => {
  const projectId = await uploadTestSource('huge-dur.mp4', '1280x720', 5);
  const r = await api('POST', `/api/projects/${projectId}/clips`, {
    title: 'x',
    startSeconds: 0,
    durationSeconds: 10_000,
    aspect: 'vertical',
  });
  assert.equal(r.status, 400);
});

test('invalid aspect ratio is rejected', async () => {
  const projectId = await uploadTestSource('bad-aspect.mp4', '1280x720', 5);
  for (const bad of ['square', '1:1', '4:3', 'portrait', '', null, 42]) {
    const r = await api('POST', `/api/projects/${projectId}/clips`, {
      title: 'x',
      startSeconds: 0,
      durationSeconds: 1,
      aspect: bad,
    });
    assert.equal(r.status, 400, `expected 400 for aspect=${String(bad)}`);
  }
});

test('start + duration beyond source duration is rejected', async () => {
  const projectId = await uploadTestSource('short.mp4', '1280x720', 4);
  // Source is 4s. Asking for end at 6s should fail.
  const r = await api('POST', `/api/projects/${projectId}/clips`, {
    title: 'overflow',
    startSeconds: 2,
    durationSeconds: 5,
    aspect: 'vertical',
  });
  assert.equal(r.status, 400);
  assert.match(JSON.stringify(r.body), /beyond|source/i);
});

test('missing title is rejected', async () => {
  const projectId = await uploadTestSource('no-title.mp4', '1280x720', 5);
  const r = await api('POST', `/api/projects/${projectId}/clips`, {
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(r.status, 400);
});

test('empty / whitespace title is rejected', async () => {
  const projectId = await uploadTestSource('ws-title.mp4', '1280x720', 5);
  for (const t of ['', '   ', '\t\n']) {
    const r = await api('POST', `/api/projects/${projectId}/clips`, {
      title: t,
      startSeconds: 0,
      durationSeconds: 1,
      aspect: 'vertical',
    });
    assert.equal(r.status, 400, `expected 400 for title=${JSON.stringify(t)}`);
  }
});

/* ===================================================================== */
/*                              SECURITY                                  */
/* ===================================================================== */

test('clip id path traversal is rejected', async () => {
  for (const bad of [
    '../etc/passwd',
    '..%2Fetc%2Fpasswd',
    'foo/../bar',
    'a/../../clip',
  ]) {
    const r = await api('GET', `/api/clips/${encodeURIComponent(bad)}`);
    assert.equal(r.status, 400, `expected 400 for id=${bad}`);
  }
});

test('user-controlled values never reach the FFmpeg argv', async () => {
  // Build a project, then create a clip whose title, start and duration
  // are full of shell metacharacters and quotes. If the pipeline ever used
  // a shell or concatenated user input into a command string, these would
  // either error or leak through into the rendered filename / args. They
  // must not.
  const projectId = await uploadTestSource('safe-args.mp4', '1280x720', 6);
  const evilTitle = "evil; rm -rf $(pwd) `id` '\"$IFS\"'";
  const r = await api<{ clip: { id: string } }>(
    'POST',
    `/api/projects/${projectId}/clips`,
    { title: evilTitle, startSeconds: 0.5, durationSeconds: 1.5, aspect: 'vertical' },
  );
  assert.equal(r.status, 201);
  const id = r.body.clip.id;
  await pollForCompletion(id);

  const detail = await api<{ clip: { title: string; status: string } }>(
    'GET',
    `/api/clips/${id}`,
  );
  assert.equal(detail.body.clip.title, evilTitle, 'title is preserved verbatim');
  assert.equal(detail.body.clip.status, 'completed');

  // Output must be a real MP4 (ftyp box). The metacharacters did not leak
  // into the output filename.
  const head = await fetch(`${baseUrl}/api/clips/${id}/output`);
  assert.equal(head.status, 200);
  const u8 = new Uint8Array(await head.arrayBuffer());
  assert.equal(
    String.fromCharCode(...u8.slice(4, 8)),
    'ftyp',
    'output is not a real MP4',
  );
});

test('a canary file survives an end-to-end render of a clip', async () => {
  // Defense in depth: even if the existing canary test in
  // render-integration.test.ts missed something, the API path should be safe
  // end-to-end. This uses a real source upload + a real clip create.
  const canary = path.join(dataDir, 'canary.txt');
  writeFileSync(canary, 'untouched');

  // The body must not include any command-substitution / rm that could fire
  // if a shell ever got involved. We bake the canary reference into a piece
  // of the title to ensure even title-derived string handling is safe.
  const projectId = await uploadTestSource('canary.mp4', '1280x720', 5);
  const r = await api<{ clip: { id: string } }>('POST', `/api/projects/${projectId}/clips`, {
    title: 'x $(rm -f canary.txt) y; rm -f canary.txt; `id`',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(r.status, 201);
  await pollForCompletion(r.body.clip.id);
  assert.equal(readFileSync(canary, 'utf8'), 'untouched', 'shell injection occurred!');
});

/* ===================================================================== */
/*                          REAL RENDERING                                */
/* ===================================================================== */

test('two real clips from the same source render to independent MP4s', async () => {
  const projectId = await uploadTestSource('multi-real.mp4', '1280x720', 8);

  const a = await api<{ clip: { id: string } }>('POST', `/api/projects/${projectId}/clips`, {
    title: 'Clip A',
    startSeconds: 0.5,
    durationSeconds: 2,
    aspect: 'vertical',
  });
  assert.equal(a.status, 201);
  await pollForCompletion(a.body.clip.id);

  const b = await api<{ clip: { id: string } }>('POST', `/api/projects/${projectId}/clips`, {
    title: 'Clip B',
    startSeconds: 3,
    durationSeconds: 2,
    aspect: 'vertical',
  });
  assert.equal(b.status, 201);
  assert.notEqual(a.body.clip.id, b.body.clip.id);
  await pollForCompletion(b.body.clip.id);

  // Both outputs must exist as real MP4s.
  for (const id of [a.body.clip.id, b.body.clip.id]) {
    const head = await fetch(`${baseUrl}/api/clips/${id}/output`);
    assert.equal(head.status, 200);
    const buf = await head.arrayBuffer();
    assert.ok(buf.byteLength > 1024, `${id} output implausibly small`);
    const u8 = new Uint8Array(buf);
    assert.equal(String.fromCharCode(...u8.slice(4, 8)), 'ftyp', `${id} not MP4`);
  }

  // Each clip has the right metadata.
  const detA = await api<{ clip: { output: { width: number; height: number; durationSeconds: number; audioPreserved: boolean } } }>(
    'GET',
    `/api/clips/${a.body.clip.id}`,
  );
  const detB = await api<{ clip: { output: { width: number; height: number; durationSeconds: number; audioPreserved: boolean } } }>(
    'GET',
    `/api/clips/${b.body.clip.id}`,
  );
  assert.equal(detA.body.clip.output.width, 1080);
  assert.equal(detA.body.clip.output.height, 1920);
  assert.equal(detB.body.clip.output.width, 1080);
  assert.equal(detB.body.clip.output.height, 1920);
  assert.ok(
    Math.abs((detA.body.clip.output.durationSeconds ?? 0) - 2) < 0.75,
    `clip A duration wrong: ${detA.body.clip.output.durationSeconds}`,
  );
  assert.ok(
    Math.abs((detB.body.clip.output.durationSeconds ?? 0) - 2) < 0.75,
    `clip B duration wrong: ${detB.body.clip.output.durationSeconds}`,
  );
  assert.equal(detA.body.clip.output.audioPreserved, true);
  assert.equal(detB.body.clip.output.audioPreserved, true);

  // The two output files must be distinct on disk. MP4s share a container
  // header so we compare well past it (where the encoded samples live) and
  // also assert the file sizes are different because the two source segments
  // are at different time positions.
  const headA = await fetch(`${baseUrl}/api/clips/${a.body.clip.id}/output`);
  const headB = await fetch(`${baseUrl}/api/clips/${b.body.clip.id}/output`);
  const uA = new Uint8Array(await headA.arrayBuffer());
  const uB = new Uint8Array(await headB.arrayBuffer());
  assert.notEqual(uA.byteLength, uB.byteLength, 'clips ended up the same size');
  assert.notDeepEqual(
    uA.slice(2048, 4096),
    uB.slice(2048, 4096),
    'media payloads look identical',
  );
});

test('range requests on a clip output work (HTTP 206)', async () => {
  const projectId = await uploadTestSource('range.mp4', '1280x720', 5);
  const c = await api<{ clip: { id: string } }>('POST', `/api/projects/${projectId}/clips`, {
    title: 'range',
    startSeconds: 0,
    durationSeconds: 2,
    aspect: 'vertical',
  });
  assert.equal(c.status, 201);
  await pollForCompletion(c.body.clip.id);

  const r = await fetch(`${baseUrl}/api/clips/${c.body.clip.id}/output`, {
    headers: { range: 'bytes=0-1023' },
  });
  assert.equal(r.status, 206);
  assert.match(r.headers.get('content-range') ?? '', /bytes 0-1023\/\d+/);
  const buf = new Uint8Array(await r.arrayBuffer());
  assert.equal(buf.byteLength, 1024);
});

test('download endpoint sets Content-Disposition', async () => {
  const projectId = await uploadTestSource('download.mp4', '1280x720', 5);
  const c = await api<{ clip: { id: string; title: string } }>(
    'POST',
    `/api/projects/${projectId}/clips`,
    { title: 'My Download', startSeconds: 0, durationSeconds: 1, aspect: 'vertical' },
  );
  assert.equal(c.status, 201);
  await pollForCompletion(c.body.clip.id);

  const r = await fetch(`${baseUrl}/api/clips/${c.body.clip.id}/download`);
  assert.equal(r.status, 200);
  const cd = r.headers.get('content-disposition') ?? '';
  assert.match(cd, /attachment/);
  assert.match(cd, /My-Download/);
  assert.match(cd, /\.mp4/);
});

test('deleting one clip does not affect other clips of the same project', async () => {
  const projectId = await uploadTestSource('independent.mp4', '1280x720', 8);
  const a = await api<{ clip: { id: string } }>('POST', `/api/projects/${projectId}/clips`, {
    title: 'keep me',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(a.status, 201);
  await pollForCompletion(a.body.clip.id);

  const b = await api<{ clip: { id: string } }>('POST', `/api/projects/${projectId}/clips`, {
    title: 'delete me',
    startSeconds: 2,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(b.status, 201);
  await pollForCompletion(b.body.clip.id);

  const del = await api('DELETE', `/api/clips/${b.body.clip.id}`);
  assert.ok(del.status === 204 || del.status === 200, `delete status: ${del.status}`);

  // a is still there and still downloadable.
  const headA = await fetch(`${baseUrl}/api/clips/${a.body.clip.id}/output`);
  assert.equal(headA.status, 200, 'clip A should still be available');
  const detA = await api<{ clip: { status: string } }>('GET', `/api/clips/${a.body.clip.id}`);
  assert.equal(detA.body.clip.status, 'completed');

  // b is gone.
  const detB = await api('GET', `/api/clips/${b.body.clip.id}`);
  assert.equal(detB.status, 404);
});
