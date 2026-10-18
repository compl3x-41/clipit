import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { splitFileName } from '../../shared/clipNames'

interface ClipTitleProps {
  name: string
  // Resolves true when the rename worked, so the editor can close
  onRename: (newName: string) => Promise<boolean>
  // Opens the rename box whenever this number changes
  editRequest?: number
  onClose?: (reason: 'saved' | 'unchanged' | 'cancelled') => void
  // Shown under the box, e.g. that the rename waits for compressing
  hint?: string
}

const splitName = splitFileName

/**
 * The clip's file name; one click turns it into a rename box
 */
export default function ClipTitle({ name, onRename, editRequest, onClose, hint }: ClipTitleProps) {
  const [base, ext] = splitName(name)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(base)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    setEditing(false)
    setValue(splitName(name)[0])
  }, [name])

  useEffect(() => {
    if (editRequest) setEditing(true)
  }, [editRequest])

  useEffect(() => {
    if (editing) {
      cancelled.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const submit = async () => {
    if (saving) return
    const trimmed = value.trim()
    if (!trimmed || trimmed === base) {
      setEditing(false)
      setValue(base)
      onClose?.('unchanged')
      return
    }
    setSaving(true)
    const ok = await onRename(trimmed + ext)
    setSaving(false)
    if (ok) {
      setEditing(false)
      onClose?.('saved')
    } else {
      inputRef.current?.focus()
    }
  }

  if (editing) {
    return (
      <div className="clip-title editing">
        <input
          ref={inputRef}
          className="clip-title-input"
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Keep player and list shortcuts out of the way while typing
            e.stopPropagation()
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') {
              cancelled.current = true
              setEditing(false)
              setValue(base)
              onClose?.('cancelled')
            }
          }}
          onBlur={() => {
            // Escape unmounts the box, which blurs it; that isn't a save
            if (cancelled.current) cancelled.current = false
            else submit()
          }}
        />
        <span className="clip-title-ext">{ext}</span>
        {hint && <span className="clip-title-hint">{hint}</span>}
      </div>
    )
  }

  return (
    <button className="clip-title" onClick={() => setEditing(true)} title="Click to rename">
      <span className="clip-title-name">{base}</span>
      <span className="clip-title-ext">{ext}</span>
      <Pencil size={12} className="clip-title-icon" />
    </button>
  )
}
