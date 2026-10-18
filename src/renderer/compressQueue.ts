import { useSyncExternalStore } from 'react'
import type { Clip, CompressRequest, CompressResult } from '../shared/types'
import { splitFileName } from '../shared/clipNames'

export interface CompressJob {
  id: number
  clip: Clip
  request: CompressRequest
  status: 'queued' | 'running'
  percent: number
  // A new name typed while compressing, applied once the file is free
  renameTo?: string
}

type FinishedListener = (job: CompressJob, result: CompressResult) => void

// Compressions run one at a time in the main process, so jobs wait here until it's their turn
let jobs: CompressJob[] = []
let nextId = 1
const listeners = new Set<() => void>()
const finishedListeners = new Set<FinishedListener>()

function setJobs(next: CompressJob[]) {
  jobs = next
  listeners.forEach(listener => listener())
}

function updateJob(id: number, changes: Partial<CompressJob>) {
  setJobs(jobs.map(job => job.id === id ? { ...job, ...changes } : job))
}

async function runNext() {
  if (jobs.some(job => job.status === 'running')) return
  const job = jobs.find(j => j.status === 'queued')
  if (!job) return

  updateJob(job.id, { status: 'running', percent: 0 })
  const cleanupProgress = window.clipit.onCompressProgress((p) => updateJob(job.id, { percent: p.percent }))
  let result: CompressResult
  try {
    result = await window.clipit.compress(job.request)
  } catch (error) {
    result = { success: false, error: String(error) }
  } finally {
    cleanupProgress()
  }

  const finished = jobs.find(j => j.id === job.id) ?? job
  if (finished.renameTo) result = await applyPendingRename(finished, result)
  setJobs(jobs.filter(j => j.id !== job.id))
  finishedListeners.forEach(listener => listener(finished, result))
  runNext()
}

/**
 * Rename the clip as asked while it was compressing. When the original was replaced the
 * compressed file takes the name; otherwise the original does, and the copy follows it.
 */
async function applyPendingRename(job: CompressJob, result: CompressResult): Promise<CompressResult> {
  const [newBase, newExt] = splitFileName(job.renameTo!)
  const replaced = result.success && job.request.deleteOriginal && result.output
  if (replaced) {
    const renamed = await window.clipit.renameFile(result.output!, newBase + splitFileName(result.output!)[1])
    if (renamed.success && renamed.newPath) return { ...result, output: renamed.newPath }
    return { ...result, renameError: renamed.error || 'Rename failed' }
  }
  const original = await window.clipit.renameFile(job.clip.path, newBase + newExt)
  if (!original.success) return { ...result, renameError: original.error || 'Rename failed' }
  if (result.success && result.output && result.output !== job.clip.path) {
    const copy = await window.clipit.renameFile(result.output, `${newBase}_compressed${splitFileName(result.output)[1]}`)
    if (copy.success && copy.newPath) return { ...result, output: copy.newPath }
  }
  return result
}

/**
 * Remember a rename for a clip that's waiting for or being compressed
 */
export function setPendingRename(clipPath: string, newName: string): boolean {
  const job = jobs.find(j => j.clip.path === clipPath)
  if (!job) return false
  updateJob(job.id, { renameTo: newName })
  return true
}

export function enqueueCompress(clip: Clip, request: CompressRequest): void {
  setJobs([...jobs, { id: nextId++, clip, request, status: 'queued', percent: 0 }])
  runNext()
}

/**
 * Stop the running job, or drop it from the queue if it hasn't started
 */
export function cancelCompressJob(id: number): void {
  const job = jobs.find(j => j.id === id)
  if (!job) return
  if (job.status === 'running') {
    window.clipit.cancelCompress()
  } else {
    setJobs(jobs.filter(j => j.id !== id))
    // The rename asked for while it waited still happens
    if (job.renameTo) {
      window.clipit.renameFile(job.clip.path, job.renameTo).then(() => finishedListeners.forEach(listener => listener(job, { success: false, cancelled: true })))
    }
  }
}

/**
 * True while the clip waits for or is being compressed in place, so the
 * player must leave the file alone for the original to be replaced
 */
export function isReplacingClip(queue: CompressJob[], clipPath: string): boolean {
  return queue.some(job => job.clip.path === clipPath && job.request.deleteOriginal)
}

export function onCompressFinished(listener: FinishedListener): () => void {
  finishedListeners.add(listener)
  return () => finishedListeners.delete(listener)
}

export function getCompressJobs(): CompressJob[] {
  return jobs
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useCompressQueue(): CompressJob[] {
  return useSyncExternalStore(subscribe, () => jobs)
}
