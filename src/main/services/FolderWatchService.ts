import fs from 'fs'
import path from 'path'
import type { BrowserWindow } from 'electron'
import { settingsStore } from '../store/SettingsStore'
import { VIDEO_EXTENSIONS, IMAGE_EXTENSIONS } from '../../shared/types'

// Watches the recordings folder so new clips show up without pressing refresh
const MEDIA_EXTENSIONS = [...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS]
// Recorders keep writing for a moment after the file appears
const SETTLE_MS = 1500
// Refresh once more after that so the list shows the finished file size
const FOLLOW_UP_MS = 10000

let watcher: fs.FSWatcher | null = null
let watchedDir = ''
let window: BrowserWindow | null = null
let settleTimer: ReturnType<typeof setTimeout> | null = null
let followUpTimer: ReturnType<typeof setTimeout> | null = null

function isClipChange(filename: string | null): boolean {
  if (!filename) return true
  const name = path.basename(filename)
  if (name.endsWith('.thumb.jpg') || name.startsWith('_temp_')) return false
  return MEDIA_EXTENSIONS.includes(path.extname(name).toLowerCase())
}

function notify() {
  if (window && !window.isDestroyed()) window.webContents.send('media-changed')
}

function scheduleNotify() {
  if (settleTimer) clearTimeout(settleTimer)
  if (followUpTimer) clearTimeout(followUpTimer)
  settleTimer = setTimeout(notify, SETTLE_MS)
  followUpTimer = setTimeout(notify, FOLLOW_UP_MS)
}

/**
 * Start watching the recordings folder, or move the watch if the folder setting changed
 */
export function watchRecordings(mainWindow?: BrowserWindow): void {
  if (mainWindow) window = mainWindow
  const dir = settingsStore.get('recordingsDir')
  if (dir === watchedDir && watcher) return

  watcher?.close()
  watcher = null
  watchedDir = dir
  if (!dir || !fs.existsSync(dir)) return

  try {
    // Only new, deleted and renamed files matter, not files being written to
    watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
      if (eventType === 'rename' && isClipChange(filename)) scheduleNotify()
    })
    watcher.on('error', () => {
      watcher?.close()
      watcher = null
    })
  } catch {
    watcher = null
  }
}

export function stopWatchingRecordings(): void {
  watcher?.close()
  watcher = null
  watchedDir = ''
}
