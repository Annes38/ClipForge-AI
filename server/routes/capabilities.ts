/**
 * Capability reporting.
 *
 * ClipForge must always be honest about what it can and cannot do. This
 * endpoint reports the REAL, probed state of the environment plus an explicit
 * roadmap so the UI can distinguish:
 *   implemented | unavailable | planned
 *
 * The `unavailable` entries below reflect the repository audit and are
 * re-verified at runtime where cheaply possible.
 */
import { Router } from 'express';
import { probeFfmpeg } from '../media/ffmpeg-locator.ts';

export const capabilitiesRouter = Router();

export type CapabilityState = 'implemented' | 'unavailable' | 'planned';

export interface Capability {
  id: string;
  label: string;
  state: CapabilityState;
  detail: string;
}

capabilitiesRouter.get('/', (_req, res) => {
  const ffmpeg = probeFfmpeg();

  const capabilities: Capability[] = [
    {
      id: 'upload',
      label: 'Video upload & storage',
      state: 'implemented',
      detail: 'Uploads are validated, stored on disk and tracked in SQLite.',
    },
    {
      id: 'inspect',
      label: 'Media inspection',
      state: ffmpeg.available ? 'implemented' : 'unavailable',
      detail: ffmpeg.available
        ? 'Duration, resolution, codecs and streams are parsed from FFmpeg. ffprobe is not installed, so the FFmpeg banner is parsed instead.'
        : 'Requires the imageio-ffmpeg binary.',
    },
    {
      id: 'clip',
      label: 'Real clip cutting',
      state: ffmpeg.available ? 'implemented' : 'unavailable',
      detail: ffmpeg.available
        ? 'Cuts a real segment and re-encodes it to H.264/AAC MP4.'
        : 'Requires the imageio-ffmpeg binary.',
    },
    {
      id: 'vertical',
      label: '9:16 vertical reframing',
      state: ffmpeg.available ? 'implemented' : 'unavailable',
      detail: ffmpeg.available
        ? 'Scale + pad to a true 1080x1920 canvas with square pixels.'
        : 'Requires the imageio-ffmpeg binary.',
    },
    {
      id: 'transcription',
      label: 'Transcription',
      state: 'unavailable',
      detail:
        'Whisper model weights cannot be downloaded in this environment (network/TLS blocked) and no free external transcription API is assumed. Not implemented — no fake transcripts are produced.',
    },
    {
      id: 'scene-detection',
      label: 'Scene / shot detection',
      state: 'unavailable',
      detail:
        'OpenCV cannot load because libGL.so.1 is missing and apt is unavailable. Deferred rather than faked.',
    },
    {
      id: 'highlight-ai',
      label: 'AI highlight detection & scoring',
      state: 'planned',
      detail:
        'Depends on transcription. No heuristic score is shown, because an invented score would be a fake result.',
    },
    {
      id: 'captions',
      label: 'Burned-in captions',
      state: 'planned',
      detail: 'Depends on transcription. FFmpeg-side rendering is ready to build on.',
    },
    {
      id: 'multi-clip',
      label: 'Multiple clips per project',
      state: ffmpeg.available ? 'implemented' : 'unavailable',
      detail: ffmpeg.available
        ? 'Projects can hold any number of independent clips; each has its own metadata, status and rendered output.'
        : 'Requires the imageio-ffmpeg binary.',
    },
  ];

  res.json({
    ffmpeg: ffmpeg.available
      ? { available: true, version: ffmpeg.version, source: 'imageio-ffmpeg' }
      : { available: false, reason: ffmpeg.reason },
    capabilities,
  });
});
