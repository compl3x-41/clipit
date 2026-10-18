import { useEffect, useState } from 'react'
import { Trash2, Undo2 } from 'lucide-react'
import { useApp } from '../context/AppContext'

export default function UndoDeleteBar() {
  const { pendingDeletes, undoDelete } = useApp()
  const [now, setNow] = useState(Date.now())

  // Tick the countdowns while anything is waiting
  useEffect(() => {
    if (pendingDeletes.length === 0) return
    const interval = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(interval)
  }, [pendingDeletes.length])

  if (pendingDeletes.length === 0) return null

  return (
    <div className="undo-delete-container">
      {pendingDeletes.map((pending) => {
        const secondsLeft = Math.max(0, Math.ceil((pending.expiresAt - now) / 1000))
        const label = pending.clips.length === 1 ? pending.clips[0].name : `${pending.clips.length} clips`
        return (
          <div className="undo-delete" key={pending.id}>
            <Trash2 size={16} />
            <span className="undo-delete-message">
              Deleted <span className="undo-delete-name" title={label}>{label}</span>
            </span>
            <button className="btn btn-primary undo-delete-btn" onClick={() => undoDelete(pending.id)}>
              <Undo2 size={14} />
              Undo ({secondsLeft}s)
            </button>
          </div>
        )
      })}
    </div>
  )
}
