/**
 * API client.
 *
 * All requests use RELATIVE URLs so they work behind the Vite dev proxy and
 * in production alike. The browser never talks to localhost directly.
 */
import type { CapabilitiesResponse, Job, Project } from './types.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON response (e.g. a proxy error page).
  }
  if (!res.ok) {
    const message =
      (body as { error?: string } | null)?.error ??
      `Request failed with status ${res.status}.`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export async function fetchCapabilities(): Promise<CapabilitiesResponse> {
  return parse<CapabilitiesResponse>(await fetch('/api/capabilities'));
}

export async function fetchProjects(): Promise<Project[]> {
  const data = await parse<{ projects: Project[] }>(await fetch('/api/projects'));
  return data.projects;
}

export async function fetchProject(id: string): Promise<{ project: Project; job: Job | null }> {
  return parse<{ project: Project; job: Job | null }>(await fetch(`/api/projects/${id}`));
}

/** Upload with real progress via XHR (fetch cannot report upload progress). */
export function uploadVideo(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<Project> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('video', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/projects');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError('Network error during upload.', 0));
    xhr.onabort = () => reject(new ApiError('Upload cancelled.', 0));
    xhr.onload = () => {
      let body: { project?: Project; error?: string } | null = null;
      try {
        body = JSON.parse(xhr.responseText) as { project?: Project; error?: string };
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.project) {
        resolve(body.project);
      } else {
        reject(new ApiError(body?.error ?? `Upload failed (status ${xhr.status}).`, xhr.status));
      }
    };
    xhr.send(form);
  });
}

export async function startProcessing(
  id: string,
  params: { startSeconds: number; durationSeconds: number; aspect: string },
): Promise<Job> {
  const data = await parse<{ job: Job }>(
    await fetch(`/api/projects/${id}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),
  );
  return data.job;
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) await parse(res);
}

export const outputUrl = (id: string) => `/api/projects/${id}/output`;
export const downloadUrl = (id: string) => `/api/projects/${id}/download`;
