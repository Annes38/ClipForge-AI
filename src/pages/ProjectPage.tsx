import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchProject,
  createClip,
  deleteProject,
  deleteClip,
  renderClip,
  updateClip as updateClipApi,
  duplicateClip as duplicateClipApi,
  suggestClips,
  createClipFromSuggestion,
  clipOutputUrl,
  clipDownloadUrl,
  ApiError,
} from '../api/client.ts';
import type {
  AspectMode,
  Clip,
  ClipStatus,
  HighlightCandidate,
  Project,
} from '../api/types.ts';
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

  // Suggestion state
  const [suggestions, setSuggestions] = useState<HighlightCandidate[]>([]);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestMeta, setSuggestMeta] = useState<{
    sceneCount: number;
    silenceCount: number;
  } | null>(null);
  const [acceptedIdx, setAcceptedIdx] = useState<Set<number>>(new Set());

  // Form state
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState(15);
  const [aspect, setAspect] = useState<AspectMode>('vertical');
  const [reframe, setReframe] = useState<
    'pad' | 'crop-center' | 'crop-top' | 'crop-bottom'
  >('pad');
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
        reframe,
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

  async function handleDuplicate(clipId: string) {
    try {
      await duplicateClipApi(clipId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }

  async function handleUpdateClip(
    clipId: string,
    patch: {
      title: string;
      startSeconds: number;
      durationSeconds: number;
      aspect: 'vertical' | 'source';
      reframe?: 'pad' | 'crop-center' | 'crop-top' | 'crop-bottom';
    },
    options: { render?: boolean } = {},
  ) {
    try {
      await updateClipApi(clipId, patch, options);
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

  async function handleSuggest() {
    setSuggestLoading(true);
    setSuggestError(null);
    setAcceptedIdx(new Set());
    try {
      const result = await suggestClips(projectId, {
        max: 8,
        minDuration: 10,
        maxDuration: 60,
      });
      setSuggestions(result.candidates);
      setSuggestMeta({
        sceneCount: result.rawSceneChangeCount,
        silenceCount: result.rawSilenceCount,
      });
    } catch (err) {
      setSuggestError(err instanceof ApiError ? err.message : (err as Error).message);
      setSuggestions([]);
      setSuggestMeta(null);
    } finally {
      setSuggestLoading(false);
    }
  }

  async function handleAcceptSuggestion(idx: number) {
    const c = suggestions[idx];
    if (!c) return;
    const baseTitle = c.reason || 'Suggestion';
    const t = window.prompt('Title for this clip?', baseTitle);
    if (t === null) return;
    const trimmed = t.trim();
    if (!trimmed) return;
    try {
      await createClipFromSuggestion(projectId, {
        title: trimmed.slice(0, 80),
        startSeconds: c.startSeconds,
        durationSeconds: c.durationSeconds,
        aspect: 'vertical',
      });
      setAcceptedIdx((prev) => {
        const next = new Set(prev);
        next.add(idx);
        return next;
      });
      await load();
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
                sourceDuration={sourceDuration}
                projectInFlight={projectInFlight}
                onRetry={() => void handleRetryClip(c.id)}
                onDelete={() => void handleDeleteClip(c.id)}
                onDuplicate={() => void handleDuplicate(c.id)}
                onUpdate={(patch, options) =>
                  void handleUpdateClip(c.id, patch, options)
                }
              />
            ))}
          </ul>
        )}
      </div>

      {/* ---------------- Highlight suggestions ---------------- */}
      <div className="card">
        <div className="section-head">
          <h2>Suggested clips</h2>
          {suggestions.length > 0 && (
            <span className="muted">{suggestions.length}</span>
          )}
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Detected from real scene changes and silence in the source video.
          No AI model is used.
        </p>
        <button
          className="btn btn-secondary"
          onClick={() => void handleSuggest()}
          disabled={suggestLoading || projectInFlight}
        >
          {suggestLoading
            ? 'Analyzing video…'
            : suggestions.length > 0
              ? '↻ Re-analyze'
              : '✨ Suggest clips'}
        </button>

        {suggestError && (
          <div className="alert alert-error" style={{ marginTop: 10 }}>
            <strong>Suggestion failed</strong>
            {suggestError}
          </div>
        )}

        {suggestMeta && (
          <p className="muted" style={{ marginTop: 8 }}>
            Detected {suggestMeta.sceneCount} scene change
            {suggestMeta.sceneCount === 1 ? '' : 's'} and{' '}
            {suggestMeta.silenceCount} silence region
            {suggestMeta.silenceCount === 1 ? '' : 's'} in the source.
          </p>
        )}

        {suggestions.length > 0 && (
          <ul className="clip-list" style={{ marginTop: 10 }}>
            {suggestions.map((c, idx) => (
              <SuggestionRow
                key={`${c.startSeconds}-${c.durationSeconds}-${idx}`}
                candidate={c}
                accepted={acceptedIdx.has(idx)}
                onAccept={() => void handleAcceptSuggestion(idx)}
              />
            ))}
          </ul>
        )}

        {suggestions.length === 0 && !suggestLoading && !suggestError && suggestMeta && (
          <p className="muted" style={{ marginTop: 10 }}>
            No candidates above the default thresholds. Try Re-analyze after
            editing the source, or lower the sensitivity later.
          </p>
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

        {aspect === 'vertical' && (
          <div className="field">
            <span className="field-label">Reframe</span>
            <div className="segmented">
              <button
                type="button"
                aria-pressed={reframe === 'pad'}
                onClick={() => setReframe('pad')}
                disabled={projectInFlight}
                title="Letterbox: fit the source inside the canvas with black bars"
              >
                Letterbox
              </button>
              <button
                type="button"
                aria-pressed={reframe === 'crop-center'}
                onClick={() => setReframe('crop-center')}
                disabled={projectInFlight}
                title="Fill the canvas, cropping the sides symmetrically"
              >
                Crop center
              </button>
              <button
                type="button"
                aria-pressed={reframe === 'crop-top'}
                onClick={() => setReframe('crop-top')}
                disabled={projectInFlight}
                title="Fill, anchored to the top of the source"
              >
                Crop top
              </button>
              <button
                type="button"
                aria-pressed={reframe === 'crop-bottom'}
                onClick={() => setReframe('crop-bottom')}
                disabled={projectInFlight}
                title="Fill, anchored to the bottom of the source"
              >
                Crop bottom
              </button>
            </div>
          </div>
        )}

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
  sourceDuration,
  projectInFlight,
  onRetry,
  onDelete,
  onDuplicate,
  onUpdate,
}: {
  clip: Clip;
  sourceDuration: number | null;
  projectInFlight: boolean;
  onRetry: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUpdate: (
    patch: {
      title: string;
      startSeconds: number;
      durationSeconds: number;
      aspect: 'vertical' | 'source';
    },
    options?: { render?: boolean },
  ) => void;
}) {
  const isPending = clip.status === 'pending' || clip.status === 'processing';
  const isFailed = clip.status === 'failed';
  const isDone = clip.status === 'completed' && clip.hasOutput;
  const [editing, setEditing] = useState(false);

  return (
    <li className="clip-row">
      <div className="clip-row-head">
        <div className="clip-row-title">{clip.title}</div>
        <ClipStatusPill status={clip.status} />
      </div>
      <div className="clip-row-meta muted">
        {formatDuration(clip.startSeconds)} →{' '}
        {formatDuration(clip.startSeconds + clip.durationSeconds)} ·{' '}
        {clip.durationSeconds.toFixed(1)}s · {clip.aspect === 'vertical' ? '9:16' : 'Source'} ·{' '}
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

      {isDone && !editing && (
        <div className="video-wrap" style={{ marginTop: 10 }}>
          <video
            src={`${clipOutputUrl(clip.id)}?v=${clip.updatedAt}`}
            controls
            playsInline
            preload="metadata"
          />
        </div>
      )}

      {editing ? (
        <ClipEditForm
          clip={clip}
          sourceDuration={sourceDuration}
          projectInFlight={projectInFlight}
          onCancel={() => setEditing(false)}
          onSave={(patch, render) => {
            onUpdate(patch, { render });
            setEditing(false);
          }}
        />
      ) : (
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
            className="btn btn-secondary"
            onClick={() => setEditing(true)}
            disabled={isPending}
            title="Edit title, start, duration, or format"
          >
            Edit
          </button>
          <button
            className="btn btn-ghost"
            onClick={onDuplicate}
            disabled={isPending || projectInFlight}
            title="Create a copy of this clip in the same project"
          >
            Duplicate
          </button>
          <button
            className="btn btn-ghost"
            onClick={onDelete}
            disabled={isPending}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

function ClipEditForm({
  clip,
  sourceDuration,
  projectInFlight,
  onSave,
  onCancel,
}: {
  clip: Clip;
  sourceDuration: number | null;
  projectInFlight: boolean;
  onSave: (
    patch: {
      title: string;
      startSeconds: number;
      durationSeconds: number;
      aspect: 'vertical' | 'source';
      reframe: 'pad' | 'crop-center' | 'crop-top' | 'crop-bottom';
    },
    render: boolean,
  ) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(clip.title);
  const [start, setStart] = useState(clip.startSeconds);
  const [duration, setDuration] = useState(clip.durationSeconds);
  const [aspect, setAspect] = useState<'vertical' | 'source'>(clip.aspect);
  const [reframe, setReframe] = useState<
    'pad' | 'crop-center' | 'crop-top' | 'crop-bottom'
  >(clip.reframe);

  const maxStart =
    sourceDuration !== null
      ? Math.max(0, Math.floor(sourceDuration) - 1)
      : Math.max(0, Math.floor(clip.startSeconds + clip.durationSeconds) - 1);

  // Live validation feedback.
  const titleEmpty = title.trim().length === 0;
  const end = start + duration;
  const overflow =
    sourceDuration !== null && end - sourceDuration > 0.5;
  const tooShort = duration < 0.1;
  const tooLong = duration > 600;
  const invalid = titleEmpty || overflow || tooShort || tooLong;

  const renderParamChanged =
    start !== clip.startSeconds ||
    duration !== clip.durationSeconds ||
    aspect !== clip.aspect ||
    reframe !== clip.reframe;

  return (
    <div className="card" style={{ marginTop: 10, background: 'var(--surface)' }}>
      <h2 style={{ marginBottom: 10 }}>Edit clip</h2>

      <label className="field">
        <span className="field-label">Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 80))}
          maxLength={80}
        />
      </label>

      <label className="field">
        <span className="field-label">Start at — {formatDuration(start)}</span>
        <input
          type="range"
          min={0}
          max={maxStart}
          step={0.1}
          value={Math.min(start, maxStart)}
          onChange={(e) => setStart(Number(e.target.value))}
        />
      </label>

      <label className="field">
        <span className="field-label">Clip length (seconds)</span>
        <input
          type="number"
          min={0.1}
          max={600}
          step={0.1}
          value={duration}
          onChange={(e) => setDuration(Math.max(0.1, Number(e.target.value) || 0.1))}
          inputMode="decimal"
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

      {aspect === 'vertical' && (
        <div className="field">
          <span className="field-label">Reframe</span>
          <div className="segmented">
            <button
              type="button"
              aria-pressed={reframe === 'pad'}
              onClick={() => setReframe('pad')}
            >
              Letterbox
            </button>
            <button
              type="button"
              aria-pressed={reframe === 'crop-center'}
              onClick={() => setReframe('crop-center')}
            >
              Crop center
            </button>
            <button
              type="button"
              aria-pressed={reframe === 'crop-top'}
              onClick={() => setReframe('crop-top')}
            >
              Crop top
            </button>
            <button
              type="button"
              aria-pressed={reframe === 'crop-bottom'}
              onClick={() => setReframe('crop-bottom')}
            >
              Crop bottom
            </button>
          </div>
        </div>
      )}

      {overflow && (
        <div className="alert alert-warn" style={{ marginBottom: 10 }}>
          End is past the source duration ({formatDuration(sourceDuration!)}).
        </div>
      )}
      {titleEmpty && (
        <p className="muted" style={{ marginBottom: 8 }}>A title is required.</p>
      )}

      <div className="btn-row">
        <button
          className="btn btn-primary"
          onClick={() => onSave({ title: title.trim(), startSeconds: start, durationSeconds: duration, aspect, reframe }, true)}
          disabled={invalid || projectInFlight}
        >
          {renderParamChanged ? 'Save & re-render' : 'Save title'}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
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

function SuggestionRow({
  candidate,
  accepted,
  onAccept,
}: {
  candidate: HighlightCandidate;
  accepted: boolean;
  onAccept: () => void;
}) {
  const pct = Math.round(candidate.score * 100);
  const b = candidate.signalBreakdown;
  return (
    <li className="clip-row">
      <div className="clip-row-head">
        <div className="clip-row-title">
          {formatDuration(candidate.startSeconds)} →{' '}
          {formatDuration(candidate.startSeconds + candidate.durationSeconds)}
        </div>
        <span className="pill pill-plan" title="Explainable signal score">
          {pct}% signal
        </span>
      </div>
      <div className="clip-row-meta muted">
        {candidate.reason}
        {candidate.wasClipped && ' · clipped at source boundary'}
      </div>
      <div className="signal-grid">
        <SignalBar label="Scene change" value={b.sceneChange} />
        <SignalBar label="Speech resumed" value={b.resumeFromSilence} />
        <SignalBar label="Audio activity" value={b.audioActivity} />
        <SignalBar label="Visual variance" value={b.visualVariance} />
        <SignalBar label="Duration fit" value={b.durationFit} />
        <SignalBar label="Position" value={b.position} />
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button
          className="btn btn-primary"
          onClick={onAccept}
          disabled={accepted}
        >
          {accepted ? '✓ Added' : '✂ Create clip from this'}
        </button>
      </div>
    </li>
  );
}

function SignalBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="signal-bar">
      <div className="signal-bar-label">{label}</div>
      <div className="signal-bar-track" aria-hidden="true">
        <div className="signal-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="signal-bar-value">{pct}%</div>
    </div>
  );
}
