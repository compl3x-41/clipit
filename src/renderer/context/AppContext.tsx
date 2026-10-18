import { createContext, useState, useEffect, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'
import { getCompressJobs } from '../compressQueue'
import { ALL_CLIPS } from '../../shared/types'
import type { Settings, Game, Clip, ClipInfo, EncoderInfo, Person } from '../../shared/types'

// The All clips folder lists every game's clips
function loadClips(game: string): Promise<Clip[]> {
  return window.clipit.getClips(game === ALL_CLIPS ? undefined : game)
}

type ClipFilter = 'all' | 'video' | 'image'
type ClipSort = 'date' | 'name' | 'size'

function visibleClips(clips: Clip[], hiddenPaths: Set<string>, filter: ClipFilter, sort: ClipSort, personFilter: string[], search: string): Clip[] {
  let result = clips.filter(clip => !hiddenPaths.has(clip.path))

  const query = search.trim().toLowerCase()
  if (query) {
    result = result.filter(clip => clip.name.toLowerCase().includes(query))
  }

  if (filter !== 'all') {
    result = result.filter(clip => clip.type === filter)
  }

  // Clips that have every selected friend in them
  if (personFilter.length > 0) {
    result = result.filter(clip => personFilter.every(id => clip.people?.includes(id)))
  }

  switch (sort) {
    case 'date':
      result.sort((a, b) => b.modified - a.modified)
      break
    case 'name':
      result.sort((a, b) => a.name.localeCompare(b.name))
      break
    case 'size':
      result.sort((a, b) => b.sizeMb - a.sizeMb)
      break
  }

  return result
}

interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

// Deleted clips stay on disk this long so the delete can be undone
export const DELETE_UNDO_SECONDS = 15

export interface PendingDelete {
  id: number
  clips: Clip[]
  expiresAt: number
}

interface AppContextType {
  // Settings
  settings: Settings | null
  isConfigured: boolean
  updateSettings: (settings: Partial<Settings>) => Promise<void>
  pickDirectory: (title: string) => Promise<string | null>

  // Games & Clips
  games: Game[]
  clips: Clip[]
  selectedGame: string | null
  selectedClip: Clip | null
  selectedClips: Clip[]
  clipInfo: ClipInfo | null
  selectGame: (game: string | null) => void
  selectClip: (clip: Clip | null, isMulti?: boolean, isRange?: boolean) => void
  selectAllClips: () => void
  clearSelection: () => void
  refreshGames: () => Promise<void>
  refreshClips: () => Promise<void>
  goHome: () => void

  // Navigation History
  canGoBack: boolean
  canGoForward: boolean
  goBack: () => void
  goForward: () => void

  // Filter & Sort
  filter: 'all' | 'video' | 'image'
  sort: 'date' | 'name' | 'size'
  setFilter: (filter: 'all' | 'video' | 'image') => void
  setSort: (sort: 'date' | 'name' | 'size') => void
  filteredClips: Clip[]

  // Filters the clip list by name
  search: string
  setSearch: (search: string) => void

  // Friends tagged on clips
  people: Person[]
  personFilter: string[]
  setPersonFilter: (ids: string[]) => void
  addPerson: (name: string) => Promise<Person>
  removePerson: (id: string) => Promise<void>
  setClipPeople: (clip: Clip, ids: string[]) => Promise<void>
  refreshPeople: () => Promise<void>
  showFriendManager: boolean
  setShowFriendManager: (show: boolean) => void

  // Encoders
  encoders: EncoderInfo[]
  detectEncoders: () => Promise<void>

  // UI State
  loading: boolean
  loadingText: string
  setLoading: (loading: boolean, text?: string) => void
  showSettings: boolean
  setShowSettings: (show: boolean) => void
  showTunnelNotice: boolean
  dismissTunnelNotice: () => Promise<void>
  showChangelog: boolean
  dismissChangelog: () => Promise<void>

  // Updates
  updateStatus: 'none' | 'available' | 'downloading' | 'ready'
  updateVersion: string | null
  updateProgress: number
  downloadUpdate: () => void
  installUpdate: () => void
  dismissUpdate: () => void

  // Deleting with undo
  pendingDeletes: PendingDelete[]
  deleteClips: (clips: Clip[]) => void
  undoDelete: (id: number) => void
  // Set to a clip's path to start it playing as soon as it loads
  autoPlayPath: string | null
  selectNextClip: () => void
  clearAutoPlay: () => void

  // Toasts
  toasts: Toast[]
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void
  removeToast: (id: number) => void
}

const AppContext = createContext<AppContextType | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  // Settings
  const [settings, setSettings] = useState<Settings | null>(null)
  const [isConfigured, setIsConfigured] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)

  // Games & Clips
  const [games, setGames] = useState<Game[]>([])
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedGame, setSelectedGame] = useState<string | null>(null)
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null)
  const [selectedClips, setSelectedClips] = useState<Clip[]>([])
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1)
  const [clipInfo, setClipInfo] = useState<ClipInfo | null>(null)

  // Filter & Sort
  const [filter, setFilter] = useState<'all' | 'video' | 'image'>('all')
  const [sort, setSort] = useState<'date' | 'name' | 'size'>('date')
  const [people, setPeople] = useState<Person[]>([])
  const [personFilter, setPersonFilter] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [showFriendManager, setShowFriendManager] = useState(false)

  // Encoders
  const [encoders, setEncoders] = useState<EncoderInfo[]>([])

  // UI State
  const [loading, setLoadingState] = useState(false)
  const [loadingText, setLoadingText] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showTunnelNotice, setShowTunnelNotice] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)

  // Update state
  const [updateStatus, setUpdateStatus] = useState<'none' | 'available' | 'downloading' | 'ready'>('none')
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updateProgress, setUpdateProgress] = useState(0)

  // Pending deletes
  const [pendingDeletes, setPendingDeletes] = useState<PendingDelete[]>([])
  const [autoPlayPath, setAutoPlayPath] = useState<string | null>(null)
  const deleteTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const nextDeleteId = useRef(1)
  const hiddenPaths = useMemo(
    () => new Set(pendingDeletes.flatMap(pending => pending.clips.map(clip => clip.path))),
    [pendingDeletes]
  )

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([])
  const [toastId, setToastId] = useState(0)

  // Navigation History
  const [navHistory, setNavHistory] = useState<(string | null)[]>([null])
  const [navIndex, setNavIndex] = useState(0)
  const [isNavigating, setIsNavigating] = useState(false)

  const canGoBack = navIndex > 0
  const canGoForward = navIndex < navHistory.length - 1

  const addToHistory = useCallback((location: string | null) => {
    setNavHistory(prev => {
      // Remove any forward history
      const newHistory = prev.slice(0, navIndex + 1)
      // Don't add if it's the same as current location
      if (newHistory[newHistory.length - 1] === location) {
        return prev
      }
      // Add new location
      return [...newHistory, location]
    })
    setNavIndex(prev => prev + 1)
  }, [navIndex])

  const goBack = useCallback(async () => {
    if (canGoBack) {
      setIsNavigating(true)
      setNavIndex(prev => prev - 1)
      const targetLocation = navHistory[navIndex - 1]
      setSelectedGame(targetLocation)
      setSelectedClip(null)
      setSelectedClips([])
      setLastSelectedIndex(-1)
      setClipInfo(null)
      if (targetLocation) {
        const loadedClips = await loadClips(targetLocation)
        setClips(loadedClips)
      } else {
        setClips([])
      }

      // Refresh games to update folder counts
      const loadedGames = await window.clipit.getGames()
      setGames(loadedGames)

      setTimeout(() => setIsNavigating(false), 0)
    }
  }, [canGoBack, navHistory, navIndex])

  const goForward = useCallback(async () => {
    if (canGoForward) {
      setIsNavigating(true)
      setNavIndex(prev => prev + 1)
      const targetLocation = navHistory[navIndex + 1]
      setSelectedGame(targetLocation)
      setSelectedClip(null)
      setSelectedClips([])
      setLastSelectedIndex(-1)
      setClipInfo(null)
      if (targetLocation) {
        const loadedClips = await loadClips(targetLocation)
        setClips(loadedClips)
      } else {
        setClips([])
      }

      // Refresh games to update folder counts
      const loadedGames = await window.clipit.getGames()
      setGames(loadedGames)

      setTimeout(() => setIsNavigating(false), 0)
    }
  }, [canGoForward, navHistory, navIndex])

  const goHome = useCallback(async () => {
    if (!isNavigating) {
      addToHistory(null)
    }
    setSelectedGame(null)
    setSelectedClip(null)
    setSelectedClips([])
    setLastSelectedIndex(-1)
    setClipInfo(null)
    setClips([])

    // Refresh games when going home
    const loadedGames = await window.clipit.getGames()
    setGames(loadedGames)
  }, [isNavigating, addToHistory])

  useEffect(() => {
    const loadInitialData = async () => {
      const configured = await window.clipit.isConfigured()
      setIsConfigured(configured)

      const loadedSettings = await window.clipit.getSettings()
      setSettings(loadedSettings)

      if (configured && !loadedSettings.hasSeenTunnelNotice) {
        setShowTunnelNotice(true)
      }

      if (configured) {
        const appVersion = await window.clipit.getAppVersion()
        if (appVersion && loadedSettings.lastSeenChangelog !== appVersion) {
          setShowChangelog(true)
        }

        const loadedGames = await window.clipit.getGames()
        setGames(loadedGames)
        setPeople(await window.clipit.getPeople())
      }

      setIsInitializing(false)
    }

    loadInitialData()
  }, [])

  useEffect(() => {
    const unsubSettings = window.clipit.onOpenSettings(() => {
      setShowSettings(true)
    })

    const unsubHome = window.clipit.onGoHome(() => {
      goHome()
    })

    return () => {
      unsubSettings()
      unsubHome()
    }
  }, [goHome])

  useEffect(() => {
    const unsubAvailable = window.clipit.onUpdateAvailable((info) => {
      setUpdateStatus('available')
      setUpdateVersion(info.version)
    })

    const unsubProgress = window.clipit.onUpdateDownloadProgress((progress) => {
      setUpdateStatus('downloading')
      setUpdateProgress(progress.percent)
    })

    const unsubDownloaded = window.clipit.onUpdateDownloaded((info) => {
      setUpdateStatus('ready')
      setUpdateVersion(info.version)
      setUpdateProgress(100)
    })

    const unsubError = window.clipit.onUpdateError((error) => {
      setToasts(prev => [...prev, {
        id: Date.now(),
        message: `Update failed: ${error.error}`,
        type: 'error' as const
      }])
      setUpdateStatus('none')
    })

    return () => {
      unsubAvailable()
      unsubProgress()
      unsubDownloaded()
      unsubError()
    }
  }, [])

  useEffect(() => {
    const loadClipInfo = async () => {
      if (selectedClip) {
        const info = await window.clipit.getClipInfo(selectedClip.path)
        setClipInfo(info)
      } else {
        setClipInfo(null)
      }
    }

    loadClipInfo()
  }, [selectedClip])

  const updateSettings = useCallback(async (newSettings: Partial<Settings>) => {
    const wasConfigured = isConfigured

    await window.clipit.setSettings(newSettings)
    const updated = await window.clipit.getSettings()
    setSettings(updated)

    const configured = await window.clipit.isConfigured()
    setIsConfigured(configured)

    // Show tunnel notice after first setup
    if (!wasConfigured && configured && !updated.hasSeenTunnelNotice) {
      setShowTunnelNotice(true)
    }

    if (newSettings.recordingsDir !== undefined && configured) {
      const loadedGames = await window.clipit.getGames()
      setGames(loadedGames)
    }
  }, [isConfigured])

  const pickDirectory = useCallback(async (title: string) => {
    return window.clipit.pickDirectory(title)
  }, [])

  const dismissTunnelNotice = useCallback(async () => {
    await window.clipit.setSettings({ hasSeenTunnelNotice: true })
    const updated = await window.clipit.getSettings()
    setSettings(updated)
    setShowTunnelNotice(false)
  }, [])

  const dismissChangelog = useCallback(async () => {
    const appVersion = await window.clipit.getAppVersion()
    await window.clipit.setSettings({ lastSeenChangelog: appVersion })
    const updated = await window.clipit.getSettings()
    setSettings(updated)
    setShowChangelog(false)
  }, [])

  const selectGame = useCallback(async (game: string | null) => {
    if (!isNavigating) {
      addToHistory(game)
    }
    setSelectedGame(game)
    setSelectedClip(null)
    setSelectedClips([])
    setLastSelectedIndex(-1)
    setClipInfo(null)

    if (game) {
      const loadedClips = await loadClips(game)
      setClips(loadedClips)
    } else {
      setClips([])
    }

    // Refresh games to update folder counts
    const loadedGames = await window.clipit.getGames()
    setGames(loadedGames)
  }, [isNavigating, addToHistory])

  // Filtered and sorted clips
  const filteredClips = useMemo(
    () => visibleClips(clips, hiddenPaths, filter, sort, personFilter, search),
    [clips, filter, sort, hiddenPaths, personFilter, search]
  )

  // Move to the clip below the current one and play it, as after a delete
  const selectNextClip = useCallback(() => {
    const list = visibleClips(clips, hiddenPaths, filter, sort, personFilter, search)
    const index = selectedClip ? list.findIndex(c => c.path === selectedClip.path) : -1
    const next = list[index + 1]
    if (!next) return
    setSelectedClip(next)
    setSelectedClips([next])
    setLastSelectedIndex(index + 1)
    if (next.type === 'video') setAutoPlayPath(next.path)
  }, [clips, hiddenPaths, filter, sort, personFilter, search, selectedClip])

  const selectClip = useCallback((clip: Clip | null, isMulti = false, isRange = false) => {
    if (!clip) {
      // Clear all selection
      setSelectedClip(null)
      setSelectedClips([])
      setLastSelectedIndex(-1)
      return
    }

    const currentFilteredClips = visibleClips(clips, hiddenPaths, filter, sort, personFilter, search)

    const clipIndex = currentFilteredClips.findIndex(c => c.path === clip.path)

    if (isRange && lastSelectedIndex !== -1 && clipIndex !== -1) {
      // Range selection with Shift
      const start = Math.min(lastSelectedIndex, clipIndex)
      const end = Math.max(lastSelectedIndex, clipIndex)
      const rangeClips = currentFilteredClips.slice(start, end + 1)
      setSelectedClips(rangeClips)
      setSelectedClip(clip)
    } else if (isMulti) {
      // Multi selection with Ctrl
      const isAlreadySelected = selectedClips.some(c => c.path === clip.path)
      if (isAlreadySelected) {
        // Remove from selection
        const newSelection = selectedClips.filter(c => c.path !== clip.path)
        setSelectedClips(newSelection)
        setSelectedClip(newSelection.length > 0 ? newSelection[newSelection.length - 1] : null)
      } else {
        // Add to selection
        setSelectedClips([...selectedClips, clip])
        setSelectedClip(clip)
      }
      setLastSelectedIndex(clipIndex)
    } else {
      // Single selection
      setSelectedClip(clip)
      setSelectedClips([clip])
      setLastSelectedIndex(clipIndex)
    }
  }, [clips, filter, sort, hiddenPaths, personFilter, search, lastSelectedIndex, selectedClips])

  const selectAllClips = useCallback(() => {
    setSelectedClips(filteredClips)
    if (filteredClips.length > 0) {
      setSelectedClip(filteredClips[filteredClips.length - 1])
      setLastSelectedIndex(filteredClips.length - 1)
    }
  }, [filteredClips])

  const clearSelection = useCallback(() => {
    setSelectedClip(null)
    setSelectedClips([])
    setLastSelectedIndex(-1)
  }, [])

  const refreshGames = useCallback(async () => {
    const loadedGames = await window.clipit.getGames()
    setGames(loadedGames)
  }, [])

  const refreshClips = useCallback(async () => {
    if (selectedGame) {
      const loadedClips = await loadClips(selectedGame)
      setClips(loadedClips)
    }
  }, [selectedGame])

  const addPerson = useCallback(async (name: string) => {
    const person = await window.clipit.addPerson(name)
    setPeople(await window.clipit.getPeople())
    return person
  }, [])

  const removePerson = useCallback(async (id: string) => {
    await window.clipit.removePerson(id)
    setPeople(await window.clipit.getPeople())
    setPersonFilter(prev => prev.filter(personId => personId !== id))
    const strip = (clip: Clip) => clip.people?.includes(id) ? { ...clip, people: clip.people.filter(p => p !== id) } : clip
    setClips(prev => prev.map(strip))
    setSelectedClip(prev => prev && strip(prev))
    setSelectedClips(prev => prev.map(strip))
  }, [])

  const refreshPeople = useCallback(async () => {
    setPeople(await window.clipit.getPeople())
  }, [])

  const setClipPeople = useCallback(async (clip: Clip, ids: string[]) => {
    setPeople(await window.clipit.setClipPeople(clip.path, ids))
    const update = (c: Clip) => c.path === clip.path ? { ...c, people: ids } : c
    setClips(prev => prev.map(update))
    setSelectedClip(prev => prev && update(prev))
    setSelectedClips(prev => prev.map(update))
  }, [])

  // New, renamed or deleted files in the recordings folder
  useEffect(() => {
    return window.clipit.onMediaChanged(() => {
      refreshGames()
      refreshClips()
      refreshPeople()
    })
  }, [refreshGames, refreshClips, refreshPeople])

  const detectEncoders = useCallback(async () => {
    const detected = await window.clipit.detectEncoders()
    setEncoders(detected)
  }, [])

  const setLoading = useCallback((isLoading: boolean, text?: string) => {
    setLoadingState(isLoading)
    setLoadingText(text || '')
  }, [])

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = toastId
    setToastId(prev => prev + 1)
    setToasts(prev => [...prev, { id, message, type }])

    // Auto remove after 5 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 5000)
  }, [toastId])

  // Timers outlive renders, so they call the latest refresh functions
  const refreshRef = useRef({ refreshClips, refreshGames, addToast })
  refreshRef.current = { refreshClips, refreshGames, addToast }

  const deleteClips = useCallback((toDelete: Clip[]) => {
    const compressing = new Set(getCompressJobs().map(job => job.clip.path))
    const clipsToDelete = toDelete.filter(clip => !compressing.has(clip.path) && !hiddenPaths.has(clip.path))
    if (clipsToDelete.length < toDelete.length) {
      addToast('Clips that are being compressed were not deleted', 'info')
    }
    if (clipsToDelete.length === 0) return

    // Move on to the clip below the deleted ones (or above, at the end of the list)
    const deletedPaths = new Set(clipsToDelete.map(clip => clip.path))
    const lastIndex = Math.max(...filteredClips.map((clip, i) => deletedPaths.has(clip.path) ? i : -1))
    const remaining = filteredClips.filter(clip => !deletedPaths.has(clip.path))
    const next = lastIndex >= 0
      ? filteredClips.slice(lastIndex + 1).find(clip => !deletedPaths.has(clip.path)) || remaining[remaining.length - 1]
      : undefined
    const shouldMove = selectedClips.some(clip => deletedPaths.has(clip.path)) || (selectedClip && deletedPaths.has(selectedClip.path))

    const id = nextDeleteId.current++
    setPendingDeletes(prev => [...prev, { id, clips: clipsToDelete, expiresAt: Date.now() + DELETE_UNDO_SECONDS * 1000 }])

    if (shouldMove) {
      if (next) {
        setSelectedClip(next)
        setSelectedClips([next])
        setLastSelectedIndex(remaining.findIndex(clip => clip.path === next.path))
        if (next.type === 'video') setAutoPlayPath(next.path)
      } else {
        setSelectedClip(null)
        setSelectedClips([])
        setLastSelectedIndex(-1)
      }
    }

    deleteTimers.current.set(id, setTimeout(async () => {
      deleteTimers.current.delete(id)
      const { refreshClips, refreshGames, addToast } = refreshRef.current
      for (const clip of clipsToDelete) {
        try {
          const result = await window.clipit.deleteFile(clip.path)
          if (!result.success) addToast(result.error || `Failed to delete ${clip.name}`, 'error')
        } catch {
          addToast(`Failed to delete ${clip.name}`, 'error')
        }
      }
      // Refresh first so the deleted clips don't flash back into the list
      await refreshClips()
      await refreshGames()
      setPendingDeletes(prev => prev.filter(pending => pending.id !== id))
    }, DELETE_UNDO_SECONDS * 1000))
  }, [filteredClips, hiddenPaths, selectedClip, selectedClips, addToast])

  const undoDelete = useCallback((id: number) => {
    const timer = deleteTimers.current.get(id)
    if (!timer) return
    clearTimeout(timer)
    deleteTimers.current.delete(id)
    setPendingDeletes(prev => prev.filter(pending => pending.id !== id))
  }, [])

  // Lets the main process finish these deletes if the app is closed during the undo window
  useEffect(() => {
    window.clipit.setPendingDeletes([...hiddenPaths])
  }, [hiddenPaths])

  const clearAutoPlay = useCallback(() => setAutoPlayPath(null), [])

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const downloadUpdate = useCallback(() => {
    window.clipit.downloadUpdate()
  }, [])

  const installUpdate = useCallback(() => {
    window.clipit.installUpdate()
  }, [])

  const dismissUpdate = useCallback(() => {
    setUpdateStatus('none')
    setUpdateVersion(null)
    setUpdateProgress(0)
  }, [])

  const value: AppContextType = {
    settings,
    isConfigured,
    updateSettings,
    pickDirectory,
    games,
    clips,
    selectedGame,
    selectedClip,
    selectedClips,
    clipInfo,
    selectGame,
    selectClip,
    selectAllClips,
    clearSelection,
    refreshGames,
    refreshClips,
    goHome,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    filter,
    sort,
    setFilter,
    setSort,
    filteredClips,
    search,
    setSearch,
    people,
    personFilter,
    setPersonFilter,
    addPerson,
    removePerson,
    setClipPeople,
    refreshPeople,
    showFriendManager,
    setShowFriendManager,
    encoders,
    detectEncoders,
    loading,
    loadingText,
    setLoading,
    showSettings,
    setShowSettings,
    showTunnelNotice,
    dismissTunnelNotice,
    showChangelog,
    dismissChangelog,
    updateStatus,
    updateVersion,
    updateProgress,
    downloadUpdate,
    installUpdate,
    dismissUpdate,
    pendingDeletes,
    deleteClips,
    undoDelete,
    autoPlayPath,
    selectNextClip,
    clearAutoPlay,
    toasts,
    addToast,
    removeToast
  }

  // Don't render anything until we've checked if the app is configured
  if (isInitializing) {
    return null
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within AppProvider')
  }
  return context
}
