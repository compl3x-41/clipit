import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { useApp } from '../context/AppContext'

function hasFiles(event: DragEvent): boolean {
  return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')
}

// Drag a video or picture from Explorer onto the window to open it
export default function FileDropZone() {
  const { openFile, addToast } = useApp()
  const [dragging, setDragging] = useState(false)
  // dragenter and dragleave fire for every element crossed, so count them
  const depth = useRef(0)
  const openRef = useRef({ openFile, addToast })
  openRef.current = { openFile, addToast }

  useEffect(() => {
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current++
      setDragging(true)
    }
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      // Without this, Electron navigates the whole window to the dropped file
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      const filePath = files[0] && window.clipit.getPathForFile(files[0])
      if (!filePath) return
      if (files.length > 1) openRef.current.addToast('Opened the first file. Drop one file at a time.', 'info')
      openRef.current.openFile(filePath)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  if (!dragging) return null
  return (
    <div className="file-drop-zone">
      <div className="file-drop-card">
        <Upload size={36} />
        <div className="file-drop-title">Drop to open in Clipit</div>
        <div className="file-drop-hint">Videos and pictures from anywhere. Edits are saved next to the file.</div>
      </div>
    </div>
  )
}
