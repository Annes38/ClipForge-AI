import type { CapabilitiesResponse, Project } from '../api/types.ts';
import { StatusPill } from '../components/StatusPill.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { CapabilityPanel } from '../components/CapabilityPanel.tsx';
import { formatBytes, formatRelativeTime } from '../lib/format.ts';

interface Props {
  projects: Project[];
  capabilities: CapabilitiesResponse | null;
  loading: boolean;
  error: string | null;
  onNewProject: () => void;
  onOpenProject: (id: string) => void;
}

export function DashboardPage({
  projects,
  capabilities,
  loading,
  error,
  onNewProject,
  onOpenProject,
}: Props) {
  return (
    <>
      <TopBar />

      <div style={{ marginBottom: 16 }}>
        <h1>Your clips</h1>
        <p className="muted">
          Turn long videos into real vertical clips, processed locally on your device&rsquo;s server.
        </p>
      </div>

      {error && (
        <div className="alert alert-error">
          <strong>Could not load projects</strong>
          {error}
        </div>
      )}

      {capabilities && !capabilities.ffmpeg.available && (
        <div className="alert alert-error">
          <strong>Video processing is offline</strong>
          {capabilities.ffmpeg.reason}
        </div>
      )}

      <button className="btn btn-primary" onClick={onNewProject}>
        ＋ New project
      </button>

      <div className="section-head">
        <h2>Projects</h2>
        {projects.length > 0 && <span className="muted">{projects.length}</span>}
      </div>

      {loading ? (
        <div className="card center">
          <p className="muted">Loading…</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon" aria-hidden="true">
            🎬
          </div>
          <h2>No projects yet</h2>
          <p className="muted">
            Upload a video to create your first clip. Your files stay on this machine.
          </p>
        </div>
      ) : (
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.id}>
              <button className="project-item" onClick={() => onOpenProject(p.id)}>
                <div className="project-thumb" aria-hidden="true">
                  {p.status === 'completed' ? '▶' : '🎞'}
                </div>
                <div className="project-meta">
                  <div className="project-name">{p.name}</div>
                  <div className="project-sub">
                    {formatBytes(p.sourceBytes)} · {formatRelativeTime(p.createdAt)}
                  </div>
                </div>
                <StatusPill status={p.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 20 }}>
        <CapabilityPanel data={capabilities} />
      </div>
    </>
  );
}
