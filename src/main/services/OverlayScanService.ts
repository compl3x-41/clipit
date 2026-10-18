import fs from 'fs'
import path from 'path'
import { spawn, spawnSync } from 'child_process'
import { app, type BrowserWindow } from 'electron'
import { getFFmpegPath, ffmpegExists } from '../utils/ffmpegBinary'
import { readMp4Duration } from '../utils/mp4Duration'
import { WindowsOcr } from '../utils/windowsOcr'
import { getVideoDuration } from './FFmpegService'
import { getMediaFiles } from './MediaService'
import { trackProcess, isThumbnailGenerationPaused } from './ThumbnailService'
import { getPeople, updatePerson, addClipPeople } from '../store/PeopleStore'
import {
  getScanResults, saveScanResult, flushScanResults, getIgnoredNames, setIgnoredNames,
  getScanSettings, scanKey, type ClipScan
} from '../store/ScanStore'
import { parseOverlayLines, normalizeName, findPerson } from '../../shared/nameMatch'
import type { ScanProgress, ScanDebugItem, UnlinkedName, Clip } from '../../shared/types'

// Reads the Discord overlay in the corner of each clip and tags the friends it names.
// Experimental: OCR on a busy game background will miss names now and then.

interface OcrEngine {
  recognize(imagePath: string): Promise<{ lines: string[]; error?: string }>
  stop(): void
}

// Tesseract is only used when developing on Linux; Windows uses its built-in OCR
class TesseractOcr implements OcrEngine {
  async recognize(imagePath: string) {
    const result = spawnSync('tesseract', [imagePath, '-', '--psm', '6'], { encoding: 'utf8' })
    if (result.error) return { lines: [], error: result.error.message }
    return { lines: result.stdout.split('\n').map(line => line.trim()).filter(Boolean) }
  }
  stop() {}
}

function createOcr(): OcrEngine {
  return process.platform === 'win32' ? new WindowsOcr() : new TesseractOcr()
}

const IDLE: ScanProgress = { running: false, mode: 'library', total: 0, done: 0, clipsWithNames: 0, clipsTagged: 0, skipped: 0, failed: 0 }
// Test runs look at this many of the newest clips
const TEST_CLIPS = 5

let progress: ScanProgress = { ...IDLE }
let cancelRequested = false
let window: BrowserWindow | null = null

export function setScanWindow(mainWindow: BrowserWindow): void {
  window = mainWindow
}

function emit(changes: Partial<ScanProgress>) {
  progress = { ...progress, ...changes }
  if (window && !window.isDestroyed()) window.webContents.send('scan-progress', progress)
}

export function getScanProgress(): ScanProgress {
  return progress
}

export function cancelScan(): void {
  cancelRequested = true
}

function tempDir(): string {
  const dir = path.join(app.getPath('userData'), 'scan-temp')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Save the overlay corner of one frame as a PNG, enlarged so small text reads better
 */
function grabOverlay(clipPath: string, seconds: number, outPath: string): Promise<boolean> {
  const { region } = getScanSettings()
  const crop = `crop=iw*${region.width}:ih*${region.height}:iw*${region.x}:ih*${region.y},scale=iw*2:-1:flags=lanczos,format=gray`
  return new Promise((resolve) => {
    const proc = spawn(getFFmpegPath(), [
      '-hide_banner', '-loglevel', 'error',
      '-ss', seconds.toFixed(2), '-i', clipPath,
      '-frames:v', '1', '-vf', crop, '-y', outPath
    ], { windowsHide: true })
    trackProcess(clipPath, proc)
    proc.on('close', (code) => resolve(code === 0 && fs.existsSync(outPath)))
    proc.on('error', () => resolve(false))
  })
}

async function clipDuration(clipPath: string): Promise<number> {
  const fromHeader = readMp4Duration(clipPath)
  if (fromHeader) return fromHeader
  try {
    return await getVideoDuration(clipPath)
  } catch {
    return 0
  }
}

// Names that differ only in spacing or case are the same name
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, string>()
  for (const name of names) {
    const normalized = normalizeName(name)
    if (!seen.has(normalized)) seen.set(normalized, name)
  }
  return [...seen.values()]
}

async function scanClip(clip: Clip, ocr: OcrEngine, debug: ScanDebugItem[] | null): Promise<string[] | null> {
  const { framesPerClip } = getScanSettings()
  const duration = await clipDuration(clip.path)
  if (!duration) return null

  const lines: string[] = []
  const frames: string[] = []
  const errors: string[] = []
  let grabbed = 0
  for (let i = 0; i < framesPerClip; i++) {
    if (cancelRequested) break
    const seconds = duration * (i + 1) / (framesPerClip + 1)
    const framePath = path.join(tempDir(), `frame_${i}.png`)
    if (!await grabOverlay(clip.path, seconds, framePath)) continue
    grabbed++
    const answer = await ocr.recognize(framePath)
    lines.push(...answer.lines)
    if (answer.error) errors.push(answer.error)
    if (debug) frames.push(`data:image/png;base64,${fs.readFileSync(framePath).toString('base64')}`)
    fs.rmSync(framePath, { force: true })
  }
  if (grabbed === 0) {
    debug?.push({ clip: clip.name, frames, lines, names: [], matched: [], error: 'Could not read frames from this clip' })
    return null
  }

  const names = uniqueNames(parseOverlayLines(lines))
  if (debug) {
    const people = getPeople()
    debug.push({
      clip: clip.name,
      frames,
      lines,
      names,
      matched: [...new Set(names.map(name => findPerson(people, name)?.name).filter((n): n is string => !!n))],
      error: errors[0]
    })
  }
  return names
}

