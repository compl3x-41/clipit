import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app, net } from 'electron'
import { settingsStore } from '../store/SettingsStore'
import { normalizeName } from '../../shared/nameMatch'

// Cover art for the game folders on Home. Found on Steam by the folder's name,
// or picked by the user, and kept in Clipit's own folder so lookups happen once.

type CoverSource = 'steam' | 'custom' | 'none' | 'clip'

interface CoverEntry {
  // steam: downloaded art; custom: picked by the user; none: nothing found online;
  // clip: the user would rather see the newest clip
  source: CoverSource
  file?: string
  appId?: number
  checked: number
}

// Folders that are never a game, so there's nothing to look up
const NOT_GAMES = new Set(['uncategorized', 'desktop', 'clips', 'recordings', 'videos', 'screenshots', 'other', 'misc'])

// Store names that differ from the folder name only by an edition word
const EDITION_SUFFIXES = ['enhanced', 'legacy', 'remastered', 'definitiveedition', 'gameoftheyearedition', 'goty', 'completeedition']

// Look again now and then in case the game has since come out on Steam
const RETRY_NONE_MS = 14 * 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10000
const MAX_CUSTOM_BYTES = 20 * 1024 * 1024
const MAX_PARALLEL_LOOKUPS = 2

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

export const COVER_IMAGE_EXTENSIONS = Object.keys(MIME_TYPES).map(ext => ext.slice(1))

export function getCoverCacheRoot(): string {
  return path.join(app.getPath('userData'), 'covers')
}

function indexPath(): string {
  return path.join(getCoverCacheRoot(), 'index.json')
}

let index: Record<string, CoverEntry> | null = null

function loadIndex(): Record<string, CoverEntry> {
  if (index) return index
  try {
    index = JSON.parse(fs.readFileSync(indexPath(), 'utf8'))
  } catch {
    index = {}
  }
  return index!
}

function saveIndex(): void {
  try {
    fs.mkdirSync(getCoverCacheRoot(), { recursive: true })
    fs.writeFileSync(indexPath(), JSON.stringify(loadIndex(), null, 2))
  } catch {
    // Covers are looked up again next time
  }
}

function coverKey(game: string): string {
  return normalizeName(game) || game.toLowerCase()
}

function fileStem(key: string): string {
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)
}

function removeFile(entry: CoverEntry | undefined): void {
  if (!entry?.file) return
  try {
    fs.unlinkSync(path.join(getCoverCacheRoot(), entry.file))
  } catch {
    // Already gone
  }
}

function setEntry(key: string, entry: CoverEntry | null): void {
  const all = loadIndex()
  const previous = all[key]
  if (previous?.file && previous.file !== entry?.file) removeFile(previous)
  if (entry) all[key] = entry
  else delete all[key]
  saveIndex()
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return net.fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
}

// Matches the folder name to a Steam game: the same name, or the name plus an edition word
function isSameGame(folderKey: string, storeName: string): boolean {
  // Drop ™ and ® first, or they come out of normalizing as the letters "TM"
  const storeKey = normalizeName(storeName.replace(/[™®©℠]/g, ''))
  if (storeKey === folderKey) return true
  if (!storeKey.startsWith(folderKey)) return false
  return EDITION_SUFFIXES.includes(storeKey.slice(folderKey.length))
}

async function searchSteam(term: string): Promise<number | null> {
  const key = normalizeName(term)
  if (!key) return null
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`
  const response = await fetchWithTimeout(url)
  if (!response.ok) throw new Error(`Steam search failed: ${response.status}`)
  const data = await response.json() as { items?: { id: number; name: string; type: string }[] }
  const match = (data.items ?? []).find(item => item.type === 'app' && isSameGame(key, item.name))
  return match?.id ?? null
}

async function findSteamApp(game: string): Promise<number | null> {
  const appId = await searchSteam(game)
  if (appId) return appId
  // Folders like "Rust - Old" or "Rust (2023)" are the game plus a note of the user's own
  const base = game.replace(/\s+(?:-|–|\(|\[).*$/, '').trim()
  return base && base !== game ? searchSteam(base) : null
}

async function findHeaderImage(appId: number): Promise<string | null> {
  const response = await fetchWithTimeout(`https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`)
  if (!response.ok) throw new Error(`Steam details failed: ${response.status}`)
  const data = await response.json() as Record<string, { success: boolean; data?: { type?: string; header_image?: string } }>
  const details = data[String(appId)]
  if (!details?.success || !details.data?.header_image) return null
  // Soundtracks and DLC share names with the game, only take the game itself
  if (details.data.type && details.data.type !== 'game') return null
  return details.data.header_image
}

async function downloadSteamCover(game: string, key: string): Promise<CoverEntry> {
  const appId = await findSteamApp(game)
  if (!appId) return { source: 'none', checked: Date.now() }

  const imageUrl = await findHeaderImage(appId)
  if (!imageUrl) return { source: 'none', appId, checked: Date.now() }

  const response = await fetchWithTimeout(imageUrl)
  if (!response.ok) throw new Error(`Cover download failed: ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length < 1000) return { source: 'none', appId, checked: Date.now() }

  const file = `steam-${fileStem(key)}.jpg`
  fs.mkdirSync(getCoverCacheRoot(), { recursive: true })
  fs.writeFileSync(path.join(getCoverCacheRoot(), file), data)
  return { source: 'steam', file, appId, checked: Date.now() }
}

