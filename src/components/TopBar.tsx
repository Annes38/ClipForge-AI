interface TopBarProps {
  onBack?: () => void;
  title?: string;
  action?: React.ReactNode;
}

export function TopBar({ onBack, title, action }: TopBarProps) {
  return (
    <header className="topbar">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="Go back">
          ←
        </button>
      ) : (
        <div className="brand-mark" aria-hidden="true">
          ✂
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        {title ? (
          <div className="project-name" style={{ fontWeight: 700 }}>
            {title}
          </div>
        ) : (
          <div className="brand" style={{ gap: 0, flexDirection: 'column', alignItems: 'flex-start' }}>
            <span>ClipForge AI</span>
            <span className="brand-sub">SHORT-FORM VIDEO STUDIO</span>
          </div>
        )}
      </div>
      <div className="spacer" />
      {action}
    </header>
  );
}
