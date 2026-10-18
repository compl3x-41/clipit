import fs from 'fs'
import path from 'path'
import { spawn, spawnSync } from 'child_process'
import { app, nativeImage, type BrowserWindow } from 'electron'
import { getFFmpegPath, ffmpegExists } from '../utils/ffmpegBinary'
import { readMp4Duration } from '../utils/mp4Duration'
import { WindowsOcr, type OcrAnswer } from '../utils/windowsOcr'
import { getVideoDuration } from './FFmpegService'
import { getMediaFiles } from './MediaService'
import { trackProcess, isThumbnailGenerationPaused } from './ThumbnailService'
import { getPeople, updatePerson, addClipPeople } from '../store/PeopleStore'
import {
  getScanResults, saveScanResult, flushScanResults, getIgnoredNames, setIgnoredNames,
  getScanSettings, scanKey, type ClipScan
} from '../store/ScanStore'
import { parseOverlayLines, normalizeName, looseName, cleanName, isLikelyName, namesMatch, findPerson } from '../../shared/nameMatch'
import type { ScanProgress, ScanDebugItem, UnlinkedName, Clip } from '../../shared/types'

// Reads the Discord overlay in the corner of each clip and tags the friends it names.
// Experimental: OCR on a busy game background will miss names now and then.

interface OcrEngine {
  recognize(imagePath: string): Promise<OcrAnswer>
  stop(): void
}

