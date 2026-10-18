// Compression presets and size estimation shared between main and renderer

export type CompressResolution = 'original' | '1440' | '1080' | '720' | '480'
export type CompressFps = 'original' | '60' | '30'
export type CompressCodec = 'h264' | 'h265'
export type CompressMode = 'bitrate' | 'size'

export interface CompressSettings {
  resolution: CompressResolution
  fps: CompressFps
  codec: CompressCodec
  mode: CompressMode
  videoBitrateKbps: number // used when mode === 'bitrate'
  targetSizeMb: number // used when mode === 'size'
  audioBitrateKbps: number
}

export interface CompressPreset {
  id: string
  name: string
  description: string
  settings: CompressSettings
}

export const CUSTOM_PRESET_ID = 'custom'

export const COMPRESS_PRESETS: CompressPreset[] = [
  {
    id: 'high',
    name: 'High Quality',
    description: '1080p, original FPS, 10 Mbps',
    settings: { resolution: '1080', fps: 'original', codec: 'h264', mode: 'bitrate', videoBitrateKbps: 10000, targetSizeMb: 0, audioBitrateKbps: 160 }
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: '1080p, original FPS, 6 Mbps',
    settings: { resolution: '1080', fps: 'original', codec: 'h264', mode: 'bitrate', videoBitrateKbps: 6000, targetSizeMb: 0, audioBitrateKbps: 128 }
  },
  {
    id: 'small',
    name: 'Small',
    description: '720p, 30 FPS, 2.5 Mbps',
    settings: { resolution: '720', fps: '30', codec: 'h264', mode: 'bitrate', videoBitrateKbps: 2500, targetSizeMb: 0, audioBitrateKbps: 96 }
  },
  {
    id: 'discord',
    name: 'Discord (10 MB)',
    description: '720p, 30 FPS, fits under 10 MB',
    settings: { resolution: '720', fps: '30', codec: 'h264', mode: 'size', videoBitrateKbps: 0, targetSizeMb: 10, audioBitrateKbps: 96 }
  }
]

export const DEFAULT_CUSTOM_SETTINGS: CompressSettings = {
  resolution: 'original',
  fps: 'original',
  codec: 'h264',
  mode: 'bitrate',
  videoBitrateKbps: 8000,
  targetSizeMb: 25,
  audioBitrateKbps: 128
}

export interface VideoProbe {
  duration: number
  width: number
  height: number
  fps: number
  sizeBytes: number
  bitrateKbps: number // overall bitrate of the source
}

/**
 * Scale the probe down to a trimmed section so estimates and target sizes
 * are based on the part that will actually be encoded
 */
export function probeForSection(probe: VideoProbe, startTime?: number, endTime?: number): VideoProbe {
  if (startTime === undefined || endTime === undefined || probe.duration <= 0) return probe
  const duration = Math.max(0, Math.min(endTime, probe.duration) - Math.max(startTime, 0))
  return { ...probe, duration, sizeBytes: Math.round(probe.sizeBytes * (duration / probe.duration)) }
}

// Leaves room for container overhead and encoder overshoot in target-size mode
const TARGET_SIZE_SAFETY = 0.92
const MIN_VIDEO_KBPS = 150

/**
 * Work out the video bitrate to encode at for the given settings and source
 */
export function resolveVideoBitrateKbps(settings: CompressSettings, probe: VideoProbe): number {
  let kbps: number
  if (settings.mode === 'size') {
    const totalKbps = (settings.targetSizeMb * 1024 * 1024 * 8) / 1000 / Math.max(probe.duration, 0.1)
    kbps = totalKbps * TARGET_SIZE_SAFETY - settings.audioBitrateKbps
  } else {
    kbps = settings.videoBitrateKbps
  }

  // Never encode above the source bitrate, it only makes the file bigger
  if (probe.bitrateKbps > 0) {
    kbps = Math.min(kbps, probe.bitrateKbps)
  }

  return Math.max(MIN_VIDEO_KBPS, Math.round(kbps))
}

/**
 * Estimated output size in MB
 */
export function estimateSizeMb(settings: CompressSettings, probe: VideoProbe): number {
  const totalKbps = resolveVideoBitrateKbps(settings, probe) + settings.audioBitrateKbps
  const bytes = (totalKbps * 1000 * probe.duration) / 8
  return Math.round((bytes * 1.01) / (1024 * 1024) * 10) / 10
}

/**
 * Output height, or null to keep the source height (never upscales)
 */
export function resolveOutputHeight(resolution: CompressResolution, sourceHeight: number): number | null {
  if (resolution === 'original') return null
  const target = parseInt(resolution, 10)
  if (sourceHeight > 0 && target >= sourceHeight) return null
  return target
}

/**
 * Output fps, or null to keep the source fps (never raises it)
 */
export function resolveOutputFps(fps: CompressFps, sourceFps: number): number | null {
  if (fps === 'original') return null
  const target = parseInt(fps, 10)
  if (sourceFps > 0 && target >= sourceFps) return null
  return target
}
