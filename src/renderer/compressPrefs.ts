import {
  COMPRESS_PRESETS,
  CUSTOM_PRESET_ID,
  DEFAULT_CUSTOM_SETTINGS,
  probeForSection,
  resolveVideoBitrateKbps
} from '../shared/compress'
import type { CompressSettings, VideoProbe } from '../shared/compress'
import type { CompressRequest } from '../shared/types'

// The compress dialog saves its choices here and the one-click button reuses them

export function loadCustomSettings(): CompressSettings {
  try {
    const saved = localStorage.getItem('clipit:compressCustom')
    if (saved) {
      return { ...DEFAULT_CUSTOM_SETTINGS, ...JSON.parse(saved) }
    }
  } catch {
    // Fall back to defaults
  }
  return DEFAULT_CUSTOM_SETTINGS
}

export function loadPresetId(): string {
  const saved = localStorage.getItem('clipit:compressPreset')
  if (saved === CUSTOM_PRESET_ID || COMPRESS_PRESETS.some(p => p.id === saved)) {
    return saved as string
  }
  return 'balanced'
}

export function loadDeleteOriginal(): boolean {
  return localStorage.getItem('clipit:compressDeleteOriginal') !== 'false'
}

export function settingsForPreset(presetId: string, custom: CompressSettings): CompressSettings {
  if (presetId === CUSTOM_PRESET_ID) return custom
  return COMPRESS_PRESETS.find(p => p.id === presetId)?.settings || custom
}

export function presetName(presetId: string): string {
  return COMPRESS_PRESETS.find(p => p.id === presetId)?.name || 'Custom'
}

export function buildCompressRequest(
  path: string,
  settings: CompressSettings,
  probe: VideoProbe,
  deleteOriginal: boolean,
  trim?: { start: number; end: number }
): CompressRequest {
  const section = probeForSection(probe, trim?.start, trim?.end)
  return {
    path,
    startTime: trim?.start,
    endTime: trim?.end,
    resolution: settings.resolution,
    fps: settings.fps,
    codec: settings.codec,
    videoBitrateKbps: resolveVideoBitrateKbps(settings, section),
    audioBitrateKbps: settings.audioBitrateKbps,
    deleteOriginal
  }
}