// Tesseract is only used when developing on Linux; Windows uses its built-in OCR
class TesseractOcr implements OcrEngine {
  async recognize(imagePath: string) {
    const result = spawnSync('tesseract', [imagePath, '-', '--psm', '6', 'tsv'], { encoding: 'utf8' })
    if (result.error) return { lines: [], error: result.error.message }
    // One row per word: level, page, block, paragraph, line, word, left, top, width, height, conf, text
    const lines = new Map<string, { words: string[]; box: number[] }>()
    for (const row of result.stdout.split('\n').slice(1)) {
      const cells = row.split('\t')
      if (cells.length < 12 || cells[0] !== '5' || !cells[11].trim()) continue
      const key = cells.slice(1, 5).join('.')
      const [left, top, width, height] = cells.slice(6, 10).map(Number)
      const line = lines.get(key)
      if (!line) {
        lines.set(key, { words: [cells[11].trim()], box: [left, top, width, height] })
      } else {
        const [x, y, w, h] = line.box
        const right = Math.max(x + w, left + width)
        const bottom = Math.max(y + h, top + height)
        line.box = [Math.min(x, left), Math.min(y, top), 0, 0]
        line.box[2] = right - line.box[0]
        line.box[3] = bottom - line.box[1]
        line.words.push(cells[11].trim())
      }
    }
    return { lines: [...lines.values()].map(line => line.words.join(' ')), boxes: [...lines.values()].map(line => line.box) }
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
function grabOverlay(clipPath: string, seconds: number, outPath: string, color = false): Promise<boolean> {
  const { region } = getScanSettings()
  const crop = `crop=iw*${region.width}:ih*${region.height}:iw*${region.x}:ih*${region.y},scale=iw*2:-1:flags=lanczos${color ? '' : ',format=gray'}`
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
        if (previous?.names.some(name => isLikelyName(cleanName(name)))) clipsWithNames++
        continue
      }

      const names = await scanClip(clip, ocr, debug)
      if (names === null) {
        failed++
      } else {
        if (names.some(isLikelyName)) clipsWithNames++
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
  const ignored = getIgnoredNames()
  const groups = new Map<string, { names: Map<string, number>; clips: number }>()
  for (const result of Object.values(getScanResults())) {
    const seenInClip = new Set<string>()
    for (const raw of result.names) {
      const name = cleanName(raw)
      if (!isLikelyName(name) || findPerson(people, name)) continue
      if (ignored.some(ignoredName => namesMatch(ignoredName, name))) continue
      // Misreads of one name ("comp13x", "compi3x") share a group
      const key = looseName(name)
      const group = groups.get(key) ?? { names: new Map(), clips: 0 }
      group.names.set(name, (group.names.get(name) ?? 0) + 1)
      if (!seenInClip.has(key)) group.clips++
      seenInClip.add(key)
      groups.set(key, group)
    }
  }
  return [...groups.values()]
    .map(group => ({
      // Show the spelling read most often
      name: [...group.names.entries()].sort((a, b) => b[1] - a[1])[0][0],
      clips: group.clips
    }))
    .sort((a, b) => b.clips - a.clips || a.name.localeCompare(b.name))
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

// Pictures of where each name was read, so it's easy to tell who a name belongs to
const previewCache = new Map<string, string | null>()
let previewQueue: Promise<unknown> = Promise.resolve()
let previewOcr: OcrEngine | null = null
let previewOcrTimer: NodeJS.Timeout | null = null

function sameGroup(found: string, name: string): boolean {
  const clean = cleanName(found)
  return looseName(clean) === looseName(name) || namesMatch(clean, name)
}

/**
 * Cut the line holding the name, with the avatar to its left, out of an overlay grab
 */
function cropToLine(framePath: string, box: number[]): string {
  const image = nativeImage.createFromPath(framePath)
  const { width, height } = image.getSize()
  const [, top, boxWidth, boxHeight] = box
  const left = box[0]
  // The avatar is about twice the height of the text and sits just left of it
  const padY = Math.round(boxHeight * 0.9)
  const x = Math.max(0, left - boxHeight * 4)
  const y = Math.max(0, top - padY)
  const right = Math.min(width, left + boxWidth + boxHeight)
  const bottom = Math.min(height, top + boxHeight + padY)
  return image.crop({ x: Math.round(x), y, width: Math.round(right - x), height: bottom - y }).toDataURL()
}

async function buildNamePreview(name: string): Promise<string | null> {
  const results = Object.values(getScanResults())
    .filter(result => result.names.some(found => sameGroup(found, name)) && fs.existsSync(result.path))
    .slice(0, 3)
  if (results.length === 0 || !ffmpegExists()) return null

  if (previewOcrTimer) clearTimeout(previewOcrTimer)
  previewOcr ??= createOcr()
  const { framesPerClip } = getScanSettings()
  let fallback: string | null = null
  try {
    for (const result of results) {
      const duration = await clipDuration(result.path)
      if (!duration) continue
      for (let i = 0; i < framesPerClip; i++) {
        const framePath = path.join(tempDir(), `preview_${i}.png`)
        if (!await grabOverlay(result.path, duration * (i + 1) / (framesPerClip + 1), framePath, true)) continue
        try {
          const answer = await previewOcr.recognize(framePath)
          const index = answer.lines.findIndex(line => parseOverlayLines([line]).some(found => sameGroup(found, name)))
          const box = answer.boxes?.[index]
          if (index !== -1 && box) return cropToLine(framePath, box)
          // Found nowhere on this frame, but the whole corner still helps
          fallback ??= nativeImage.createFromPath(framePath).resize({ width: 240 }).toDataURL()
        } finally {
          fs.rmSync(framePath, { force: true })
        }
      }
    }
  } finally {
    // Keep OCR running briefly, since previews are asked for a few at a time
    previewOcrTimer = setTimeout(() => {
      previewOcr?.stop()
      previewOcr = null
    }, 30000)
  }
  return fallback
}

export function getNamePreview(name: string): Promise<string | null> {
  const key = looseName(name)
  if (previewCache.has(key)) return Promise.resolve(previewCache.get(key)!)
  const job = previewQueue.then(() => previewCache.has(key) ? previewCache.get(key)! : buildNamePreview(name))
    .then((preview) => {
      previewCache.set(key, preview)
      return preview
    })
    .catch(() => null)
  previewQueue = job
  return job
}
