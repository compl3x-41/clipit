import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import { ALL_CLIPS } from '../../shared/types'
import type { Clip } from '../../shared/types'
import type { VideoProbe } from '../../shared/compress'

// Probing runs ffprobe, so each clip is only read once per session
const probeCache = new Map<string, Promise<VideoProbe | null>>()

function probeOnce(clip: Clip): Promise<VideoProbe | null> {
  const cacheKey = `${clip.path}|${clip.modified}|${clip.sizeMb}`
  let pending = probeCache.get(cacheKey)
  if (!pending) {
    pending = window.clipit.probeVideo(clip.path).catch(() => null)
    probeCache.set(cacheKey, pending)
  }
  return pending
}

export function formatUkDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB')
}

export function formatUkTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function formatLength(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

interface ClipHoverCardProps {
  clip: Clip
  // Where to draw the card: the hovered row's top edge and the sidebar's right edge
  top: number
  left: number
}

export default function ClipHoverCard({ clip, top, left }: ClipHoverCardProps) {
  const [probe, setProbe] = useState<VideoProbe | null>(null)
  const { people, selectedGame } = useApp()

  useEffect(() => {
    setProbe(null)
    if (clip.type !== 'video') return
    let cancelled = false
    probeOnce(clip).then(result => { if (!cancelled) setProbe(result) })
    return () => { cancelled = true }
  }, [clip])

  // Keep the card on screen near the bottom of the list
  const clampedTop = Math.max(8, Math.min(top, window.innerHeight - 240))

  const rows: [string, string][] = [
    ['Recorded', `${formatUkDate(clip.modified)} ${formatUkTime(clip.modified)}`],
    ['Size', `${clip.sizeMb} MB`]
  ]
  if (selectedGame === ALL_CLIPS) rows.unshift(['Game', clip.game])
  const friends = people.filter(p => clip.people?.includes(p.id)).map(p => p.name)
  if (friends.length > 0) rows.push(['Friends', friends.join(', ')])
  if (clip.type === 'video') {
    rows.push(
      ['Length', probe ? formatLength(probe.duration) : '…'],
      ['Resolution', probe ? `${probe.width}×${probe.height}` : '…'],
      ['Frame rate', probe ? `${Math.round(probe.fps)} FPS` : '…'],
      ['Bitrate', probe ? `${(probe.bitrateKbps / 1000).toFixed(1)} Mbps` : '…'],
      ['Edited', clip.edited ? 'Yes' : 'Not yet']
    )
  }

  return (
    <div className="clip-hover-card" style={{ top: clampedTop, left }}>
      <div className="clip-hover-name">{clip.name}</div>
      <div className="clip-hover-rows">
        {rows.map(([label, value]) => (
          <div className="clip-hover-row" key={label}>
            <span>{label}</span>
            <span className={label === 'Edited' && !clip.edited ? 'clip-hover-unedited' : ''}>{value}</span>
          </div>
        ))}
      </div>
      <div className="clip-hover-path">{clip.path}</div>
    </div>
  )
}
