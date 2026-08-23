/**
 * Honest capability disclosure.
 *
 * ClipForge states plainly which features are implemented, which are
 * unavailable in this environment and why, and which are planned. Nothing
 * here is aspirational marketing copy.
 */
import type { Capability, CapabilitiesResponse, CapabilityState } from '../api/types.ts';

const PILL: Record<CapabilityState, { cls: string; label: string }> = {
  implemented: { cls: 'pill pill-ok', label: 'Live' },
  unavailable: { cls: 'pill pill-err', label: 'Unavailable' },
  planned: { cls: 'pill pill-plan', label: 'Planned' },
};

export function CapabilityPanel({ data }: { data: CapabilitiesResponse | null }) {
  if (!data) return null;

  const groups: Array<[string, Capability[]]> = [
    ['Working now', data.capabilities.filter((c) => c.state === 'implemented')],
    ['Not available in this environment', data.capabilities.filter((c) => c.state === 'unavailable')],
    ['Planned', data.capabilities.filter((c) => c.state === 'planned')],
  ];

  return (
    <details className="card">
      <summary>What ClipForge can and cannot do yet</summary>

      <div style={{ marginTop: 14 }}>
        {data.ffmpeg.available ? (
          <div className="alert alert-info">
            <strong>Video engine ready</strong>
            Using the bundled FFmpeg binary from <code>imageio-ffmpeg</code>. No system FFmpeg
            is required.
            <pre>{data.ffmpeg.version}</pre>
          </div>
        ) : (
          <div className="alert alert-error">
            <strong>Video engine unavailable</strong>
            {data.ffmpeg.reason ?? 'No FFmpeg binary could be located.'}
          </div>
        )}

        {groups.map(([title, caps]) =>
          caps.length === 0 ? null : (
            <div key={title} style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: '0.8rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>
                {title.toUpperCase()}
              </h2>
              <ul className="cap-list">
                {caps.map((c) => (
                  <li key={c.id} className="cap-item">
                    <div style={{ minWidth: 0 }}>
                      <div className="cap-label">{c.label}</div>
                      <div className="cap-detail">{c.detail}</div>
                    </div>
                    <span className={PILL[c.state].cls}>{PILL[c.state].label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
      </div>
    </details>
  );
}
