import fs from 'fs'
import path from 'path'
import { settingsStore } from '../store/SettingsStore'
import { isEdited, isCompressed } from '../store/EditStore'
import { getClipPeople } from '../store/PeopleStore'
import { readMp4Duration } from '../utils/mp4Duration'
import { getVideoDuration, getVideoCodec, getImageDimensions } from './FFmpegService'
import { VIDEO_EXTENSIONS, IMAGE_EXTENSIONS } from '../../shared/types'
import type { Game, Clip, ClipInfo } from '../../shared/types'

// ShadowPlay's own names, e.g. "WARDOGS 2026.10.16 - 02.16.04.26.DVR.mp4".
// A clip whose name no longer looks like this has been renamed, so counts as handled.
const RAW_RECORDING_NAME = /^.+?\s(?:-\s)?\d{4}\.\d{2}\.\d{2}\s-\s\d{2}\.\d{2}\.\d{2}(?:\.\d{2})?(?:\.DVR)?\.[^.]+$/i

function isHandled(fullPath: string, name: string): boolean {
  return isEdited(fullPath) || !RAW_RECORDING_NAME.test(name)
}

// Recordings come out of ShadowPlay well above this, and Clipit's compress presets
// (10 Mbps at most, plus audio) stay below it, so a lower bitrate means already compressed
const COMPRESSED_MAX_MBPS = 12
const durationCache = new Map<string, number | null>()

function looksCompressed(fullPath: string, sizeBytes: number, modifiedMs: number): boolean {
  if (!/\.(mp4|mov|m4v)$/i.test(fullPath)) return false
  const cacheKey = `${fullPath}|${sizeBytes}|${modifiedMs}`
  if (!durationCache.has(cacheKey)) durationCache.set(cacheKey, readMp4Duration(fullPath))
  const duration = durationCache.get(cacheKey)
  if (!duration) return false
  return (sizeBytes * 8) / duration / 1_000_000 <= COMPRESSED_MAX_MBPS
}

// Compressed by Clipit, a copy it saved with the _compressed suffix, or small enough for its size
function isShrunk(fullPath: string, name: string, stats: fs.Stats): boolean {
  return isCompressed(fullPath) ||
    /_compressed(?:_\d+)?\.[^.]+$/i.test(name) ||
    looksCompressed(fullPath, stats.size, stats.mtimeMs)
}

// Trim and compress write to these while they run
function isTempFile(name: string): boolean {
  return name.startsWith('_temp_trim_') || name.startsWith('_temp_compress_')
}

/**
 * Get all media files from the recordings directory
 */
export function getMediaFiles(): Clip[] {
  const recordingsDir = settingsStore.get('recordingsDir')
  if (!recordingsDir || !fs.existsSync(recordingsDir)) {
    return []
  }

  const media: Clip[] = []
  const allExtensions = [...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS]

  function scanDirectory(dir: string, gameName: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        scanDirectory(fullPath, entry.name)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()

        // Skip thumbnail cache files
        if (entry.name.endsWith('.thumb.jpg') || isTempFile(entry.name)) continue

        // Skip JPEGs that are thumbnails for videos
        if (ext === '.jpg' || ext === '.jpeg') {
          const baseName = path.basename(entry.name, ext)
          const hasVideo = VIDEO_EXTENSIONS.some(videoExt =>
            fs.existsSync(path.join(dir, baseName + videoExt))
          )
          if (hasVideo) continue
        }

        if (allExtensions.includes(ext)) {
          try {
            const stats = fs.statSync(fullPath)
            const fileType = VIDEO_EXTENSIONS.includes(ext) ? 'video' : 'image'

            media.push({
              path: fullPath,
              name: entry.name,
              game: gameName,
              type: fileType,
              sizeMb: Math.round(stats.size / (1024 * 1024) * 10) / 10,
              modified: stats.mtimeMs,
              edited: isHandled(fullPath, entry.name),
              compressed: fileType === 'video' && isShrunk(fullPath, entry.name, stats),
              people: getClipPeople(fullPath),
              modifiedStr: new Date(stats.mtimeMs).toLocaleString('sv-SE', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              }).replace(',', '')
            })
          } catch {
          }
        }
      }
    }
  }

  const entries = fs.readdirSync(recordingsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      scanDirectory(path.join(recordingsDir, entry.name), entry.name)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()

      // Skip thumbnail cache files
      if (entry.name.endsWith('.thumb.jpg') || isTempFile(entry.name)) continue

      // Skip JPEGs that are thumbnails for videos
      if (ext === '.jpg' || ext === '.jpeg') {
        const baseName = path.basename(entry.name, ext)
        const hasVideo = VIDEO_EXTENSIONS.some(videoExt =>
          fs.existsSync(path.join(recordingsDir, baseName + videoExt))
        )
        if (hasVideo) continue
      }

      if ([...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS].includes(ext)) {
        const fullPath = path.join(recordingsDir, entry.name)
        try {
          const stats = fs.statSync(fullPath)
          const fileType = VIDEO_EXTENSIONS.includes(ext) ? 'video' : 'image'

          media.push({
            path: fullPath,
            name: entry.name,
            game: 'Uncategorized',
            type: fileType,
            sizeMb: Math.round(stats.size / (1024 * 1024) * 10) / 10,
            modified: stats.mtimeMs,
            edited: isHandled(fullPath, entry.name),
              compressed: fileType === 'video' && isShrunk(fullPath, entry.name, stats),
              people: getClipPeople(fullPath),
            modifiedStr: new Date(stats.mtimeMs).toLocaleString('sv-SE', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            }).replace(',', '')
          })
        } catch {
        }
      }
    }
  }

  media.sort((a, b) => b.modified - a.modified)
  return media
}

