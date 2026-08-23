import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchProject,
  createClip,
  deleteProject,
  deleteClip,
  renderClip,
  clipOutputUrl,
  clipDownloadUrl,
  ApiError,
} from '../api/client.ts';
import type { AspectMode, Clip, ClipStatus, Project } from '../api/types.ts';
import { TopBar } from '../components/TopBar.tsx';
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
  const [clips, setClips] = useState<Clip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState(15);
  const [aspect, setAspect] = useState<AspectMode>('vertical');
  const configured = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchProject(projectId);
      setProject(data.project);
      setClips(data.clips ?? []);
      setError(null);

      // Seed the trim controls once, from the real source duration.
      if (!configured.current && data.project.media?.durationSeconds) {
        configured.current = true;
        setDuration(
          Math.min(15, Math.max(1, Math.floor(data.project.media.durationSeconds))),
        );
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

  const anyInFlight = clips.some(
    (c) => c.status === 'processing' || c.status === 'pending',
  );
  useEffect(() => {
    if (!anyInFlight) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [anyInFlight, load]);

  async function handleCreateClip() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Give the clip a name before rendering.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createClip(projectId, {
        title: trimmedTitle,
        startSeconds: start,
        durationSeconds: duration,
        aspect,
      });
      setTitle('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetryClip(clipId: string) {
    try {
      await renderClip(clipId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }

  async function handleDeleteClip(clipId: string) {
    if (!confirm('Delete this clip and its rendered file?')) return;
    try {
      await deleteClip(clipId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }

  async function handleDeleteProject() {
    if (!confirm('Delete this project and all of its clips?')) return;
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
  const sourceDuration = media?.durationSeconds ?? null;
  const maxStart = sourceDuration ? Math.max(0, Math.floor(sourceDuration) - 1) : 0;
  const projectInFlight = anyInFlight;

  return (
    <>
      <TopBar onBack={onBack} title={project.name} />

      {error && (
        <div className="alert alert-error">
          <strong>Something went wrong</strong>
          {error}
        </div>
      )}

      {/* ---------------- Clips list ---------------- */}
      <div className="card">
        <div className="section-head">
          <h2>Clips</h2>
          {clips.length > 0 && <span className="muted">{clips.length}</span>}
        </div>
        {clips.length === 0 ? (
          <p className="muted">
            No clips yet. Use the form below to create your first one.
          </p>
        ) : (
          <ul className="clip-list">
            {clips.map((c) => (
              <ClipRow
                key={c.id}
                clip={c}
                onRetry={() => void handleRetryClip(c.id)}
                onDelete={() => void handleDeleteClip(c.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ---------------- Create a new clip ---------------- */}
      <div className="card">
        <h2>New clip</h2>

        <label className="field">
          <span className="field-label">Clip name</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 80))}
            placeholder="Hook, payoff, highlight…"
            maxLength={80}
            disabled={projectInFlight}
          />
        </label>

        <label className="field">
          <span className="field-label">Start at — {formatDuration(start)}</span>
          <input
            type="range"
            min={0}
            max={maxStart}
            step={1}
            value={Math.min(start, maxStart)}
            onChange={(e) => setStart(Number(e.target.value))}
            disabled={maxStart === 0 || projectInFlight}
          />
          {sourceDuration !== null && (
            <p className="muted" style={{ marginTop: 4 }}>
              Source duration: {formatDuration(sourceDuration)}
            </p>
          )}
        </label>

        <label className="field">
          <span className="field-label">Clip length (seconds)</span>
          <input
            type="number"
            min={1}
            max={600}
            value={duration}
            onChange={(e) =>
              setDuration(Math.max(1, Math.min(600, Number(e.target.value) || 1)))
            }
            inputMode="numeric"
            disabled={projectInFlight}
          />
        </label>

        <div className="field">
          <span className="field-label">Format</span>
          <div className="segmented">
            <button
              type="button"
              aria-pressed={aspect === 'vertical'}
              onClick={() => setAspect('vertical')}
              disabled={projectInFlight}
            >
              9:16 Vertical
            </button>
            <button
              type="button"
              aria-pressed={aspect === 'source'}
              onClick={() => setAspect('source')}
              disabled={projectInFlight}
            >
              Keep original
            </button>
          </div>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => void handleCreateClip()}
          disabled={submitting || projectInFlight || !title.trim()}
        >
          {submitting ? 'Starting…' : '✂ Create clip'}
        </button>
        {projectInFlight && (
          <p className="muted" style={{ marginTop: 8 }}>
            A clip is already rendering. Wait for it to finish to create another.
          </p>
        )}
      </div>

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
              {media.width && media.height
                ? ` (${describeAspect(media.width, media.height)})`
                : ''}
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

      <button
        className="btn btn-danger"
        onClick={() => void handleDeleteProject()}
        style={{ marginTop: 10 }}
        disabled={projectInFlight}
      >
        Delete project
      </button>
    </>
  );
}

function ClipRow({
  clip,
  onRetry,
  onDelete,
}: {
  clip: Clip;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const isPending = clip.status === 'pending' || clip.status === 'processing';
  const isFailed = clip.status === 'failed';
  const isDone = clip.status === 'completed' && clip.hasOutput;
  return (
    <li className="clip-row">
      <div className="clip-row-head">
        <div className="clip-row-title">{clip.title}</div>
        <ClipStatusPill status={clip.status} />
      </div>
      <div className="clip-row-meta muted">
        {formatDuration(clip.startSeconds)} · {formatDuration(clip.durationSeconds)} ·{' '}
        {clip.aspect === 'vertical' ? '9:16' : 'Source'} ·{' '}
        {clip.output
          ? `${formatResolution(clip.output.width, clip.output.height)} · ${formatBytes(
              clip.output.bytes,
            )} · ${formatDuration(clip.output.durationSeconds)}`
          : 'Not rendered yet'}
      </div>

      {clip.errorMessage && (
        <div className="alert alert-error" style={{ marginTop: 8 }}>
          <strong>Render failed</strong>
          {clip.errorMessage}
        </div>
      )}

      {isPending && (
        <ProgressBar value={null} label={`Rendering — ${clip.status}`} />
      )}

      {isDone && (
        <div className="video-wrap" style={{ marginTop: 10 }}>
          {/* cache-busted so a re-render is never served from cache */}
          <video
            src={`${clipOutputUrl(clip.id)}?v=${clip.updatedAt}`}
            controls
            playsInline
            preload="metadata"
          />
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 10 }}>
        {isDone && (
          <a className="btn btn-primary" href={clipDownloadUrl(clip.id)} download>
            ⬇ Download
          </a>
        )}
        {isFailed && (
          <button className="btn btn-secondary" onClick={onRetry}>
            Try again
          </button>
        )}
        <button
          className="btn btn-ghost"
          onClick={onDelete}
          disabled={isPending}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function ClipStatusPill({ status }: { status: ClipStatus }) {
  const map: Record<ClipStatus, { label: string; cls: string }> = {
    pending: { label: 'Queued', cls: 'pill pill-run' },
    processing: { label: 'Rendering', cls: 'pill pill-run' },
    completed: { label: 'Ready', cls: 'pill pill-ok' },
    failed: { label: 'Failed', cls: 'pill pill-err' },
  };
  const { label, cls } = map[status];
  return <span className={cls}>{label}</span>;
}
