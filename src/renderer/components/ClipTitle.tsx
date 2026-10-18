import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'

interface ClipTitleProps {
  name: string
  // Resolves true when the rename worked, so the editor can close
  onRename: (newName: string) => Promise<boolean>
}

function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}

/**
 * The clip's file name; one click turns it into a rename box
 */
export default function ClipTitle({ name, onRename }: ClipTitleProps) {
  const [base, ext] = splitName(name)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(base)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditing(false)
    setValue(splitName(name)[0])
  }, [name])

  useEffect(() => {
    if (editing) {
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
      return
    }
    setSaving(true)
    const ok = await onRename(trimmed + ext)
    setSaving(false)
    if (ok) {
      setEditing(false)
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
              setEditing(false)
              setValue(base)
            }
          }}
          onBlur={submit}
        />
        <span className="clip-title-ext">{ext}</span>
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
