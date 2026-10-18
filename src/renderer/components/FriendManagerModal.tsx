import { useEffect, useRef, useState } from 'react'
import { X, Users, ScanText, Trash2, Plus, FlaskConical, EyeOff } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useScanProgress } from '../scanState'
import { PersonAvatar, byRecent } from './PeoplePicker'
import type { Person, ScanDebugItem, ScanSettings, UnlinkedName } from '../../shared/types'

export const DEV_OPTIONS_KEY = 'clipit:devOptions'

export function loadDevOptions(): boolean {
  try {
    return localStorage.getItem(DEV_OPTIONS_KEY) === '1'
  } catch {
    return false
  }
}

function splitAliases(text: string): string[] {
  return text.split(',').map(alias => alias.trim()).filter(Boolean)
}

/**
 * A picture of the overlay line the name was read from, loaded once the row scrolls into view
 */
function NamePreview({ name }: { name: string }) {
  const [preview, setPreview] = useState<string | null | undefined>(undefined)
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    window.clipit.getScanNamePreview(name).then((result) => {
      if (!cancelled) setPreview(result)
    })
    return () => { cancelled = true }
  }, [visible, name])

  return (
    <div className="unlinked-preview" ref={ref}>
      {preview ? <img src={preview} alt={`Where "${name}" was read`} /> : <span>{preview === null ? 'No picture' : 'Loading…'}</span>}
    </div>
  )
}

