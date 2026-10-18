import fs from 'fs'
import path from 'path'
import { spawn, ChildProcess } from 'child_process'
import { getFFmpegPath, ffmpegExists } from '../utils/ffmpegBinary'
import { getVideoCodec } from './FFmpegService'
import { IMAGE_EXTENSIONS } from '../../shared/types'

// FFmpeg processes currently reading each file. On Windows they hold the file
// open without delete sharing, which makes rename fail while they run.
const activeProcesses = new Map<string, Set<ChildProcess>>()
// Files whose thumbnail generation is paused (e.g. while being renamed)
const pausedPaths = new Set<string>()

export function trackProcess(filePath: string, process: ChildProcess): void {
  let processes = activeProcesses.get(filePath)
  if (!processes) {
    processes = new Set()
    activeProcesses.set(filePath, processes)
  }
  processes.add(process)
  process.on('close', () => {
    processes!.delete(process)
    if (processes!.size === 0 && activeProcesses.get(filePath) === processes) {
      activeProcesses.delete(filePath)
    }
  })
}

/**
 * Kill any thumbnail generation reading this file and block new runs
 * until resumeThumbnailGeneration is called
 */
export function pauseThumbnailGeneration(filePath: string): void {
  pausedPaths.add(filePath)
  for (const process of activeProcesses.get(filePath) ?? []) {
    process.kill()
  }
}

export function isThumbnailGenerationPaused(filePath: string): boolean {
  return pausedPaths.has(filePath)
}

export function resumeThumbnailGeneration(filePath: string): void {
  pausedPaths.delete(filePath)
}

/**
 * Get the cache path for a thumbnail
 */
function getThumbnailCachePath(sourcePath: string): string {
  const parsed = path.parse(sourcePath)
  return path.join(parsed.dir, `${parsed.name}.thumb.jpg`)
}

/**
 * Generate thumbnail with specified method
 */
async function generateThumbnailWithMethod(
  filePath: string,
  time: string,
  options: { useHwaccel?: boolean; accurateSeek?: boolean } = {}
): Promise<Buffer | null> {
  if (pausedPaths.has(filePath) || !fs.existsSync(filePath)) return null

  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath()
    let cmd: string[]
    let timeout: number

    if (options.useHwaccel) {
      // NVIDIA hardware-accelerated AV1 decoding
      cmd = [
        '-hwaccel', 'cuda',
        '-hwaccel_output_format', 'cuda',
        '-c:v', 'av1_cuvid',
        '-ss', time,
        '-i', filePath,
        '-vframes', '1',
        '-f', 'mjpeg',
        '-vf', 'hwdownload,format=nv12,scale=320:-1',
        '-y', 'pipe:1'
      ]
      timeout = 10000
    } else if (options.accurateSeek) {
      // Accurate seek (slow, decodes from start)
      cmd = [
        '-i', filePath,
        '-ss', time,
        '-vframes', '1',
        '-f', 'mjpeg',
        '-vf', 'scale=320:-1',
        '-y', 'pipe:1'
      ]
      timeout = 45000
    } else {
      // Fast seek (keyframe-based)
      cmd = [
        '-ss', time,
        '-i', filePath,
        '-vframes', '1',
        '-f', 'mjpeg',
        '-vf', 'scale=320:-1',
        '-y', 'pipe:1'
      ]
      timeout = 5000
    }

    const process = spawn(ffmpegPath, cmd)
    trackProcess(filePath, process)
    const chunks: Buffer[] = []
    let timedOut = false

    const timeoutId = setTimeout(() => {
      timedOut = true
      process.kill()
    }, timeout)

    process.stdout.on('data', (data) => {
      chunks.push(data)
    })

    process.on('close', () => {
      clearTimeout(timeoutId)
      if (timedOut) {
        resolve(null)
        return
      }

      const data = Buffer.concat(chunks)
      if (data.length > 100) {
        resolve(data)
      } else {
        resolve(null)
      }
    })

    process.on('error', () => {
      clearTimeout(timeoutId)
      resolve(null)
    })
  })
}

/**
 * Generate image thumbnail
 */
async function generateImageThumbnail(filePath: string): Promise<Buffer | null> {
  if (pausedPaths.has(filePath) || !fs.existsSync(filePath)) return null

  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath()
    const process = spawn(ffmpegPath, [
      '-i', filePath,
      '-vf', 'scale=320:-1',
      '-f', 'mjpeg',
      '-y', 'pipe:1'
    ])
    trackProcess(filePath, process)

    const chunks: Buffer[] = []
    const timeoutId = setTimeout(() => {
      process.kill()
    }, 10000)

    process.stdout.on('data', (data) => {
      chunks.push(data)
    })

    process.on('close', () => {
      clearTimeout(timeoutId)
      const data = Buffer.concat(chunks)
      if (data.length > 100) {
        resolve(data)
      } else {
        resolve(null)
      }
    })

    process.on('error', () => {
      clearTimeout(timeoutId)
      resolve(null)
    })
  })
}

/**
 * Get or generate thumbnail for a file
 */
export async function getThumbnail(filePath: string, time: number = 5): Promise<Buffer | null> {
  // Check if FFmpeg is available
  if (!ffmpegExists()) {
    return null
  }

  const cachePath = getThumbnailCachePath(filePath)

  // Check cache first
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath)
  }
  const ext = path.extname(filePath).toLowerCase()
  const isImage = IMAGE_EXTENSIONS.includes(ext)
  let thumbnailData: Buffer | null = null

  if (isImage) {
    thumbnailData = await generateImageThumbnail(filePath)
  } else {
    // Video thumbnail
    const codec = await getVideoCodec(filePath)
    const isAv1 = codec === 'av1'
    const timeStr = String(time)

    if (isAv1) {
      // AV1: Try NVIDIA hardware decode first, then accurate seek fallback
      thumbnailData = await generateThumbnailWithMethod(filePath, timeStr, { useHwaccel: true })
      if (!thumbnailData) {
        thumbnailData = await generateThumbnailWithMethod(filePath, timeStr, { accurateSeek: true })
      }
      if (!thumbnailData) {
        thumbnailData = await generateThumbnailWithMethod(filePath, '0', { accurateSeek: true })
      }
    } else {
      // H.264/H.265/other: Fast seek works fine
      thumbnailData = await generateThumbnailWithMethod(filePath, timeStr)
      if (!thumbnailData) {
        thumbnailData = await generateThumbnailWithMethod(filePath, timeStr, { accurateSeek: true })
      }
      if (!thumbnailData) {
        thumbnailData = await generateThumbnailWithMethod(filePath, '0')
      }
    }
  }

  // Cache the thumbnail
  if (thumbnailData) {
    try {
      fs.writeFileSync(cachePath, thumbnailData)
    } catch (error) {
      // Silently fail cache write
    }
  }

  return thumbnailData
}

/**
 * Delete cached thumbnail for a file
 */
export function deleteThumbnailCache(filePath: string): void {
  const cachePath = getThumbnailCachePath(filePath)
  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath)
  }
}

/**
 * Move a cached thumbnail to follow a renamed file
 */
export function renameThumbnailCache(oldPath: string, newPath: string): void {
  const oldCachePath = getThumbnailCachePath(oldPath)
  if (fs.existsSync(oldCachePath)) {
    fs.renameSync(oldCachePath, getThumbnailCachePath(newPath))
  }
}