// A few lookups at a time, so opening Home with 40 games doesn't fire 120 requests at once
let running = 0
const waiting: (() => void)[] = []
const inFlight = new Map<string, Promise<void>>()

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL_LOOKUPS) {
    await new Promise<void>(resolve => waiting.push(resolve))
  }
  running++
  try {
    return await task()
  } finally {
    running--
    waiting.shift()?.()
  }
}

function lookUp(game: string, key: string): Promise<void> {
  let pending = inFlight.get(key)
  if (!pending) {
    pending = withSlot(async () => {
      try {
        const entry = await downloadSteamCover(game, key)
        // The user may have picked a cover while this was running
        const current = loadIndex()[key]
        if (current?.source === 'custom' || current?.source === 'clip') {
          removeFile(entry)
          return
        }
        setEntry(key, entry)
      } catch {
        // Offline or Steam is down: leave it unrecorded so it's tried again later
      }
    }).finally(() => inFlight.delete(key))
    inFlight.set(key, pending)
  }
  return pending
}

function readCover(entry: CoverEntry | undefined): { data: Buffer; mimeType: string } | null {
  if (!entry?.file) return null
  try {
    const filePath = path.join(getCoverCacheRoot(), entry.file)
    return { data: fs.readFileSync(filePath), mimeType: MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'image/jpeg' }
  } catch {
    return null
  }
}

/**
 * The cover image for a game folder, or null when the folder should show its newest clip instead
 */
export async function getCover(game: string): Promise<{ data: Buffer; mimeType: string } | null> {
  const key = coverKey(game)
  let entry: CoverEntry | undefined = loadIndex()[key]

  if (entry?.source === 'custom') return readCover(entry)
  if (entry?.source === 'clip' || NOT_GAMES.has(key)) return null
  if (!settingsStore.get('fetchGameCovers')) return null

  if (entry?.source === 'steam') {
    const cover = readCover(entry)
    if (cover) return cover
    // The file was deleted, so fetch it again
    entry = undefined
  }

  if (entry?.source === 'none' && Date.now() - entry.checked < RETRY_NONE_MS) return null

  await lookUp(game, key)
  entry = loadIndex()[key]
  return entry?.source === 'steam' || entry?.source === 'custom' ? readCover(entry) : null
}

/**
 * Use an image the user picked as the game's cover
 */
export function setCustomCover(game: string, imagePath: string): { success: boolean; error?: string } {
  const ext = path.extname(imagePath).toLowerCase()
  if (!MIME_TYPES[ext]) return { success: false, error: 'Pick a JPG, PNG, WebP, GIF or BMP image' }
  try {
    const stats = fs.statSync(imagePath)
    if (!stats.isFile()) return { success: false, error: 'That is not an image file' }
    if (stats.size > MAX_CUSTOM_BYTES) return { success: false, error: 'That image is too big (20 MB at most)' }

    const key = coverKey(game)
    // A new name each time, so the old picture isn't served from the image cache
    const file = `custom-${fileStem(key)}-${Date.now().toString(36)}${ext}`
    fs.mkdirSync(getCoverCacheRoot(), { recursive: true })
    fs.copyFileSync(imagePath, path.join(getCoverCacheRoot(), file))
    setEntry(key, { source: 'custom', file, checked: Date.now() })
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

/**
 * Show the newest clip instead of cover art
 */
export function useClipAsCover(game: string): void {
  setEntry(coverKey(game), { source: 'clip', checked: Date.now() })
}

/**
 * Forget any cover choice and look the game up again
 */
export function resetCover(game: string): void {
  setEntry(coverKey(game), null)
}

/**
 * Whether the game has a cover the user chose, so the menu can offer to undo it
 */
export function getCoverChoice(game: string): 'auto' | 'custom' | 'clip' {
  const source = loadIndex()[coverKey(game)]?.source
  return source === 'custom' || source === 'clip' ? source : 'auto'
}