function UnlinkedRow({ entry, people, onLink, onIgnore }: {
  entry: UnlinkedName
  people: Person[]
  onLink: (name: string, personId: string) => void
  onIgnore: (name: string) => void
}) {
  const { addPerson } = useApp()
  // Electron has no window.prompt, so a new friend is named right in the row
  const [newFriend, setNewFriend] = useState<string | null>(null)

  const create = async () => {
    if (!newFriend?.trim()) return
    const person = await addPerson(newFriend)
    setNewFriend(null)
    onLink(entry.name, person.id)
  }

  return (
    <div className="unlinked-row">
      <NamePreview name={entry.name} />
      <div className="unlinked-info">
        <span className="unlinked-name">{entry.name}</span>
        <span className="unlinked-count">{entry.clips} {entry.clips === 1 ? 'clip' : 'clips'}</span>
      </div>
      {newFriend === null ? (
        <select
          className="form-select"
          value=""
          onChange={(e) => {
            if (e.target.value === '__new__') setNewFriend(entry.name)
            else if (e.target.value) onLink(entry.name, e.target.value)
          }}
        >
          <option value="">Link to friend…</option>
          {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
          <option value="__new__">+ New friend</option>
        </select>
      ) : (
        <div className="unlinked-new">
          <input
            className="form-input"
            autoFocus
            value={newFriend}
            placeholder="Friend's name"
            onChange={(e) => setNewFriend(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') create()
              if (e.key === 'Escape') setNewFriend(null)
            }}
          />
          <button className="btn btn-primary" onClick={create} disabled={!newFriend.trim()}>Add</button>
          <button className="friend-icon-btn" onClick={() => setNewFriend(null)} title="Cancel"><X size={15} /></button>
        </div>
      )}
      <button className="friend-icon-btn" onClick={() => onIgnore(entry.name)} title="Not a friend (e.g. your own name, or a misread)">
        <EyeOff size={15} />
      </button>
    </div>
  )
}

function FriendRow({ person, others, onSaved }: { person: Person; others: Person[]; onSaved: () => void }) {
  const { removePerson, addToast } = useApp()
  const [name, setName] = useState(person.name)
  const [aliases, setAliases] = useState((person.aliases ?? []).join(', '))

  useEffect(() => {
    setName(person.name)
    setAliases((person.aliases ?? []).join(', '))
  }, [person])

  const save = async () => {
    const nextAliases = splitAliases(aliases)
    if (name.trim() === person.name && nextAliases.join(',') === (person.aliases ?? []).join(',')) return
    await window.clipit.updatePerson(person.id, { name, aliases: nextAliases })
    onSaved()
  }

  const merge = async (intoId: string) => {
    const into = others.find(p => p.id === intoId)
    if (!into) return
    if (!window.confirm(`Merge ${person.name} into ${into.name}? ${person.name}'s clips and names move to ${into.name}.`)) return
    await window.clipit.mergePeople(person.id, intoId)
    addToast(`Merged ${person.name} into ${into.name}`, 'success')
    onSaved()
  }

  const remove = async () => {
    if (!window.confirm(`Delete ${person.name}? They'll be untagged from every clip.`)) return
    await removePerson(person.id)
    onSaved()
  }

  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  return (
    <div className="friend-row">
      <PersonAvatar person={person} size={28} />
      <input className="form-input friend-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={onEnter} title="Name shown in Clipit" />
      <input
        className="form-input friend-aliases"
        value={aliases}
        placeholder="Discord names, comma separated"
        onChange={(e) => setAliases(e.target.value)}
        onBlur={save}
        onKeyDown={onEnter}
        title="Other names they go by, like their Discord name. The overlay scan uses these."
      />
      <select className="form-select friend-merge" value="" onChange={(e) => merge(e.target.value)} title="Merge into another friend">
        <option value="">Merge into…</option>
        {others.map(other => <option key={other.id} value={other.id}>{other.name}</option>)}
      </select>
      <button className="friend-icon-btn" onClick={remove} title={`Delete ${person.name}`}>
        <Trash2 size={15} />
      </button>
    </div>
  )
}

function percent(value: number): string {
  return String(Math.round(value * 100))
}

export default function FriendManagerModal() {
  const { people, refreshPeople, addPerson, setShowFriendManager, addToast } = useApp()
  const [tab, setTab] = useState<'friends' | 'scan'>('friends')
  const [newName, setNewName] = useState('')
  const [unlinked, setUnlinked] = useState<UnlinkedName[]>([])
  const [ignored, setIgnored] = useState<string[]>([])
  // A name seen in one clip only is usually a misread, so those wait behind a button
  const [showOneOffs, setShowOneOffs] = useState(false)
  const oneOffs = unlinked.filter(entry => entry.clips === 1).length
  const [scanSettings, setScanSettings] = useState<ScanSettings | null>(null)
  const [debug, setDebug] = useState<ScanDebugItem[] | null>(null)
  const [devOptions] = useState(loadDevOptions)
  const progress = useScanProgress()
  const wasRunning = useRef(false)

  const sorted = byRecent(people)

  const refreshScanLists = async () => {
    setUnlinked(await window.clipit.getUnlinkedNames())
    setIgnored(await window.clipit.getIgnoredScanNames())
  }

  useEffect(() => {
    refreshScanLists()
    window.clipit.getScanSettings().then(setScanSettings)
  }, [])

  // Pick up new names once a scan finishes
  useEffect(() => {
    if (wasRunning.current && progress && !progress.running) {
      refreshScanLists()
      refreshPeople()
    }
    wasRunning.current = !!progress?.running
  }, [progress, refreshPeople])

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) {
      addToast('Type a name first', 'info')
      return
    }
    const existed = people.some(p => p.name.toLowerCase() === name.toLowerCase())
    await addPerson(name)
    setNewName('')
    addToast(existed ? `${name} is already a friend` : `Added ${name}`, existed ? 'info' : 'success')
  }

  const afterFriendChange = async () => {
    await refreshPeople()
    await refreshScanLists()
  }

  const startScan = async (mode: 'library' | 'test') => {
    if (mode === 'test') setDebug(null)
    const result = await window.clipit.startScan(mode)
    if (result.progress.error) addToast(result.progress.error, 'error')
    if (result.debug) setDebug(result.debug)
  }

  const linkName = async (name: string, personId: string) => {
    const tagged = await window.clipit.linkScanName(name, personId)
    addToast(tagged > 0 ? `Linked "${name}" and tagged ${tagged} ${tagged === 1 ? 'clip' : 'clips'}` : `Linked "${name}"`, 'success')
    await afterFriendChange()
  }

  const ignoreName = async (name: string) => {
    await window.clipit.ignoreScanName(name)
    await refreshScanLists()
  }

  const unignoreName = async (name: string) => {
    await window.clipit.unignoreScanName(name)
    await refreshScanLists()
  }

  const saveScanSettings = async (next: ScanSettings) => {
    setScanSettings(next)
    await window.clipit.setScanSettings(next)
  }

  const setRegion = (field: keyof ScanSettings['region'], value: string) => {
    if (!scanSettings) return
    const fraction = Math.min(1, Math.max(0, (parseFloat(value) || 0) / 100))
    saveScanSettings({ ...scanSettings, region: { ...scanSettings.region, [field]: fraction } })
  }

  const running = !!progress?.running
  const scanned = progress ? progress.done - progress.skipped : 0
  const finished = progress && !running && progress.total > 0

  return (
    <div className="modal-overlay">
      <div className="modal friend-manager" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Friends</h2>
          <button className="modal-close-btn" onClick={() => setShowFriendManager(false)} title="Close">
            <X size={20} />
          </button>
        </div>

        <div className="friend-tabs">
          <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}>
            <Users size={15} /> Friend Manager
          </button>
          <button className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}>
            <ScanText size={15} /> Auto-tag from Discord <span className="friend-badge">Experimental</span>
          </button>
        </div>

        <div className="modal-content">
          {tab === 'friends' ? (
            <>
              <p className="friend-help">
                Add each friend's Discord name (or several) so the overlay scan recognises them, e.g. Chris → ChristianSepar.
                Merging moves one friend's clips and names onto another.
              </p>
              <div className="friend-add">
                <input
                  className="form-input"
                  placeholder="New friend's name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
                />
                <button className="btn btn-primary" onClick={handleAdd}><Plus size={15} /> Add</button>
              </div>
              <div className="friend-list">
                {sorted.length === 0 && <div className="friend-empty">No friends yet.</div>}
                {sorted.map(person => (
                  <FriendRow key={person.id} person={person} others={sorted.filter(p => p.id !== person.id)} onSaved={afterFriendChange} />
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="friend-help">
                Reads the Discord overlay in the top left of each clip and tags the friends it names.
                Clips that were already scanned are skipped, so later scans only read new clips.
                Your manual tags are never removed.
              </p>

              <div className="scan-actions">
                <button className="btn btn-primary" onClick={() => startScan('library')} disabled={running}>
                  <ScanText size={15} /> Scan whole library
                </button>
                {running && (
                  <button className="btn btn-secondary" onClick={() => window.clipit.cancelScan()}>
                    <X size={15} /> Stop
                  </button>
                )}
              </div>

              {progress && progress.total > 0 && (
                <div className="scan-progress">
                  <div className="compress-progress-bar">
                    <div className="compress-progress-fill" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
                  </div>
                  <div className="scan-progress-line">
                    {running ? `Scanning ${progress.done + 1} of ${progress.total}${progress.mode === 'test' ? ' (test)' : ''}` : `${progress.mode === 'test' ? 'Test finished' : 'Finished'}: ${progress.done} of ${progress.total} clips`}
                    {running && progress.current && <span className="scan-current"> · {progress.current}</span>}
                  </div>
                  <div className="scan-stats">
                    <span><b>{progress.clipsWithNames}</b> with names{scanned > 0 && ` (${Math.round((progress.clipsWithNames / Math.max(1, progress.done)) * 100)}%)`}</span>
                    <span><b>{progress.clipsTagged}</b> tagged with friends</span>
                    <span><b>{progress.skipped}</b> already scanned</span>
                    <span><b>{progress.failed}</b> couldn't be read</span>
                  </div>
                  {progress.error && <div className="scan-error">{progress.error}</div>}
                  {finished && progress.clipsWithNames === 0 && progress.done > 0 && (
                    <div className="scan-error">No names were found. Turn on Developer options in Settings and run a test to see what the scan sees.</div>
                  )}
                </div>
              )}

              <h3 className="modal-section-title">Names found, not linked yet</h3>
              {unlinked.length === 0 ? (
                <div className="friend-empty">Nothing to link. Run a scan, or every name found already belongs to a friend.</div>
              ) : (
                <div className="unlinked-list">
                  {unlinked.filter(entry => showOneOffs || entry.clips > 1).map(entry => (
                    <UnlinkedRow key={entry.name} entry={entry} people={sorted} onLink={linkName} onIgnore={ignoreName} />
                  ))}
                  {unlinked.some(entry => entry.clips === 1) && (
                    <button className="btn btn-secondary unlinked-more" onClick={() => setShowOneOffs(!showOneOffs)}>
                      {showOneOffs ? 'Hide names seen in only one clip' : `Show ${oneOffs} ${oneOffs === 1 ? 'name' : 'names'} seen in only one clip`}
                    </button>
                  )}
                </div>
              )}

              {ignored.length > 0 && (
                <div className="ignored-names">
                  <span>Ignored:</span>
                  {ignored.map(name => (
                    <button key={name} className="ignored-chip" onClick={() => unignoreName(name)} title="Stop ignoring">
                      {name} <X size={11} />
                    </button>
                  ))}
                </div>
              )}

              {devOptions && scanSettings && (
                <div className="scan-dev">
                  <h3 className="modal-section-title"><FlaskConical size={15} /> Developer options</h3>
                  <div className="scan-dev-fields">
                    <label>Left % <input className="form-input" type="number" value={percent(scanSettings.region.x)} onChange={(e) => setRegion('x', e.target.value)} /></label>
                    <label>Top % <input className="form-input" type="number" value={percent(scanSettings.region.y)} onChange={(e) => setRegion('y', e.target.value)} /></label>
                    <label>Width % <input className="form-input" type="number" value={percent(scanSettings.region.width)} onChange={(e) => setRegion('width', e.target.value)} /></label>
                    <label>Height % <input className="form-input" type="number" value={percent(scanSettings.region.height)} onChange={(e) => setRegion('height', e.target.value)} /></label>
                    <label>Frames per clip
                      <input className="form-input" type="number" min={1} max={10} value={scanSettings.framesPerClip}
                        onChange={(e) => saveScanSettings({ ...scanSettings, framesPerClip: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) })} />
                    </label>
                  </div>
                  <button className="btn btn-secondary" onClick={() => startScan('test')} disabled={running}>
                    <FlaskConical size={15} /> Test on the 5 newest clips
                  </button>
                  {debug && (
                    <div className="scan-debug">
                      {debug.length === 0 && <div className="friend-empty">No clips to test.</div>}
                      {debug.map((item, i) => (
                        <div className="scan-debug-item" key={i}>
                          <div className="scan-debug-clip">{item.clip}</div>
                          <div className="scan-debug-frames">
                            {item.frames.map((frame, j) => <img key={j} src={frame} alt="" />)}
                          </div>
                          <div className="scan-debug-row"><b>Read:</b> {item.lines.length ? item.lines.join(' | ') : 'nothing'}</div>
                          <div className="scan-debug-row"><b>Names:</b> {item.names.length ? item.names.join(', ') : 'none'}</div>
                          <div className="scan-debug-row"><b>Friends:</b> {item.matched.length ? item.matched.join(', ') : 'none matched'}</div>
                          {item.error && <div className="scan-error">{item.error}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