// When a clip was added: Clipit keeps trimmed clips' original dates, so use the newer of the two times
function latestTime(filePath: string): number {
  try {
    const stats = fs.statSync(filePath)
    return Math.max(stats.mtimeMs, stats.birthtimeMs || 0)
  } catch {
    return 0
  }
}

/**
 * Get list of games (folders) with clip counts
 */
export function getGames(): Game[] {
  const recordingsDir = settingsStore.get('recordingsDir')
  if (!recordingsDir || !fs.existsSync(recordingsDir)) {
    return []
  }

  const games: Game[] = []
  const allExtensions = [...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS]

  const entries = fs.readdirSync(recordingsDir, { withFileTypes: true })

  let rootCount = 0
  let rootLatest = 0
  for (const entry of entries) {
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()

      // Skip thumbnail cache files
      if (entry.name.endsWith('.thumb.jpg') || isTempFile(entry.name)) continue

      // Skip JPEGs that are thumbnails for videos
      if (ext === '.jpg' || ext === '.jpeg') {
        const baseName = path.basename(entry.name, ext)
        const hasVideo = VIDEO_EXTENSIONS.some(videoExt =>
          fs.existsSync(path.join(recordingsDir, baseName + videoExt))
        )
        if (hasVideo) continue
      }

      if (allExtensions.includes(ext)) {
        rootCount++
        rootLatest = Math.max(rootLatest, latestTime(path.join(recordingsDir, entry.name)))
      }
    }
  }

  if (rootCount > 0) {
    games.push({ name: 'Uncategorized', count: rootCount, latest: rootLatest })
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const folderPath = path.join(recordingsDir, entry.name)

      let count = 0
      let latest = 0
      try {
        const files = fs.readdirSync(folderPath)
        for (const file of files) {
          const ext = path.extname(file).toLowerCase()
          if (allExtensions.includes(ext) && !file.endsWith('.thumb.jpg') && !isTempFile(file)) {
            count++
            latest = Math.max(latest, latestTime(path.join(folderPath, file)))
          }
        }
      } catch {
      }

      if (count > 0) {
        games.push({ name: entry.name, count, latest })
      }
    }
  }

  games.sort((a, b) => a.name.localeCompare(b.name))
  return games
}

/**
 * Get clips for a specific game (or all if no game specified)
 */
export function getClips(game?: string): Clip[] {
  const allClips = getMediaFiles()

  if (game) {
    return allClips.filter(clip => clip.game === game)
  }

  return allClips
}

/**
 * Get detailed info about a clip
 */
export async function getClipInfo(filePath: string): Promise<ClipInfo> {
  const ext = path.extname(filePath).toLowerCase()
  const isImage = IMAGE_EXTENSIONS.includes(ext)

  if (isImage) {
    const { width, height } = await getImageDimensions(filePath)
    return {
      type: 'image',
      width,
      height
    }
  }

  const duration = await getVideoDuration(filePath)
  const codec = await getVideoCodec(filePath)

  return {
    type: 'video',
    duration,
    codec: codec || undefined
  }
}