/**
 * Tag clips with the friends their overlay names match. Friends the scan tagged before
 * aren't added again, so removing one by hand sticks.
 */
export function applyScanResults(): number {
  const people = getPeople()
  let tagged = 0
  for (const result of Object.values(getScanResults())) {
    const matched = [...new Set(result.names.map(name => findPerson(people, name)?.id).filter((id): id is string => !!id))]
    const toAdd = matched.filter(id => !result.applied.includes(id))
    if (toAdd.length === 0) continue
    if (!fs.existsSync(result.path)) continue
    addClipPeople(result.path, toAdd)
    result.applied = [...result.applied, ...toAdd]
    tagged++
  }
  flushScanResults()
  return tagged
}

/**
 * Scan every clip in the library, or only the newest few as a test that shows its working
 */
export async function startScan(mode: 'library' | 'test'): Promise<{ progress: ScanProgress; debug?: ScanDebugItem[] }> {
  if (progress.running) return { progress }
  if (!ffmpegExists()) {
    emit({ ...IDLE, mode, error: 'FFmpeg is missing, so clips cannot be read' })
    return { progress }
  }

  cancelRequested = false
  const results = getScanResults()
  let clips = getMediaFiles().filter(clip => clip.type === 'video')
  if (mode === 'test') clips = clips.slice(0, TEST_CLIPS)

  emit({ ...IDLE, running: true, mode, total: clips.length })
  const debug: ScanDebugItem[] | null = mode === 'test' ? [] : null
  const ocr = createOcr()
  const people = getPeople()
  let clipsWithNames = 0
  let clipsTagged = 0
  let skipped = 0
  let failed = 0

  try {
    for (let i = 0; i < clips.length; i++) {
      if (cancelRequested) break
      const clip = clips[i]
      emit({ done: i, current: clip.name })

      let stats: fs.Stats
      try {
        stats = fs.statSync(clip.path)
      } catch {
        failed++
        continue
      }
      const previous: ClipScan | undefined = results[scanKey(clip.path)]
      const unchanged = previous && previous.size === stats.size && previous.modified === stats.mtimeMs
      if ((mode === 'library' && unchanged) || isThumbnailGenerationPaused(clip.path)) {
        skipped++
        if (previous?.names.length) clipsWithNames++
        continue
      }

      const names = await scanClip(clip, ocr, debug)
      if (names === null) {
        failed++
      } else {
        if (names.length > 0) clipsWithNames++
        if (names.some(name => findPerson(people, name))) clipsTagged++
        saveScanResult({ path: clip.path, size: stats.size, modified: stats.mtimeMs, names, applied: previous?.applied ?? [] })
      }
      emit({ clipsWithNames, clipsTagged, skipped, failed })
      if (i % 20 === 19) flushScanResults()
    }
  } catch (error) {
    emit({ error: error instanceof Error ? error.message : String(error) })
  } finally {
    ocr.stop()
    flushScanResults()
  }

  applyScanResults()
  emit({ running: false, done: cancelRequested ? progress.done : clips.length, current: undefined, clipsWithNames, clipsTagged, skipped, failed })
  // Clip lists reload so the new tags show
  if (window && !window.isDestroyed()) window.webContents.send('media-changed')
  return { progress, debug: debug ?? undefined }
}

/**
 * Names the overlay showed that aren't linked to a friend yet, most common first
 */
export function getUnlinkedNames(): UnlinkedName[] {
  const people = getPeople()
  const ignored = new Set(getIgnoredNames().map(normalizeName))
  const counts = new Map<string, UnlinkedName>()
  for (const result of Object.values(getScanResults())) {
    for (const name of result.names) {
      const normalized = normalizeName(name)
      if (ignored.has(normalized) || findPerson(people, name)) continue
      const entry = counts.get(normalized) ?? { name, clips: 0 }
      entry.clips++
      counts.set(normalized, entry)
    }
  }
  return [...counts.values()].sort((a, b) => b.clips - a.clips || a.name.localeCompare(b.name))
}

/**
 * Treat an overlay name as one of a friend's names, and tag the clips it appeared in
 */
export function linkName(name: string, personId: string): number {
  const person = getPeople().find(p => p.id === personId)
  if (!person) return 0
  updatePerson(personId, { aliases: [...(person.aliases ?? []), name] })
  return applyScanResults()
}

export function ignoreName(name: string): void {
  setIgnoredNames([...new Set([...getIgnoredNames(), name])])
}

export function unignoreName(name: string): void {
  setIgnoredNames(getIgnoredNames().filter(n => normalizeName(n) !== normalizeName(name)))
}
