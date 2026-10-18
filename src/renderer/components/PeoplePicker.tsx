import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus, Users, X } from 'lucide-react'
import type { Person } from '../../shared/types'

// Friends shown as one-click chips; the rest live in the dropdown
const QUICK_PICKS = 5

interface PeoplePickerProps {
  people: Person[]
  selected: string[]
  onChange: (ids: string[]) => void
  // Lets the dropdown add new friends and remove old ones
  onAdd?: (name: string) => Promise<Person>
  onRemove?: (person: Person) => void
  onManage?: () => void
  label?: string
  emptyHint?: string
}

const AVATAR_COLORS = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444']

function avatarColor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function PersonAvatar({ person, size = 18 }: { person: Person; size?: number }) {
  return (
    <span
      className="person-avatar"
      style={{ width: size, height: size, fontSize: size * 0.55, background: avatarColor(person.name) }}
      title={person.name}
    >
      {person.name.charAt(0).toUpperCase()}
    </span>
  )
}

// Most recently added to a clip first
export function byRecent(people: Person[]): Person[] {
  return [...people].sort((a, b) => b.lastUsed - a.lastUsed || a.name.localeCompare(b.name))
}

// Clicking a chip shouldn't focus it, or Space would toggle it instead of playing the clip
const keepFocus = (e: React.MouseEvent) => e.preventDefault()

export default function PeoplePicker({ people, selected, onChange, onAdd, onRemove, onManage, label, emptyHint }: PeoplePickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const sorted = useMemo(() => byRecent(people), [people])
  // Selected friends always stay visible, then the most recent fill the rest
  const quick = useMemo(() => {
    const chosen = sorted.filter(p => selected.includes(p.id))
    const others = sorted.filter(p => !selected.includes(p.id))
    return [...chosen, ...others.slice(0, Math.max(0, QUICK_PICKS - chosen.length))]
  }, [sorted, selected])
  const rest = sorted.filter(p => !quick.includes(p))

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id])
  }

  const search = query.trim().toLowerCase()
  const matches = search ? sorted.filter(p => p.name.toLowerCase().includes(search)) : rest
  const exactMatch = sorted.find(p => p.name.toLowerCase() === search)

  const handleAdd = async () => {
    if (!onAdd || !search) return
    const person = exactMatch ?? await onAdd(query)
    if (!selected.includes(person.id)) onChange([...selected, person.id])
    setQuery('')
  }

  return (
    <div className="people-picker" ref={rootRef}>
      {label && <span className="people-label"><Users size={13} />{label}</span>}
      {quick.map(person => (
        <button
          key={person.id}
          className={`person-chip ${selected.includes(person.id) ? 'active' : ''}`}
          onMouseDown={keepFocus}
          onClick={() => toggle(person.id)}
          title={selected.includes(person.id) ? `Remove ${person.name}` : `Add ${person.name}`}
        >
          <PersonAvatar person={person} />
          <span className="person-chip-name">{person.name}</span>
        </button>
      ))}
      {people.length === 0 && emptyHint && <span className="people-empty">{emptyHint}</span>}
      {(rest.length > 0 || onAdd) && (
        <button
          className={`person-chip person-more ${open ? 'active' : ''}`}
          onMouseDown={keepFocus}
          onClick={() => setOpen(!open)}
          title={onAdd ? 'More friends, or add a new one' : 'More friends'}
        >
          {people.length === 0 && onAdd ? <><Plus size={13} /> Add friend</> : <>{rest.length > 0 ? `+${rest.length}` : <Plus size={13} />}<ChevronDown size={12} /></>}
        </button>
      )}
      {open && (
        <div className="people-dropdown">
          <input
            ref={inputRef}
            className="people-search"
            placeholder={onAdd ? 'Search or add a friend' : 'Search friends'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') handleAdd()
              if (e.key === 'Escape') setOpen(false)
            }}
          />
          <div className="people-options">
            {matches.map(person => (
              <div key={person.id} className={`people-option ${selected.includes(person.id) ? 'active' : ''}`} onClick={() => toggle(person.id)}>
                <span className="people-check">{selected.includes(person.id) ? '✓' : ''}</span>
                <PersonAvatar person={person} />
                <span className="people-option-name">{person.name}</span>
                {onRemove && (
                  <button
                    className="people-option-remove"
                    title={`Delete ${person.name} from Clipit`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove(person)
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
            {onAdd && search && !exactMatch && (
              <div className="people-option people-add" onClick={handleAdd}>
                <Plus size={13} />
                <span className="people-option-name">Add "{query.trim()}"</span>
              </div>
            )}
            {matches.length === 0 && !(onAdd && search) && (
              <div className="people-none">{search ? 'No friends match' : 'Everyone is shown already'}</div>
            )}
          </div>
          {onManage && (
            <button className="people-manage" onClick={() => { setOpen(false); onManage() }}>
              Manage friends and Discord names…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
