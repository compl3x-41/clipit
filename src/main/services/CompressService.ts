import fs from 'fs'
import path from 'path'
import { spawn, ChildProcess } from 'child_process'
import { getFFmpegPath, ffmpegExists } from '../utils/ffmpegBinary'
import { executeFFprobe, getBestEncoder, getVideoCodec } from './FFmpegService'
import { deleteThumbnailCache } from './ThumbnailService'
import { atomicFileReplace, safeRename, safeUnlink } from '../utils/safeFileOps'
import { settingsStore } from '../store/SettingsStore'
import { readFileTimes, applyFileTimes } from '../utils/fileTimes'
import { markEdited, forgetEdited } from '../store/EditStore'
import { resolveOutputHeight, resolveOutputFps, probeForSection } from '../../shared/compress'
import type { VideoProbe } from '../../shared/compress'
import type { CompressRequest, CompressResult, CompressProgress } from '../../shared/types'

// Bitrate-targeted encoder arguments ({b} = target, {max} = peak, {buf} = buffer, all in kbps)
const encoderArgs: Record<string, string[]> = {
  h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-b:v', '{b}k', '-maxrate', '{max}k', '-bufsize', '{buf}k'],
  hevc_nvenc: ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-rc', 'vbr', '-b:v', '{b}k', '-maxrate', '{max}k', '-bufsize', '{buf}k', '-tag:v', 'hvc1'],
  h264_amf: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'vbr_peak', '-b:v', '{b}k', '-maxrate', '{max}k', '-bufsize', '{buf}k'],
  hevc_amf: ['-c:v', 'hevc_amf', '-quality', 'balanced', '-rc', 'vbr_peak', '-b:v', '{b}k', '-maxrate', '{max}k', '-bufsize', '{buf}k'],
  h264_qsv: ['-c:v', 'h264_qsv', '-preset', 'medium', '-b:v', '{b}k', '-maxrate', '{max}k', '-bufsize', '{buf}k'],
  hevc_qsv: ['-c:v', 'hevc_qsv', '-preset', 'medium', '-b:v', '{b}k', '-maxrate', '{max}k', '-bufsize', '{buf}k'],
  libx264: ['-c:v', 'libx264', '-preset', 'medium', '-b:v', '{b}k', '-maxrate', '{max}k', '-bufsize', '{buf}k'],
  libx265: ['-c:v', 'libx265', '-preset', 'medium', '-b:v', '{b}k', '-maxrate', '{max}k', '-bufsize', '{buf}k', '-tag:v', 'hvc1']
}

let activeProcess: ChildProcess | null = null
let cancelRequested = false

function parseFrameRate(value?: string): number {
  if (!value) return 0
  const [num, den] = value.split('/').map(Number)
  if (!den) return num || 0
  return num / den
}

/**
 * Read the source properties needed for size estimates
 */
export async function probeVideo(filePath: string): Promise<VideoProbe | null> {
  try {
    const result = await executeFFprobe([
      '-v', 'quiet',
      '-print_format', 'json',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate:format=duration,size,bit_rate',
      filePath
    ])
    const data = JSON.parse(result)
    const stream = data.streams?.[0] || {}
    const format = data.format || {}
    const duration = parseFloat(format.duration) || 0
    const sizeBytes = parseInt(format.size, 10) || fs.statSync(filePath).size
    const bitRate = parseInt(format.bit_rate, 10) || (duration > 0 ? (sizeBytes * 8) / duration : 0)

    return {
      duration,
      width: stream.width || 0,
      height: stream.height || 0,
      fps: parseFrameRate(stream.avg_frame_rate) || parseFrameRate(stream.r_frame_rate),
      sizeBytes,
      bitrateKbps: Math.round(bitRate / 1000)
    }
  } catch {
    return null
  }
}

/**
 * Check the compressed file is a readable video of the same length as the source
 */
async function verifyOutput(outputPath: string, expectedDuration: number): Promise<string | null> {
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    return 'Compressed file was not written'
  }

  const probe = await probeVideo(outputPath)
  if (!probe || probe.width === 0 || probe.duration === 0) {
    return 'Compressed file could not be read back'
  }

  const tolerance = Math.max(1, expectedDuration * 0.02)
  if (Math.abs(probe.duration - expectedDuration) > tolerance) {
    return `Compressed file length (${probe.duration.toFixed(1)}s) does not match the original (${expectedDuration.toFixed(1)}s)`
  }

  return null
}

