import { useSyncExternalStore } from 'react'
import type { Clip, CompressRequest, CompressResult } from '../shared/types'
import { splitFileName } from '../shared/clipNames'
import { getPendingRename, movePendingRename, queueRename } from './renameQueue'

export interface CompressJob {
  id: number
  clip: Clip
  request: CompressRequest
  status: 'queued' | 'running'
  percent: number
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

  carryPendingRename(job, result)
  setJobs(jobs.filter(j => j.id !== job.id))
  finishedListeners.forEach(listener => listener(job, result))
  runNext()
}

/**
 * A name typed while compressing follows the compressed file when it replaced the original.
 * When the original was kept, it takes the name and the copy is named after it.
 */
function carryPendingRename(job: CompressJob, result: CompressResult) {
  const name = getPendingRename(job.clip.path)
  if (!name || !result.success || !result.output) return
  const [base] = splitFileName(name)
  const outputExt = splitFileName(result.output)[1]
  if (job.request.deleteOriginal) {
    movePendingRename(job.clip.path, result.output, base + outputExt)
  } else if (result.output !== job.clip.path) {
    queueRename(result.output, `${base}_compressed${outputExt}`)
  }
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
