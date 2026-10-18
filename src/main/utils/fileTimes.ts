import fs from 'fs'
import { execFile } from 'child_process'

export interface FileTimes {
  modifiedMs: number
  createdMs: number
}

/**
 * Read a file's times before it gets replaced, so they can be put back on the result
 */
export function readFileTimes(filePath: string): FileTimes | null {
  try {
    const stats = fs.statSync(filePath)
    return { modifiedMs: stats.mtimeMs, createdMs: stats.birthtimeMs || stats.mtimeMs }
  } catch {
    return null
  }
}

/**
 * Give a new file the original clip's dates so it keeps its place when
 * clips are sorted by newest. Best effort: a failure leaves the new dates.
 */
export async function applyFileTimes(filePath: string, times: FileTimes | null): Promise<void> {
  if (!times) return
  try {
    const modified = new Date(times.modifiedMs)
    fs.utimesSync(filePath, modified, modified)
  } catch {
    return
  }

  // Node can't set the creation date, Explorer's "Date created" needs PowerShell
  if (process.platform !== 'win32') return
  const created = new Date(times.createdMs).toISOString()
  const script = `(Get-Item -LiteralPath $env:CLIPIT_TARGET).CreationTimeUtc = [DateTime]::Parse($env:CLIPIT_CREATED).ToUniversalTime()`
  await new Promise<void>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, CLIPIT_TARGET: filePath, CLIPIT_CREATED: created }, windowsHide: true, timeout: 10000 },
      () => resolve()
    )
  })
}
