import { useSyncExternalStore } from 'react'

// A rename typed in the viewer shows straight away, but the file is only renamed once the
// clip is off screen and not being compressed. Renaming a file the player has open made
// it reload and stall for a few seconds.

// Clip path -> new file name, including the extension
let pending = new Map<string, string>()
const listeners = new Set<() => void>()
let applying = false
// Paths briefly off screen while the player reloads them, which mustn't be renamed yet
const held = new Set<string>()

export function holdRename(path: string): void {
  held.add(path)
}

export function releaseRename(path: string): void {
  held.delete(path)
}

function setPending(next: Map<string, string>) {
  pending = next
  listeners.forEach(listener => listener())
  // Main renames whatever is still waiting if the app is closed first
  window.clipit.setPendingRenames([...pending].map(([path, name]) => ({ path, name })))
}

export function queueRename(path: string, name: string): void {
  setPending(new Map(pending).set(path, name))
}

export function cancelRename(path: string): void {
  if (!pending.has(path)) return
  const next = new Map(pending)
  next.delete(path)
  setPending(next)
}

export function getPendingRename(path: string): string | undefined {
  return pending.get(path)
}

/**
 * Carry a waiting rename over to the file that replaced the clip, e.g. after compressing
 */
export function movePendingRename(from: string, to: string, name: string): void {
  const next = new Map(pending)
  next.delete(from)
  next.set(to, name)
  setPending(next)
}

export interface AppliedRename {
  from: string
  to: string
}

/**
 * Rename every waiting file that isn't busy. Returns what moved and anything that failed.
 */
export async function applyPendingRenames(isBusy: (path: string) => boolean): Promise<{ applied: AppliedRename[]; errors: string[] }> {
  const applied: AppliedRename[] = []
  const errors: string[] = []
  if (applying) return { applied, errors }
  applying = true
  try {
    // Renames queued while this runs are picked up by the next pass
    const tried = new Set<string>()
    let candidate: [string, string] | undefined
    while ((candidate = [...pending].find(([path, name]) => !tried.has(path + '\n' + name) && !held.has(path) && !isBusy(path)))) {
      const [path, name] = candidate
      tried.add(path + '\n' + name)
      const result = await window.clipit.renameFile(path, name)
      // The rename is dropped either way, so a failure doesn't retry forever
      const next = new Map(pending)
      if (next.get(path) === name) next.delete(path)
      setPending(next)
      if (result.success && result.newPath) {
        if (result.newPath !== path) applied.push({ from: path, to: result.newPath })
      } else {
        errors.push(`Couldn't rename to "${name}": ${result.error || 'rename failed'}`)
      }
    }
  } finally {
    applying = false
  }
  return { applied, errors }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePendingRenames(): Map<string, string> {
  return useSyncExternalStore(subscribe, () => pending)
}
