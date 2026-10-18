import { useState, useEffect, useMemo, useCallback } from 'react'
import { X, Minimize2, AlertTriangle, Scissors } from 'lucide-react'
import { COMPRESS_PRESETS, CUSTOM_PRESET_ID, estimateSizeMb, probeForSection } from '../../shared/compress'
import { buildCompressRequest, loadCustomSettings, loadDeleteOriginal, loadPresetId, settingsForPreset } from '../compressPrefs'
import type { CompressSettings, VideoProbe } from '../../shared/compress'
import type { Clip, CompressRequest } from '../../shared/types'

interface CompressModalProps {
  clip: Clip
  // Set when the clip has in/out points, only that part is encoded
  trim?: { start: number; end: number }
  onClose: () => void
  // Hands the job to the background queue; the dialog closes right after
  onStart: (request: CompressRequest) => void
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = (seconds % 60).toFixed(1).padStart(4, '0')
  return `${mins}:${secs}`
}

export default function CompressModal({ clip, trim, onClose, onStart }: CompressModalProps) {
  const [probe, setProbe] = useState<VideoProbe | null>(null)
  const [probeFailed, setProbeFailed] = useState(false)
  const [presetId, setPresetId] = useState<string>(loadPresetId)
  const [custom, setCustom] = useState<CompressSettings>(loadCustomSettings)
  const [bitrateInput, setBitrateInput] = useState(() => String(loadCustomSettings().videoBitrateKbps / 1000))
  const [sizeInput, setSizeInput] = useState(() => String(loadCustomSettings().targetSizeMb))
  const [deleteOriginal, setDeleteOriginal] = useState(loadDeleteOriginal)

  useEffect(() => {
    let cancelled = false
    window.clipit.probeVideo(clip.path).then((result) => {
      if (cancelled) return
      if (result && result.duration > 0) {
        setProbe(result)
      } else {
        setProbeFailed(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [clip.path])

  const activeSettings = useMemo<CompressSettings>(() => settingsForPreset(presetId, custom), [presetId, custom])

  // Estimates and target sizes are for the part that will be encoded
  const section = probe ? probeForSection(probe, trim?.start, trim?.end) : null
  const originalSizeMb = section ? Math.round(section.sizeBytes / (1024 * 1024) * 10) / 10 : clip.sizeMb
  const estimate = section ? estimateSizeMb(activeSettings, section) : null
  const savingPercent = estimate !== null && originalSizeMb > 0
    ? Math.round((1 - estimate / originalSizeMb) * 100)
    : null
  const customValid = presetId !== CUSTOM_PRESET_ID || (
    custom.mode === 'bitrate' ? custom.videoBitrateKbps > 0 : custom.targetSizeMb > 0
  )

  const handleSelectPreset = useCallback((id: string) => {
    setPresetId(id)
    localStorage.setItem('clipit:compressPreset', id)
  }, [])

  const updateCustom = useCallback((changes: Partial<CompressSettings>) => {
    setCustom(prev => {
      const next = { ...prev, ...changes }
      localStorage.setItem('clipit:compressCustom', JSON.stringify(next))
      return next
    })
  }, [])

  const handleDeleteOriginalChange = useCallback((value: boolean) => {
    setDeleteOriginal(value)
    localStorage.setItem('clipit:compressDeleteOriginal', String(value))
  }, [])

  const handleStart = useCallback(() => {
    if (!probe || !customValid) return
    onStart(buildCompressRequest(clip.path, activeSettings, probe, deleteOriginal, trim))
  }, [probe, trim, customValid, deleteOriginal, clip.path, activeSettings, onStart])

  // Keep shortcuts for the player and clip list from firing while the dialog is open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        handleStart()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose, handleStart])

  return (
    <div className="modal-overlay">
      <div className="modal compress-modal">
        <div className="modal-header">
          <h2 className="modal-title">Compress Clip</h2>
          <button className="modal-close-btn" onClick={onClose} title="Close (Esc)">
            <X size={20} />
          </button>
        </div>

        <div className="modal-content">
          <div className="compress-source">
            <div className="compress-source-name" title={clip.name}>{clip.name}</div>
            <div className="compress-source-info">
              {probe
                ? `${probe.width}×${probe.height} • ${Math.round(probe.fps)} FPS • ${formatDuration(probe.duration)} • ${Math.round(probe.sizeBytes / (1024 * 1024) * 10) / 10} MB (${(probe.bitrateKbps / 1000).toFixed(1)} Mbps)`
                : probeFailed ? 'Could not read video information' : 'Reading video information...'}
            </div>
            {trim && (
              <div className="compress-trim-note">
                <Scissors size={13} />
                <span>
                  Only the trimmed part {formatTimestamp(trim.start)} – {formatTimestamp(trim.end)} ({formatDuration(trim.end - trim.start)}) will be compressed
                  {deleteOriginal ? ', and it replaces the original.' : '.'}
                </span>
              </div>
            )}
          </div>

          <div className="modal-section">
            <div className="modal-section-title">Preset</div>
            <div className="compress-presets">
              {COMPRESS_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={`compress-preset ${presetId === preset.id ? 'selected' : ''}`}
                  onClick={() => handleSelectPreset(preset.id)}
                >
                  <span className="compress-preset-name">{preset.name}</span>
                  <span className="compress-preset-desc">{preset.description}</span>
                  <span className="compress-preset-size">
                    {section ? `~${estimateSizeMb(preset.settings, section)} MB` : '—'}
                  </span>
                </button>
              ))}
              <button
                className={`compress-preset ${presetId === CUSTOM_PRESET_ID ? 'selected' : ''}`}
                onClick={() => handleSelectPreset(CUSTOM_PRESET_ID)}
              >
                <span className="compress-preset-name">Custom</span>
                <span className="compress-preset-desc">Pick your own settings</span>
                <span className="compress-preset-size">
                  {section ? `~${estimateSizeMb(custom, section)} MB` : '—'}
                </span>
              </button>
            </div>
          </div>

          {presetId === CUSTOM_PRESET_ID && (
            <div className="modal-section compress-custom">
              <div className="form-group">
                <label className="form-label">Resolution</label>
                <select
                  className="form-select"
                  value={custom.resolution}
                  onChange={(e) => updateCustom({ resolution: e.target.value as CompressSettings['resolution'] })}
                >
                  <option value="original">Original</option>
                  <option value="1440">1440p</option>
                  <option value="1080">1080p</option>
                  <option value="720">720p</option>
                  <option value="480">480p</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Frame Rate</label>
                <select
                  className="form-select"
                  value={custom.fps}
                  onChange={(e) => updateCustom({ fps: e.target.value as CompressSettings['fps'] })}
                >
                  <option value="original">Original</option>
                  <option value="60">60 FPS</option>
                  <option value="30">30 FPS</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Codec</label>
                <select
                  className="form-select"
                  value={custom.codec}
                  onChange={(e) => updateCustom({ codec: e.target.value as CompressSettings['codec'] })}
                >
                  <option value="h264">H.264 (plays everywhere)</option>
                  <option value="h265">H.265 (smaller, less compatible)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Audio</label>
                <select
                  className="form-select"
                  value={custom.audioBitrateKbps}
                  onChange={(e) => updateCustom({ audioBitrateKbps: parseInt(e.target.value, 10) })}
                >
                  <option value={64}>64 kbps</option>
                  <option value={96}>96 kbps</option>
                  <option value={128}>128 kbps</option>
                  <option value={160}>160 kbps</option>
                  <option value={192}>192 kbps</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Size Control</label>
                <select
                  className="form-select"
                  value={custom.mode}
                  onChange={(e) => updateCustom({ mode: e.target.value as CompressSettings['mode'] })}
                >
                  <option value="bitrate">Video bitrate</option>
                  <option value="size">Target file size</option>
                </select>
              </div>
              <div className="form-group">
                {custom.mode === 'bitrate' ? (
                  <>
                    <label className="form-label">Video Bitrate (Mbps)</label>
                    <input
                      className="form-input"
                      type="number"
                      min={0.2}
                      step={0.5}
                      value={bitrateInput}
                      onChange={(e) => {
                        setBitrateInput(e.target.value)
                        const value = parseFloat(e.target.value)
                        updateCustom({ videoBitrateKbps: value > 0 ? Math.round(value * 1000) : 0 })
                      }}
                    />
                  </>
                ) : (
                  <>
                    <label className="form-label">Target Size (MB)</label>
                    <input
                      className="form-input"
                      type="number"
                      min={1}
                      step={1}
                      value={sizeInput}
                      onChange={(e) => {
                        setSizeInput(e.target.value)
                        const value = parseFloat(e.target.value)
                        updateCustom({ targetSizeMb: value > 0 ? value : 0 })
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          )}

          <div className="compress-estimate">
            <span>{originalSizeMb} MB</span>
            <span className="compress-estimate-arrow">→</span>
            <span className="compress-estimate-new">{estimate !== null ? `~${estimate} MB` : '—'}</span>
            {savingPercent !== null && savingPercent > 0 && (
              <span className="compress-estimate-saving">{savingPercent}% smaller</span>
            )}
          </div>
          {savingPercent !== null && savingPercent <= 5 && (
            <div className="compress-warning">
              <AlertTriangle size={14} />
              <span>This clip is already about this size or smaller. Pick a lower preset to save space.</span>
            </div>
          )}

          <label className="form-checkbox compress-delete-option">
            <input
              type="checkbox"
              checked={deleteOriginal}
              onChange={(e) => handleDeleteOriginalChange(e.target.checked)}
            />
            Delete the original after compressing
          </label>
          <div className="compress-background-note">Runs in the background, so you can keep working on other clips.</div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleStart}
            disabled={!section || !customValid}
          >
            <Minimize2 size={16} />
            {deleteOriginal ? 'Compress & Replace' : 'Compress Copy'}
          </button>
        </div>
      </div>
    </div>
  )
}
