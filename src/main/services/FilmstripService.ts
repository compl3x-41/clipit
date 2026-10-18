import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { app } from 'electron'
import { getFFmpegPath, ffmpegExists } from '../utils/ffmpegBinary'
import { getVideoDuration } from './FFmpegService'
import { trackProcess, isThumbnailGenerationPaused } from './ThumbnailService'

const FRAME_HEIGHT = 90
// Oldest filmstrips are removed past this many
const MAX_CACHED = 150

const inFlight = new Map<string, Promise<string[]>>()

export function getFilmstripCacheRoot(): string {
  return path.join(app.getPath('userData'), 'filmstrips')
}

function getCacheDir(filePath: string, count: number): string | null {
  try {
    const stats = fs.statSync(filePath)
    const key = crypto.createHash('sha1')
      .update(`${filePath}|${stats.size}|${stats.mtimeMs}|${count}`)
      .digest('hex')
    return path.join(getFilmstripCacheRoot(), key)
  } catch {
    return null
  }
}

function pruneCache(): void {
  try {
    const root = getFilmstripCacheRoot()
    const dirs = fs.readdirSync(root)
      .map(name => ({ dir: path.join(root, name), time: fs.statSync(path.join(root, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
    for (const { dir } of dirs.slice(MAX_CACHED)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    // Cache cleanup is best effort
  }
}

function extractFrame(filePath: string, time: number, outputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (isThumbnailGenerationPaused(filePath)) {
      resolve(false)
      return
    }
    const proc = spawn(getFFmpegPath(), [
      '-v', 'error',
      '-ss', time.toFixed(3),
      '-i', filePath,
      '-frames:v', '1',
      '-vf', `scale=-2:${FRAME_HEIGHT}`,
      '-q:v', '5',
      '-y', outputPath
    ])
    trackProcess(filePath, proc)
    proc.on('close', (code) => resolve(code === 0 && fs.existsSync(outputPath)))
    proc.on('error', () => resolve(false))
  })
}

async function generate(filePath: string, count: number, cacheDir: string): Promise<string[]> {
  const duration = await getVideoDuration(filePath)
  if (!duration) return []

  fs.mkdirSync(cacheDir, { recursive: true })
  const frames: string[] = new Array(count).fill('')
  // A few at a time keeps this quick without hogging the disk
  const queue = Array.from({ length: count }, (_, i) => i)
  const worker = async () => {
    while (queue.length > 0) {
      const i = queue.shift()!
      const time = Math.min(duration - 0.1, ((i + 0.5) / count) * duration)
      const outputPath = path.join(cacheDir, `${String(i).padStart(2, '0')}.jpg`)
      if (await extractFrame(filePath, Math.max(0, time), outputPath)) {
        frames[i] = outputPath
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])

  if (frames.every(f => !f)) {
    fs.rmSync(cacheDir, { recursive: true, force: true })
    return []
  }
  pruneCache()
  return frames
}

/**
 * Evenly spaced frames across a video for the timeline, cached per file version.
 * Missing frames come back as empty strings.
 */
export async function getFilmstrip(filePath: string, count: number): Promise<string[]> {
  if (!ffmpegExists() || !fs.existsSync(filePath)) return []
  count = Math.max(1, Math.min(40, Math.round(count)))

  const cacheDir = getCacheDir(filePath, count)
  if (!cacheDir) return []

  if (fs.existsSync(cacheDir)) {
    const frames = Array.from({ length: count }, (_, i) => path.join(cacheDir, `${String(i).padStart(2, '0')}.jpg`))
    if (frames.some(f => fs.existsSync(f))) {
      return frames.map(f => fs.existsSync(f) ? f : '')
    }
  }

  const existing = inFlight.get(cacheDir)
  if (existing) return existing
  const promise = generate(filePath, count, cacheDir).finally(() => inFlight.delete(cacheDir))
  inFlight.set(cacheDir, promise)
  return promise
}
