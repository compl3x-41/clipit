import { useSyncExternalStore } from 'react'

export type Theme = 'classic' | 'medal'

export const THEMES: { id: Theme; name: string; description: string }[] = [
  { id: 'medal', name: 'Modern', description: 'Card clip list and a thumbnail timeline' },
  { id: 'classic', name: 'Classic', description: 'The original Clipit look' }
]

const STORAGE_KEY = 'clipit:theme'
const listeners = new Set<() => void>()

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (THEMES.some(t => t.id === saved)) return saved as Theme
  } catch {
    // Fall back to the default
  }
  return 'medal'
}

let current = loadTheme()
document.documentElement.dataset.theme = current

export function setTheme(theme: Theme): void {
  current = theme
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Theme still applies for this session
  }
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => current)
}
