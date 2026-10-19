import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { splitFileName } from '../../shared/clipNames'

type CloseReason = 'enter' | 'escape' | 'blur'

interface ClipTitleProps {
  name: string
  // Resolves true when the new name was accepted, so the editor can close
  onRename: (newName: string) => Promise<boolean>
  // Opens the rename box whenever this number changes
  editRequest?: number
  onClose?: (reason: CloseReason) => void
  // Text being typed, held by the parent so it survives the title being remounted
  draft?: string | null
  onDraftChange?: (value: string | null) => void
}

/**
 * The clip's file name; one click turns it into a rename box. Enter, Escape and
 * clicking away all keep what was typed.
 */
export default function ClipTitle({ name, onRename, editRequest, onClose, draft, onDraftChange }: ClipTitleProps) {
  const [base, ext] = splitFileName(name)
  const [editing, setEditing] = useState(draft != null)
  const [value, setValue] = useState(draft ?? base)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Set while closing, so the blur from the box disappearing doesn't save twice
  const closing = useRef(false)
  // Set when the title is about to unmount; that blur is the player reloading, not the user leaving
  const unmounting = useRef(false)
  // A resumed draft keeps the caret at the end instead of selecting everything
  const resumed = useRef(draft != null)

  useLayoutEffect(() => () => { unmounting.current = true }, [])

  useEffect(() => {
    if (draft != null) {
      setEditing(true)
      setValue(draft)
      resumed.current = true
    } else {
      setEditing(false)
      setValue(splitFileName(name)[0])
    }
    // Only a different clip (or its new name) resets the box
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

  useEffect(() => {
    // A remounted title with text in progress carries on rather than starting over
    if (editRequest && draft == null) startEditing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest])

  useEffect(() => {
    if (!editing) return
    closing.current = false
    const input = inputRef.current
    if (!input) return
    input.focus()
    if (resumed.current) {
      input.setSelectionRange(input.value.length, input.value.length)
      resumed.current = false
    } else {
      input.select()
    }
  }, [editing])

  const startEditing = () => {
    resumed.current = false
    setValue(base)
    setEditing(true)
    onDraftChange?.(base)
  }

  const close = async (reason: CloseReason) => {
    if (saving || closing.current) return
    closing.current = true
    const trimmed = value.trim()
    if (trimmed && trimmed !== base) {
      setSaving(true)
      const ok = await onRename(trimmed + ext)
      setSaving(false)
      if (!ok) {
        closing.current = false
        inputRef.current?.focus()
        return
      }
    } else {
      setValue(base)
    }
    setEditing(false)
    onDraftChange?.(null)
    onClose?.(reason)
  }

  if (editing) {
    return (
      <div className="clip-title editing">
        <input
          ref={inputRef}
          className="clip-title-input"
          value={value}
          disabled={saving}
          onChange={(e) => {
            setValue(e.target.value)
            onDraftChange?.(e.target.value)
          }}
          onKeyDown={(e) => {
            // Keep player and list shortcuts out of the way while typing
            e.stopPropagation()
            if (e.key === 'Enter') close('enter')
            if (e.key === 'Escape') close('escape')
          }}
          onBlur={() => {
            if (!unmounting.current) close('blur')
          }}
        />
        <span className="clip-title-ext">{ext}</span>
      </div>
    )
  }

  return (
    <button className="clip-title" onClick={startEditing} title="Click to rename">
      <span className="clip-title-name">{base}</span>
      <span className="clip-title-ext">{ext}</span>
      <Pencil size={12} className="clip-title-icon" />
    </button>
  )
}
