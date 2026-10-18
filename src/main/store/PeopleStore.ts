import fs from 'fs'
import Store from 'electron-store'
import { randomUUID } from 'crypto'
import type { Person } from '../../shared/types'

// Friends that can be tagged on clips, and which clips each one is in.
// Tags are written onto the clip file itself (a hidden NTFS stream on Windows), so they
// follow the file when it's renamed or moved in Explorer. This store keeps a copy by path
// for drives without NTFS streams.
interface PeopleSchema {
  people: Person[]
  // Clip path -> ids of the people in it
  clipPeople: Record<string, string[]>
  // Friends merged into another; tags on files still name the old id
  mergedInto: Record<string, string>
}

const store = new Store<PeopleSchema>({
  name: 'clipit-people',
  defaults: { people: [], clipPeople: {}, mergedInto: {} }
})

// Clip lists read this for every clip, so keep it in memory instead of rereading the file
const cache: Partial<PeopleSchema> = {}

function read<K extends keyof PeopleSchema>(name: K): PeopleSchema[K] {
  if (!(name in cache)) cache[name] = store.get(name)
  return cache[name] as PeopleSchema[K]
}

function write<K extends keyof PeopleSchema>(name: K, value: PeopleSchema[K]): void {
  cache[name] = value
  store.set(name, value)
}

// Windows paths are case-insensitive
function key(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath
}

const TAG_STREAM = ':clipit.people'

function readFileTag(filePath: string): string[] | null {
  if (process.platform !== 'win32') return null
  try {
    const ids = JSON.parse(fs.readFileSync(filePath + TAG_STREAM, 'utf8'))
    return Array.isArray(ids) ? ids : null
  } catch {
    return null
  }
}

function writeFileTag(filePath: string, ids: string[]): void {
  if (process.platform !== 'win32') return
  try {
    // Writing a stream bumps the clip's modified date, which Clipit sorts by
    const stats = fs.statSync(filePath)
    if (ids.length > 0) {
      fs.writeFileSync(filePath + TAG_STREAM, JSON.stringify(ids))
    } else if (readFileTag(filePath)) {
      fs.unlinkSync(filePath + TAG_STREAM)
    }
    fs.utimesSync(filePath, stats.atime, stats.mtime)
  } catch {
    // Not NTFS (or the file is busy): the store copy still has the tags
  }
}

function setStoredTag(filePath: string, ids: string[]): void {
  const clipPeople = read('clipPeople')
  if (ids.length > 0) clipPeople[key(filePath)] = ids
  else delete clipPeople[key(filePath)]
  write('clipPeople', clipPeople)
}

export function getPeople(): Person[] {
  return read('people')
}

export function addPerson(name: string): Person {
  const people = getPeople()
  const trimmed = name.trim()
  const existing = people.find(p => p.name.toLowerCase() === trimmed.toLowerCase())
  if (existing) return existing
  const person: Person = { id: randomUUID(), name: trimmed, lastUsed: Date.now() }
  write('people', [...people, person])
  return person
}

export function updatePerson(id: string, changes: { name?: string; aliases?: string[] }): Person[] {
  const clean = (values: string[]) => [...new Set(values.map(v => v.trim()).filter(Boolean))]
  write('people', getPeople().map(p => p.id !== id ? p : {
    ...p,
    name: changes.name?.trim() || p.name,
    aliases: changes.aliases ? clean(changes.aliases) : p.aliases
  }))
  return getPeople()
}

/**
 * Fold one friend into another: their names become aliases and their clips move over
 */
export function mergePeople(fromId: string, intoId: string): Person[] {
  const from = getPeople().find(p => p.id === fromId)
  const into = getPeople().find(p => p.id === intoId)
  if (!from || !into || fromId === intoId) return getPeople()

  const aliases = [...(into.aliases ?? []), from.name, ...(from.aliases ?? [])]
  write('people', getPeople()
    .filter(p => p.id !== fromId)
    .map(p => p.id === intoId ? { ...p, aliases: [...new Set(aliases)], lastUsed: Math.max(p.lastUsed, from.lastUsed) } : p))

  const merged = read('mergedInto')
  for (const [oldId, newId] of Object.entries(merged)) {
    if (newId === fromId) merged[oldId] = intoId
  }
  merged[fromId] = intoId
  write('mergedInto', merged)

  const clipPeople = read('clipPeople')
  for (const [clip, ids] of Object.entries(clipPeople)) {
    if (!ids.includes(fromId)) continue
    const next = [...new Set(ids.map(id => id === fromId ? intoId : id))]
    clipPeople[clip] = next
    writeFileTag(clip, next)
  }
  write('clipPeople', clipPeople)
  return getPeople()
}

export function removePerson(id: string): void {
  write('people', getPeople().filter(p => p.id !== id))
  const clipPeople = read('clipPeople')
  for (const [clip, ids] of Object.entries(clipPeople)) {
    const rest = ids.filter(personId => personId !== id)
    if (rest.length > 0) clipPeople[clip] = rest
    else delete clipPeople[clip]
  }
  write('clipPeople', clipPeople)
}

export function getClipPeople(filePath: string): string[] {
  const ids = readFileTag(filePath) ?? read('clipPeople')[key(filePath)] ?? []
  if (ids.length === 0) return ids
  // Follow merges, and drop friends deleted from Clipit that are still listed on the file
  const merged = read('mergedInto')
  const known = new Set(getPeople().map(p => p.id))
  return [...new Set(ids.map(id => merged[id] ?? id))].filter(id => known.has(id))
}

/**
 * Add friends to a clip, keeping whoever is already tagged
 */
export function addClipPeople(filePath: string, ids: string[]): void {
  const current = getClipPeople(filePath)
  const added = ids.filter(id => !current.includes(id))
  if (added.length > 0) tagClip(filePath, [...current, ...added])
}

/**
 * Put tags on a clip without counting it as a fresh pick, e.g. on a trimmed or compressed copy
 */
export function tagClip(filePath: string, ids: string[]): void {
  writeFileTag(filePath, ids)
  setStoredTag(filePath, ids)
}

/**
 * Set who is in a clip. People newly added to it move to the front of the quick picks.
 */
export function setClipPeople(filePath: string, ids: string[]): void {
  const before = new Set(getClipPeople(filePath))
  tagClip(filePath, ids)

  const now = Date.now()
  const added = new Set(ids.filter(id => !before.has(id)))
  if (added.size > 0) {
    write('people', getPeople().map(p => added.has(p.id) ? { ...p, lastUsed: now } : p))
  }
}

export function moveClipPeople(oldPath: string, newPath: string): void {
  const clipPeople = read('clipPeople')
  const ids = clipPeople[key(oldPath)]
  if (!ids) return
  delete clipPeople[key(oldPath)]
  clipPeople[key(newPath)] = ids
  write('clipPeople', clipPeople)
}

export function forgetClipPeople(filePath: string): void {
  const clipPeople = read('clipPeople')
  if (!(key(filePath) in clipPeople)) return
  delete clipPeople[key(filePath)]
  write('clipPeople', clipPeople)
}
