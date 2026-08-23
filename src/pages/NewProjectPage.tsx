import { useRef, useState } from 'react';
import { uploadVideo, ApiError } from '../api/client.ts';
import type { Project } from '../api/types.ts';
import { TopBar } from '../components/TopBar.tsx';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { formatBytes } from '../lib/format.ts';

interface Props {
  onBack: () => void;
  onCreated: (project: Project) => void;
  ffmpegAvailable: boolean;
}

const ACCEPT = 'video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi';

export function NewProjectPage({ onBack, onCreated, ffmpegAvailable }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function pick(f: File | null | undefined) {
    setError(null);
    if (!f) return;
    setFile(f);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    setProgress(0);
    try {
      const project = await uploadVideo(file, setProgress);
      onCreated(project);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : `Upload failed: ${(err as Error).message}`,
      );
      setUploading(false);
      setProgress(null);
    }
  }

  return (
    <>
      <TopBar onBack={onBack} title="New project" />

      {!ffmpegAvailable && (
        <div className="alert alert-error">
          <strong>Video processing is offline</strong>
          Uploads are disabled because no FFmpeg binary is available on the server.
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <strong>Upload failed</strong>
          {error}
        </div>
      )}

      <div
        className={`dropzone${dragOver ? ' is-over' : ''}`}
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!uploading) pick(e.dataTransfer.files?.[0]);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
      >
        <div className="dropzone-icon" aria-hidden="true">
          {file ? '🎞' : '⬆'}
        </div>
        <div style={{ fontWeight: 600, marginTop: 8 }}>
          {file ? 'Change video' : 'Choose a video'}
        </div>
        <div className="dropzone-hint">MP4, MOV, M4V, WEBM, MKV or AVI</div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>

      {file && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>Selected file</h2>
          <dl className="info-grid">
            <dt>Filename</dt>
            <dd>{file.name}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(file.size)}</dd>
            <dt>Type</dt>
            <dd>{file.type || 'Unknown'}</dd>
          </dl>
          <p className="muted" style={{ marginTop: 12 }}>
            Duration and resolution are read on the server after upload, using the real decoder.
          </p>
        </div>
      )}

      {uploading && (
        <div className="card">
          <ProgressBar
            value={progress !== null && progress >= 1 ? null : progress}
            label={progress !== null && progress >= 1 ? 'Inspecting video…' : 'Uploading…'}
          />
        </div>
      )}

      <button
        className="btn btn-primary"
        disabled={!file || uploading || !ffmpegAvailable}
        onClick={handleUpload}
        style={{ marginTop: 6 }}
      >
        {uploading ? 'Uploading…' : 'Upload & continue'}
      </button>
    </>
  );
}
