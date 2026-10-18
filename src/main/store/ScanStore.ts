import Store from 'electron-store'
import type { ScanSettings } from '../../shared/types'

// What the Discord overlay scan found in each clip, so names can be linked later without rescanning
export interface ClipScan {
  path: string
  size: number
  modified: number
  names: string[]
  // Friends the scan has already tagged, so ones removed by hand aren't added back
  applied: string[]
}

interface ScanSchema {
  results: Record<string, ClipScan>
  // Names that aren't friends, like your own
  ignoredNames: string[]
  settings: ScanSettings
}

export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  region: { x: 0, y: 0, width: 0.25, height: 0.45 },
  framesPerClip: 3
}

const store = new Store<ScanSchema>({
  name: 'clipit-scan',
  defaults: { results: {}, ignoredNames: [], settings: DEFAULT_SCAN_SETTINGS }
})

// Windows paths are case-insensitive
export function scanKey(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath
}

let results: Record<string, ClipScan> | null = null

export function getScanResults(): Record<string, ClipScan> {
  if (!results) results = store.get('results')
  return results
}

export function saveScanResult(result: ClipScan): void {
  getScanResults()[scanKey(result.path)] = result
}

// Results are saved in batches during a scan rather than after every clip
export function flushScanResults(): void {
  if (results) store.set('results', results)
}

export function getIgnoredNames(): string[] {
  return store.get('ignoredNames')
}

export function setIgnoredNames(names: string[]): void {
  store.set('ignoredNames', names)
}

export function getScanSettings(): ScanSettings {
  return { ...DEFAULT_SCAN_SETTINGS, ...store.get('settings') }
}

export function setScanSettings(settings: ScanSettings): void {
  store.set('settings', settings)
}
