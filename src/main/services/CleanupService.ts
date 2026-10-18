import fs from 'fs'
import path from 'path'
import { settingsStore } from '../store/SettingsStore'
import { getThumbnailCacheRoot } from './ThumbnailService'
import { getFilmstripCacheRoot } from './FilmstripService'

// Files Clipit made for itself that can always be made again
export interface CleanupSummary {
  bytes: number
  files: number
}

// Leftovers from a trim or compress that crashed; anything newer may still be running
const TEMP_MIN_AGE_MS = 60 * 60 * 1000

function walk(dir: string, visit: (filePath: string, stats: fs.Stats) => void, depth = 0): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth < 4) walk(fullPath, visit, depth + 1)
    } else if (entry.isFile()) {
      try {
        visit(fullPath, fs.statSync(fullPath))
      } catch {
        // Skip files that vanish or can't be read
      }
    }
  }
}

function collect(): string[] {
  const found: string[] = []
  const take = (filePath: string) => { found.push(filePath) }

  walk(getThumbnailCacheRoot(), take)
  walk(getFilmstripCacheRoot(), take)

  // Old thumbnails next to clips, and temp files left in the recordings folders
  const recordingsDir = settingsStore.get('recordingsDir')
  if (recordingsDir && fs.existsSync(recordingsDir)) {
    const now = Date.now()
    walk(recordingsDir, (filePath, stats) => {
      const name = path.basename(filePath)
      const isOldTemp = name.startsWith('_temp_') && now - stats.mtimeMs > TEMP_MIN_AGE_MS
      if (name.endsWith('.thumb.jpg') || isOldTemp) found.push(filePath)
    })
  }
  return found
}

export function getCleanupSummary(): CleanupSummary {
  let bytes = 0
  const files = collect()
  for (const filePath of files) {
    try {
      bytes += fs.statSync(filePath).size
    } catch {
      // Already gone
    }
  }
  return { bytes, files: files.length }
}

/**
 * Delete thumbnails, timeline pictures and leftover temp files. Clipit remakes what it needs.
 */
export function runCleanup(): CleanupSummary {
  let bytes = 0
  let files = 0
  for (const filePath of collect()) {
    try {
      const size = fs.statSync(filePath).size
      fs.unlinkSync(filePath)
      bytes += size
      files++
    } catch {
      // In use or already gone; leave it
    }
  }
  // Remove the emptied filmstrip folders
  try {
    for (const dir of fs.readdirSync(getFilmstripCacheRoot())) {
      fs.rmSync(path.join(getFilmstripCacheRoot(), dir), { recursive: true, force: true })
    }
  } catch {
    // Nothing cached yet
  }
  return { bytes, files }
}