function uniquePath(dir: string, name: string, ext: string): string {
  let candidate = path.join(dir, `${name}${ext}`)
  let i = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${name}_${i}${ext}`)
    i++
  }
  return candidate
}

async function cleanup(filePath: string) {
  if (fs.existsSync(filePath)) {
    try {
      await safeUnlink(filePath, { maxRetries: 2 })
    } catch {
      // Silently fail cleanup
    }
  }
}

function runFFmpeg(args: string[], duration: number, onProgress: (progress: CompressProgress) => void): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(getFFmpegPath(), args)
    activeProcess = proc

    let stderr = ''
    let lastPercent = -1

    proc.stderr.on('data', (data) => {
      const text = data.toString()
      // Keep only the tail for error messages
      stderr = (stderr + text).slice(-4000)

      const match = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
      if (match && duration > 0) {
        const seconds = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3])
        const percent = Math.min(99, Math.floor((seconds / duration) * 100))
        if (percent !== lastPercent) {
          lastPercent = percent
          onProgress({ percent })
        }
      }
    })

    proc.on('close', (code) => {
      activeProcess = null
      resolve({ code, stderr })
    })

    proc.on('error', (error) => {
      activeProcess = null
      resolve({ code: -1, stderr: String(error) })
    })
  })
}

/**
 * Cancel the running compression, if any
 */
export function cancelCompress(): void {
  if (activeProcess) {
    cancelRequested = true
    activeProcess.kill()
  }
}

/**
 * Re-encode a video at a target bitrate. When deleteOriginal is set the
 * original is only removed after the compressed file has been verified.
 */
export async function compressVideo(
  request: CompressRequest,
  onProgress: (progress: CompressProgress) => void
): Promise<CompressResult> {
  if (!ffmpegExists()) {
    return { success: false, error: 'FFmpeg not found. Please run: npm run download-ffmpeg' }
  }

  if (activeProcess) {
    return { success: false, error: 'A compression is already running' }
  }

  const sourcePath = request.path
  if (!fs.existsSync(sourcePath)) {
    return { success: false, error: 'Source file not found' }
  }

  const probe = await probeVideo(sourcePath)
  if (!probe || probe.duration === 0) {
    return { success: false, error: 'Could not read video information' }
  }

  const section = probeForSection(probe, request.startTime, request.endTime)
  if (section.duration <= 0) {
    return { success: false, error: 'The trimmed section is empty' }
  }
  const isSection = section !== probe

  const parsed = path.parse(sourcePath)
  const sourceTimes = readFileTimes(sourcePath)
  const originalSizeMb = Math.round(probe.sizeBytes / (1024 * 1024) * 10) / 10
  const tempPath = path.join(parsed.dir, `_temp_compress_${parsed.name}.mp4`)

  const encoder = await getBestEncoder(request.codec, settingsStore.get('preferredEncoder'))
  const sourceCodec = await getVideoCodec(sourcePath)

  const videoKbps = Math.max(100, Math.round(request.videoBitrateKbps))
  const encArgs = (encoderArgs[encoder] || encoderArgs.libx264).map(arg =>
    arg
      .replace('{b}', String(videoKbps))
      .replace('{max}', String(Math.round(videoKbps * 1.5)))
      .replace('{buf}', String(videoKbps * 2))
  )

  const vfFilters: string[] = []
  const height = resolveOutputHeight(request.resolution, probe.height)
  if (height) {
    vfFilters.push(`scale=-2:${height}`)
  }
  const fps = resolveOutputFps(request.fps, probe.fps)
  if (fps) {
    vfFilters.push(`fps=${fps}`)
  }

  const decodeOptions = sourceCodec === 'av1' && encoder.includes('nvenc')
    ? ['-hwaccel', 'cuda', '-c:v', 'av1_cuvid']
    : []

  // Seeking before -i is frame accurate here because the video is re-encoded
  const sectionArgs = isSection ? ['-ss', String(Math.max(0, request.startTime!)), '-t', String(section.duration)] : []
  const cmd: string[] = [...decodeOptions, ...sectionArgs, '-i', sourcePath]
  if (vfFilters.length > 0) {
    cmd.push('-vf', vfFilters.join(','))
  }
  cmd.push(...encArgs)
  cmd.push('-c:a', 'aac', '-b:a', `${Math.round(request.audioBitrateKbps)}k`)
  cmd.push('-movflags', '+faststart')
  cmd.push('-y', tempPath)

  cancelRequested = false
  const { code, stderr } = await runFFmpeg(cmd, section.duration, onProgress)

  if (cancelRequested) {
    cancelRequested = false
    await cleanup(tempPath)
    return { success: false, cancelled: true, error: 'Compression cancelled' }
  }

  if (code !== 0) {
    await cleanup(tempPath)
    return { success: false, error: `FFmpeg error: ${stderr}` }
  }

  const verifyError = await verifyOutput(tempPath, section.duration)
  if (verifyError) {
    await cleanup(tempPath)
    return { success: false, error: verifyError }
  }

  try {
    let finalPath: string
    let deletedOriginal = request.deleteOriginal

    if (request.deleteOriginal) {
      if (parsed.ext.toLowerCase() === '.mp4') {
        // Same name: swap the compressed file in without ever losing the original
        await atomicFileReplace(sourcePath, tempPath)
        finalPath = sourcePath
      } else {
        // Different container: move the compressed file into place, then remove the original
        finalPath = uniquePath(parsed.dir, parsed.name, '.mp4')
        await safeRename(tempPath, finalPath)
        try {
          await safeUnlink(sourcePath)
        } catch {
          // Keep the compressed copy and report the original as kept
          deletedOriginal = false
        }
      }
      if (deletedOriginal) {
        deleteThumbnailCache(sourcePath)
      }
    } else {
      finalPath = uniquePath(parsed.dir, `${parsed.name}_compressed`, '.mp4')
      await safeRename(tempPath, finalPath)
    }

    await applyFileTimes(finalPath, sourceTimes)
    if (deletedOriginal && finalPath !== sourcePath) forgetEdited(sourcePath)
    markEdited(finalPath)
    onProgress({ percent: 100 })

    const stats = fs.statSync(finalPath)
    return {
      success: true,
      output: finalPath,
      sizeMb: Math.round(stats.size / (1024 * 1024) * 10) / 10,
      originalSizeMb,
      deletedOriginal
    }
  } catch (error) {
    await cleanup(tempPath)
    return { success: false, error: String(error) }
  }
}
