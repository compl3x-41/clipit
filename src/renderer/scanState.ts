import { useEffect, useState } from 'react'
import type { ScanProgress } from '../shared/types'

/**
 * Live progress of the Discord overlay scan, which runs in the main process
 */
export function useScanProgress(): ScanProgress | null {
  const [progress, setProgress] = useState<ScanProgress | null>(null)

  useEffect(() => {
    let cancelled = false
    window.clipit.getScanProgress().then(p => { if (!cancelled) setProgress(p) })
    const unsubscribe = window.clipit.onScanProgress(setProgress)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return progress
}
