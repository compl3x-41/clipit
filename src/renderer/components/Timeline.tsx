import { useRef, useState, useEffect, useCallback } from 'react'

interface TimelineProps {
  duration: number
  currentTime: number
  trimStart: number
  trimEnd: number
  onSeek: (time: number) => void
  onTrimStartChange: (time: number) => void
  onTrimEndChange: (time: number) => void
  // Image URLs spread evenly across the clip; shows a filmstrip with hover previews
  frames?: string[]
}

function formatHoverTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function Timeline({
  duration,
  currentTime,
  trimStart,
  trimEnd,
  onSeek,
  onTrimStartChange,
  onTrimEndChange,
  frames
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'start' | 'end' | 'playhead' | null>(null)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
  const hasFrames = !!frames && frames.some(Boolean)

  const getTimeFromPosition = useCallback((clientX: number) => {
    if (!containerRef.current) return 0
    const rect = containerRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const ratio = Math.max(0, Math.min(1, x / rect.width))
    return ratio * duration
  }, [duration])

  const handleMouseDown = useCallback((e: React.MouseEvent, type: 'start' | 'end' | 'playhead') => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(type)
  }, [])

  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if (dragging) return
    const time = getTimeFromPosition(e.clientX)
    onSeek(time)
  }, [dragging, getTimeFromPosition, onSeek])

  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const time = getTimeFromPosition(e.clientX)

      switch (dragging) {
        case 'start':
          onTrimStartChange(Math.min(time, trimEnd - 0.1))
          break
        case 'end':
          onTrimEndChange(Math.max(time, trimStart + 0.1))
          break
        case 'playhead':
          onSeek(time)
          break
      }
    }

    const handleMouseUp = () => {
      setDragging(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, getTimeFromPosition, onSeek, onTrimStartChange, onTrimEndChange, trimStart, trimEnd])

  const startPercent = duration > 0 ? (trimStart / duration) * 100 : 0
  const endPercent = duration > 0 ? (trimEnd / duration) * 100 : 100
  const playheadPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  const handleHover = (e: React.MouseEvent) => {
    if (!hasFrames || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setHoverRatio(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
  }

  const hoverFrame = hasFrames && hoverRatio !== null
    ? frames![Math.min(frames!.length - 1, Math.floor(hoverRatio * frames!.length))]
    : null

  return (
    <div
      className={`timeline ${hasFrames ? 'timeline-filmstrip' : ''}`}
      ref={containerRef}
      onClick={handleTimelineClick}
      onMouseMove={handleHover}
      onMouseLeave={() => setHoverRatio(null)}
    >
      {hasFrames ? (
        <>
          <div className="timeline-frames">
            {frames!.map((frame, i) => (
              frame
                ? <img key={i} src={frame} alt="" draggable={false} />
                : <div key={i} className="timeline-frame-missing" />
            ))}
            {/* Darken what the trim cuts away */}
            <div className="timeline-dim" style={{ left: 0, width: `${startPercent}%` }} />
            <div className="timeline-dim" style={{ left: `${endPercent}%`, right: 0 }} />
          </div>
          <div className="timeline-range" style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }} />
          {hoverRatio !== null && !dragging && (
            <div className="timeline-hover-preview" style={{ left: `clamp(84px, ${hoverRatio * 100}%, calc(100% - 84px))` }}>
              {hoverFrame && <img src={hoverFrame} alt="" />}
              <span>{formatHoverTime(hoverRatio * duration)}</span>
            </div>
          )}
        </>
      ) : (
        /* Background bar */
        <div className="timeline-bar" />
      )}

      {/* Selected range */}
      {!hasFrames && <div
        className="timeline-progress"
        style={{
          left: `${startPercent}%`,
          width: `${endPercent - startPercent}%`
        }}
      />}

      {/* Start handle */}
      <div
        className="timeline-handle start"
        style={{ left: `${startPercent}%`, transform: 'translateX(-50%)' }}
        onMouseDown={(e) => handleMouseDown(e, 'start')}
      />

      {/* End handle */}
      <div
        className="timeline-handle end"
        style={{ left: `${endPercent}%`, transform: 'translateX(-50%)' }}
        onMouseDown={(e) => handleMouseDown(e, 'end')}
      />

      {/* Playhead */}
      <div
        className="timeline-playhead"
        style={{ left: `${playheadPercent}%`, transform: 'translateX(-50%)' }}
      />
    </div>
  )
}
