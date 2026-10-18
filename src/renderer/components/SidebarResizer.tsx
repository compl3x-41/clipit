import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'clipit:sidebarWidth'
const DEFAULT_WIDTH = 280
const MIN_WIDTH = 220
// Always leave the player at least this much room
const MIN_PLAYER_WIDTH = 420

function clampWidth(width: number): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, window.innerWidth - MIN_PLAYER_WIDTH)))
}

function loadWidth(): number {
  try {
    const saved = parseInt(localStorage.getItem(STORAGE_KEY) || '', 10)
    if (saved > 0) return clampWidth(saved)
  } catch {
    // Fall back to the default
  }
  return DEFAULT_WIDTH
}

/**
 * Drag handle on the sidebar's right edge. Double-click resets the width.
 */
export default function SidebarResizer() {
  const [width, setWidth] = useState(loadWidth)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`)
  }, [width])

  useEffect(() => {
    const handleResize = () => setWidth(w => clampWidth(w))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const handleMove = (e: MouseEvent) => setWidth(clampWidth(e.clientX))
    const handleUp = () => setDragging(false)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [dragging])

  // Save once the drag ends rather than on every pixel
  useEffect(() => {
    if (dragging) return
    try {
      localStorage.setItem(STORAGE_KEY, String(width))
    } catch {
      // Width still applies for this session
    }
  }, [dragging, width])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  return (
    <div
      className={`sidebar-resizer ${dragging ? 'dragging' : ''}`}
      onMouseDown={handleMouseDown}
      onDoubleClick={() => setWidth(clampWidth(DEFAULT_WIDTH))}
      title="Drag to resize, double-click to reset"
    />
  )
}
