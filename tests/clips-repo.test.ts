/**
 * Direct repository tests for the clips table.
 *
 * These bypass the HTTP layer and exercise the SQL repo functions + the
 * foreign-key ON DELETE CASCADE behavior. The HTTP API tests in
 * `clips-api.test.ts` cover the same behaviour end-to-end; this file
 * exists to make the database contract explicit and easy to read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(tmpdir(), 'clipforge-repo-'));
process.env.CLIPFORGE_DATA_DIR = dataDir;
process.env.CLIPFORGE_DB = path.join(dataDir, 'clipforge.db');
process.env.PORT = '0';
process.env.CLIPFORGE_START = '0';

const { getDb, closeDb } = await import('../server/db/database.ts');
const {
  createProject,
  deleteProject,
  getProject,
} = await import('../server/db/projects-repo.ts');
const {
  createClip,
  listClips,
  getClip,
  deleteClip,
  countClipsForProject,
  setClipStatus,
  setClipOutput,
} = await import('../server/db/clips-repo.ts');

test.after(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

function makeProject(name = 'p.mp4'): string {
  const row = createProject({
    name,
    sourceFilename: name,
    sourcePath: path.join(dataDir, name),
    sourceBytes: 0,
    media: {
      durationSeconds: 10,
      width: 1280,
      height: 720,
      hasVideo: true,
      hasAudio: true,
      videoCodec: 'h264',
      audioCodec: 'aac',
      formatName: 'mov,mp4',
      frameRate: 30,
    },
  });
  return row.id;
}

test('a project can contain many clips with independent metadata', () => {
  const projectId = makeProject('multi-repo.mp4');
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const c = createClip({
      projectId,
      title: `clip ${i}`,
      startSeconds: i,
      durationSeconds: 1,
      aspect: i % 2 === 0 ? 'vertical' : 'source',
    });
    assert.ok(c.id);
    assert.equal(c.project_id, projectId);
    ids.push(c.id);
  }
  const all = listClips(projectId);
  assert.equal(all.length, 5);
  assert.equal(countClipsForProject(projectId), 5);
  for (const c of all) {
    assert.equal(c.project_id, projectId, 'clip must reference the project');
  }
  // Clips are returned in created_at DESC order. Clips created in the same
  // millisecond may appear in any order, but the set must match exactly.
  assert.deepEqual(new Set(all.map((c) => c.id)), new Set(ids));
});

test('clips belong to the correct project and not to others', () => {
  const a = makeProject('a.mp4');
  const b = makeProject('b.mp4');
  const ac = createClip({
    projectId: a,
    title: 'A',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  const bc = createClip({
    projectId: b,
    title: 'B',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(ac.project_id, a);
  assert.equal(bc.project_id, b);
  assert.deepEqual(listClips(a).map((c) => c.id), [ac.id]);
  assert.deepEqual(listClips(b).map((c) => c.id), [bc.id]);
  assert.equal(countClipsForProject(a), 1);
  assert.equal(countClipsForProject(b), 1);
});

test('clip status and output transitions are observable', () => {
  const projectId = makeProject('status.mp4');
  const c = createClip({
    projectId,
    title: 'flow',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(c.status, 'pending');
  setClipStatus(c.id, 'processing');
  assert.equal(getClip(c.id)?.status, 'processing');
  setClipStatus(c.id, 'failed', 'something went wrong');
  const after = getClip(c.id);
  assert.equal(after?.status, 'failed');
  assert.equal(after?.error_message, 'something went wrong');
  setClipOutput(c.id, '/tmp/clip.mp4', {
    width: 1080,
    height: 1920,
    durationSeconds: 1,
    bytes: 12345,
    audioPreserved: true,
  });
  const done = getClip(c.id);
  assert.equal(done?.status, 'completed');
  assert.equal(done?.output_path, '/tmp/clip.mp4');
  assert.equal(done?.error_message, null);
});

test('deleting a project removes its clips via FK CASCADE', () => {
  const projectId = makeProject('cascade.mp4');
  const a = createClip({
    projectId,
    title: 'a',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  const b = createClip({
    projectId,
    title: 'b',
    startSeconds: 1,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  assert.equal(countClipsForProject(projectId), 2);
  deleteProject(projectId);
  assert.equal(getProject(projectId), null);
  assert.equal(getClip(a.id), null, 'clip A should be cascaded away');
  assert.equal(getClip(b.id), null, 'clip B should be cascaded away');
  assert.equal(countClipsForProject(projectId), 0);
});

test('deleting a clip does not affect other clips or the project', () => {
  const projectId = makeProject('isolated.mp4');
  const a = createClip({
    projectId,
    title: 'a',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  const b = createClip({
    projectId,
    title: 'b',
    startSeconds: 0,
    durationSeconds: 1,
    aspect: 'vertical',
  });
  deleteClip(a.id);
  assert.equal(getClip(a.id), null);
  assert.equal(getClip(b.id)?.id, b.id);
  assert.equal(getProject(projectId)?.id, projectId);
});

test('database is initialised with foreign keys ON (the CASCADE test above would silently no-op otherwise)', () => {
  const db = getDb();
  const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
  assert.equal(row.foreign_keys, 1, 'foreign keys must be enabled for CASCADE');
});
