/**
 * Progress display.
 *
 * When `value` is null we render an INDETERMINATE bar. We never invent a
 * percentage: a number is shown only when FFmpeg actually reported timing.
 */
export function ProgressBar({ value, label }: { value: number | null; label?: string }) {
  const pct = value === null ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={pct ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div
          className={`progress-fill${pct === null ? ' indeterminate' : ''}`}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className="muted" style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span>{pct === null ? 'Working…' : `${pct}%`}</span>
      </p>
    </div>
  );
}
