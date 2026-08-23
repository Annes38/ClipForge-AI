export interface MediaInfo {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  formatName: string | null;
  frameRate: number | null;
}

export type ProjectStatus = 'created' | 'preparing' | 'processing' | 'completed' | 'failed';

export type ClipStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface OutputInfo {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  bytes: number;
  audioPreserved: boolean;
}

export interface Project {
  id: string;
  name: string;
  sourceFilename: string;
  sourceBytes: number;
  status: ProjectStatus;
  errorMessage: string | null;
  media: MediaInfo | null;
  output: OutputInfo | null;
  hasOutput: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Clip {
  id: string;
  projectId: string;
  title: string;
  startSeconds: number;
  durationSeconds: number;
  aspect: 'vertical' | 'source';
  status: ClipStatus;
  errorMessage: string | null;
  media: MediaInfo | null;
  output: OutputInfo | null;
  hasOutput: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  phase: 'preparing' | 'processing' | 'completed' | 'failed';
  progress: number | null;
  message: string;
  detail: string | null;
}

export type RenderJob = Job;

export type CapabilityState = 'implemented' | 'unavailable' | 'planned';

export interface Capability {
  id: string;
  label: string;
  state: CapabilityState;
  detail: string;
}

export interface CapabilitiesResponse {
  ffmpeg: { available: boolean; version?: string; source?: string; reason?: string };
  capabilities: Capability[];
}

export type AspectMode = 'vertical' | 'source';
