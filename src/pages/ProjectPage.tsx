import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchProject,
  startProcessing,
  deleteProject,
  outputUrl,
  downloadUrl,
  ApiError,
} from '../api/client.ts';
import type { AspectMode, Job, Project } from '../api/types.ts';
import { TopBar } from '../components/TopBar.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { ProgressBar } from '../components/ProgressBar.tsx';
import {
  formatBytes,
  formatDuration,
  formatResolution,
  describeAspect,
} from '../lib/format.ts';

interface Props {
  projectId: string;
  onBack: () => void;
  onDeleted: () => void;
}

const POLL_MS = 1000;

export function ProjectPage({ projectId, onBack, onDeleted }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState(15);
  const [aspect, setAspect] = useState<AspectMode>('vertical');
  const configured = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchProject(projectId);
      setProject(data.project);
      setJob(data.job);
      setError(null);

      // Seed the trim controls once, from the real source duration.
      if (!configured.current && data.project.media?.durationSeconds) {
        configured.current = true;
        setDuration(Math.min(15, Math.max(1, Math.floor(data.project.media.durationSeconds))));
      }
      return data;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while work is actually in flight.
  const active = project?.status === 'processing' || project?.status === 'preparing';
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [active, load]);

  async function handleProcess() {
    setSubmitting(true);
    setError(null);
    try {
      await startProcessing(projectId, {
        startSeconds: start,
        durationSeconds: duration,
        aspect,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this project and its files?')) return;
    try {
      await deleteProject(projectId);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }

  if (loading) {
    return (
      <>
        <TopBar onBack={onBack} title="Project" />
        <div className="card center">
          <p className="muted">Loading…</p>
        </div>
      </>
    );
  }

  if (!project) {
    return (
      <>
        <TopBar onBack={onBack} title="Project" />
        <div className="alert alert-error">
          <strong>Project unavailable</strong>
          {error ?? 'This project could not be found.'}
        </div>
        <button className="btn btn-secondary" onClick={onBack}>
          Back to dashboard
        </button>
      </>
    );
  }

  const media = project.media;
  const maxStart = media?.durationSeconds ? Math.max(0, Math.floor(media.durationSeconds) - 1) : 0;
  const isDone = project.status === 'completed' && project.hasOutput;
  const isFailed = project.status === 'failed';

  return (
    <>
      <TopBar onBack={onBack} title={project.name} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <StatusPill status={project.status} />
        <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.sourceFilename}
        </span>
      </div>

      {error && (
        <div className="alert alert-error">
          <strong>Something went wrong</strong>
          {error}
        </div>
      )}

      {isFailed && (
        <div className="alert alert-error">
          <strong>Processing failed</strong>
          {project.errorMessage ?? job?.message ?? 'The render did not complete.'}
          {job?.detail && <pre>{job.detail}</pre>}
        </div>
      )}

      {/* ---------------- Result ---------------- */}
      {isDone && (
        <div className="card">
          <h2>Your clip</h2>
          <div className="video-wrap">
            {/* cache-busted so a re-render is never served from cache */}
            <video src={`${outputUrl(project.id)}?v=${project.updatedAt}`} controls playsInline preload="metadata" />
          </div>

          <dl className="info-grid" style={{ marginTop: 14 }}>
            <dt>Resolution</dt>
            <dd>
              {formatResolution(project.output?.width, project.output?.height)}
              {project.output?.width && project.output?.height
                ? ` (${describeAspect(project.output.width, project.output.height)})`
                : ''}
            </dd>
            <dt>Duration</dt>
            <dd>{formatDuration(project.output?.durationSeconds)}</dd>
            <dt>File size</dt>
            <dd>{formatBytes(project.output?.bytes)}</dd>
            <dt>Audio</dt>
            <dd>
              {project.output?.audioPreserved
                ? 'Preserved'
                : media?.hasAudio === false
                  ? 'None in source'
                  : 'Not present'}
            </dd>
          </dl>

          <div style={{ marginTop: 14 }} className="stack">
            <a className="btn btn-primary" href={downloadUrl(project.id)} download>
              ⬇ Download MP4
            </a>
            <div className="btn-row">
              <button className="btn btn-secondary" onClick={onBack}>
                Back to projects
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setProject({ ...project, status: 'created' });
                }}
              >
                New clip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Progress ---------------- */}
      {active && (
        <div className="card">
          <h2>{job?.phase === 'preparing' ? 'Preparing' : 'Processing'}</h2>
          <ProgressBar value={job?.progress ?? null} label={job?.message ?? 'Working…'} />
          <p className="muted" style={{ marginTop: 10 }}>
            Encoding with FFmpeg. Progress is reported by the encoder itself.
          </p>
        </div>
      )}

      {/* ---------------- Source info ---------------- */}
      <div className="card">
        <h2>Source video</h2>
        {media ? (
          <dl className="info-grid">
            <dt>Duration</dt>
            <dd>{formatDuration(media.durationSeconds)}</dd>
            <dt>Resolution</dt>
            <dd>
              {formatResolution(media.width, media.height)}
              {media.width && media.height ? ` (${describeAspect(media.width, media.height)})` : ''}
            </dd>
            <dt>Frame rate</dt>
            <dd>{media.frameRate ? `${media.frameRate} fps` : 'Unknown'}</dd>
            <dt>Video codec</dt>
            <dd>{media.videoCodec ?? 'Unknown'}</dd>
            <dt>Audio</dt>
            <dd>{media.hasAudio ? (media.audioCodec ?? 'Present') : 'No audio track'}</dd>
            <dt>File size</dt>
            <dd>{formatBytes(project.sourceBytes)}</dd>
          </dl>
        ) : (
          <p className="muted">Media information is not available for this file.</p>
        )}
      </div>

      {/* ---------------- Clip settings ---------------- */}
      {!active && !isDone && (
        <div className="card">
          <h2>Clip settings</h2>

          <label className="field">
            <span className="field-label">Start at — {formatDuration(start)}</span>
            <input
              type="range"
              min={0}
              max={maxStart}
              step={1}
              value={Math.min(start, maxStart)}
              onChange={(e) => setStart(Number(e.target.value))}
              disabled={maxStart === 0}
            />
          </label>

          <label className="field">
            <span className="field-label">Clip length (seconds)</span>
            <input
              type="number"
              min={1}
              max={600}
              value={duration}
              onChange={(e) => setDuration(Math.max(1, Math.min(600, Number(e.target.value) || 1)))}
              inputMode="numeric"
            />
          </label>

          <div className="field">
            <span className="field-label">Format</span>
            <div className="segmented">
              <button
                type="button"
                aria-pressed={aspect === 'vertical'}
                onClick={() => setAspect('vertical')}
              >
                9:16 Vertical
              </button>
              <button
                type="button"
                aria-pressed={aspect === 'source'}
                onClick={() => setAspect('source')}
              >
                Keep original
              </button>
            </div>
          </div>

          <button className="btn btn-primary" onClick={handleProcess} disabled={submitting}>
            {submitting ? 'Starting…' : '✂ Create clip'}
          </button>
        </div>
      )}

      {isFailed && !active && (
        <button className="btn btn-secondary" onClick={handleProcess} disabled={submitting}>
          Try again
        </button>
      )}

      <button className="btn btn-danger" onClick={handleDelete} style={{ marginTop: 10 }}>
        Delete project
      </button>
    </>
  );
}
