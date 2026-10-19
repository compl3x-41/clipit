import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import Timeline from './Timeline'
import CompressModal from './CompressModal'
import ClipTitle from './ClipTitle'
import { isRawRecordingName } from '../../shared/clipNames'
import PeoplePicker from './PeoplePicker'
import { formatUkDate, formatUkTime } from './ClipHoverCard'
import { Play, Pause, Scissors, Share2, Trash2, Volume1, Volume2, VolumeX, Loader2, Maximize, Minimize, Minimize2, Gauge, ChevronDown, Minus, Plus } from 'lucide-react'
import type { CompressRequest, Person } from '../../shared/types'
import { useTheme } from '../theme'
import { buildCompressRequest, loadCustomSettings, loadDeleteOriginal, loadPresetId, presetName, settingsForPreset } from '../compressPrefs'
import { estimateSizeMb, probeForSection } from '../../shared/compress'
import type { VideoProbe } from '../../shared/compress'
import { enqueueCompress, isReplacingClip, onCompressFinished, useCompressQueue } from '../compressQueue'
import { queueRename, cancelRename, usePendingRenames, holdRename, releaseRename } from '../renameQueue'

type ShareDestination = 'tunnel' | 'streamable'

// Used for frame stepping until the clip's real frame rate has been probed
const DEFAULT_FRAME_RATE = 60
const FILMSTRIP_FRAMES = 20
// How far the left/right arrow keys jump, picked next to the speed buttons
const SKIP_KEY = 'clipit:skipSeconds'
const DEFAULT_SKIP_SECONDS = 3
const SKIP_PRESETS = [1, 2, 3, 5, 10, 15, 30]

function loadSkipSeconds(): number {
  try {
    const saved = parseFloat(localStorage.getItem(SKIP_KEY) ?? '')
    return saved > 0 ? saved : DEFAULT_SKIP_SECONDS
  } catch {
    return DEFAULT_SKIP_SECONDS
  }
}

// The arrow keys' label shows the chosen skip length
const SHORTCUTS: [string, string][] = [
  ['←→', 'Skip'],
  ['< >', 'Frame'],
  ['↑↓', 'Vol'],
  ['M', 'Mute'],
  ['S', 'Speed'],
  ['F', 'Full'],
  ['I O', 'In/Out'],
  ['R', 'Reset'],
  ['⇧C', 'Options']
]

// Choices in the speed menu
const PLAYBACK_SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5]
// S cycles through these slow-motion speeds
const QUICK_SPEEDS = [1, 0.5, 0.25]
// One-click speed buttons; the rest are in the menu
const SPEED_BUTTONS = [0.25, 0.5, 1, 2]

export default function MainContent() {
  const { selectedClip, clipInfo, refreshClips, refreshGames, selectClip, setLoading, addToast, settings, deleteClips, autoPlayPath, clearAutoPlay, selectNextClip, people, addPerson, removePerson, setClipPeople, setShowFriendManager } = useApp()
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerContainerRef = useRef<HTMLDivElement>(null)

  // Trim state
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [frameRate, setFrameRate] = useState(DEFAULT_FRAME_RATE)
  const [clipProbe, setClipProbe] = useState<VideoProbe | null>(null)
  // Bumped when the compress dialog closes so the button picks up new settings
  const [compressPrefsVersion, setCompressPrefsVersion] = useState(0)
  const [filmstrip, setFilmstrip] = useState<string[] | undefined>(undefined)
  const theme = useTheme()
  const [isMuted, setIsMuted] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [skipSeconds, setSkipSecondsState] = useState(loadSkipSeconds)
  const [showSkipMenu, setShowSkipMenu] = useState(false)
  const skipMenuRef = useRef<HTMLDivElement>(null)
  const setSkipSeconds = useCallback((seconds: number) => {
    const clamped = Math.min(120, Math.max(0.5, Math.round(seconds * 2) / 2))
    setSkipSecondsState(clamped)
    try {
      localStorage.setItem(SKIP_KEY, String(clamped))
    } catch {
      // Still works for this session
    }
  }, [])
  const speedMenuRef = useRef<HTMLDivElement>(null)
  const [volume, setVolume] = useState(1)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isVideoLoading, setIsVideoLoading] = useState(false)
  const [saveAsCopy, setSaveAsCopy] = useState(true)
  const [showSaveDropdown, setShowSaveDropdown] = useState(false)
  const saveDropdownRef = useRef<HTMLDivElement>(null)
  const [shareDestination, setShareDestination] = useState<ShareDestination>('tunnel')
  const [showShareDropdown, setShowShareDropdown] = useState(false)
  const shareDropdownRef = useRef<HTMLDivElement>(null)
  const [showCompress, setShowCompress] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('clipit:saveAsCopy')
    if (saved !== null) {
      setSaveAsCopy(saved === 'true')
    }
    const savedDest = localStorage.getItem('clipit:shareDestination')
    if (savedDest === 'tunnel' || savedDest === 'streamable') {
      setShareDestination(savedDest)
    }
    const savedVolume = parseFloat(localStorage.getItem('clipit:volume') ?? '')
    if (!isNaN(savedVolume)) {
      setVolume(Math.max(0, Math.min(1, savedVolume)))
    }
  }, [])

  // Keep the element's volume in sync (the video element remounts when switching from an image)
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume
    }
  }, [volume, selectedClip?.path, selectedClip?.type])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement !== null && document.fullscreenElement === playerContainerRef.current)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    if (clipInfo?.duration) {
      setDuration(clipInfo.duration)
      setTrimStart(0)
      setTrimEnd(clipInfo.duration)
      setCurrentTime(0)
    }
  }, [clipInfo])

  // Keyed on the path: tagging a friend or renaming swaps the clip object but not the
  // file, and the video wouldn't reload to clear the spinner
  useEffect(() => {
    if (selectedClip?.type === 'video') {
      setIsVideoLoading(true)
      setIsPlaying(false)
    }
    setPlaybackSpeed(1)
  }, [selectedClip?.path, selectedClip?.type])

  // The Medal-style timeline shows frames from the clip
  useEffect(() => {
    setFilmstrip(undefined)
    if (theme !== 'medal' || selectedClip?.type !== 'video') return
    let cancelled = false
    window.clipit.getFilmstrip(selectedClip.path, FILMSTRIP_FRAMES).then((frames) => {
      if (!cancelled) setFilmstrip(frames.map(f => f ? window.clipit.getImageUrl(f) : ''))
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClip?.path, selectedClip?.type, selectedClip?.sizeMb, theme])

  useEffect(() => {
    setFrameRate(DEFAULT_FRAME_RATE)
    setClipProbe(null)
    if (selectedClip?.type !== 'video') return
    let cancelled = false
    window.clipit.probeVideo(selectedClip.path).then((probe) => {
      if (cancelled) return
      setClipProbe(probe && probe.duration > 0 ? probe : null)
      if (probe && probe.fps > 0) setFrameRate(probe.fps)
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClip?.path, selectedClip?.type, selectedClip?.sizeMb])

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime)
    }
  }, [])

  // Playback position to return to after the clip is reloaded under a new name
  const restoreTimeRef = useRef<number | null>(null)

  // A new clip resets the video element, so reapply the speed each time one loads
  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.defaultPlaybackRate = playbackSpeed
    videoRef.current.playbackRate = playbackSpeed
  }, [playbackSpeed, selectedClip?.path])

  useEffect(() => {
    if (!showSpeedMenu) return
    const close = (e: MouseEvent) => {
      if (!speedMenuRef.current?.contains(e.target as Node)) setShowSpeedMenu(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showSpeedMenu])

  useEffect(() => {
    if (!showSkipMenu) return
    const close = (e: MouseEvent) => {
      if (!skipMenuRef.current?.contains(e.target as Node)) setShowSkipMenu(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showSkipMenu])

  const handleCycleSpeed = useCallback(() => {
    setPlaybackSpeed(speed => {
      const index = QUICK_SPEEDS.indexOf(speed)
      return index === -1 ? 1 : QUICK_SPEEDS[(index + 1) % QUICK_SPEEDS.length]
    })
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed
      setDuration(videoRef.current.duration)
      setTrimEnd(videoRef.current.duration)
      setIsVideoLoading(false)
      if (restoreTimeRef.current !== null) {
        videoRef.current.currentTime = restoreTimeRef.current
        setCurrentTime(restoreTimeRef.current)
        restoreTimeRef.current = null
      }
      // The clip below a deleted one starts playing right away
      if (autoPlayPath && autoPlayPath === selectedClip?.path) {
        clearAutoPlay()
        videoRef.current.play().catch(() => {})
      }
    }
  }, [autoPlayPath, selectedClip, clearAutoPlay, playbackSpeed])

  const handlePlayPause = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play()
        setIsPlaying(true)
      } else {
        videoRef.current.pause()
        setIsPlaying(false)
      }
    }
  }, [])

  const handleSeek = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time
      setCurrentTime(time)
    }
  }, [])

  const handleStepFrame = useCallback((direction: 1 | -1) => {
    const video = videoRef.current
    if (!video) return
    if (!video.paused) {
      video.pause()
      setIsPlaying(false)
    }
    const max = Number.isFinite(video.duration) ? video.duration : duration
    const time = Math.min(Math.max(video.currentTime + direction / frameRate, 0), max)
    video.currentTime = time
    setCurrentTime(time)
  }, [duration, frameRate])

  // Jump without changing play/pause
  const handleSkip = useCallback((seconds: number) => {
    const video = videoRef.current
    if (!video) return
    const max = Number.isFinite(video.duration) ? video.duration : duration
    const time = Math.min(Math.max(video.currentTime + seconds, 0), max)
    video.currentTime = time
    setCurrentTime(time)
  }, [duration])

  const handleResetTrim = useCallback(() => {
    setTrimStart(0)
    setTrimEnd(duration)
  }, [duration])

  const handleSaveOptionChange = useCallback((saveAsCopyOption: boolean) => {
    setSaveAsCopy(saveAsCopyOption)
    localStorage.setItem('clipit:saveAsCopy', String(saveAsCopyOption))
    setShowSaveDropdown(false)
  }, [])

  const handleShareDestinationChange = useCallback((dest: ShareDestination) => {
    setShareDestination(dest)
    localStorage.setItem('clipit:shareDestination', dest)
    setShowShareDropdown(false)
  }, [])

  const handleToggleMute = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }, [isMuted])

  const handleVolumeChange = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(1, value))
    setVolume(clamped)
    localStorage.setItem('clipit:volume', String(clamped))
    // Moving the slider up while muted should bring the audio back
    if (clamped > 0 && isMuted) {
      setIsMuted(false)
      if (videoRef.current) videoRef.current.muted = false
    }
  }, [isMuted])

  const handleToggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      playerContainerRef.current?.requestFullscreen().catch((error) => {
        console.error('[Video Player] Fullscreen request failed:', error)
      })
    }
  }, [])

  const handleSetTrimStart = useCallback((time: number) => {
    setTrimStart(time)
    // If setting inset after current outset, move outset to end
    if (time > trimEnd) {
      setTrimEnd(duration)
    }
  }, [trimEnd, duration])

  const handleTrim = useCallback(async () => {
    if (!selectedClip) return

    setLoading(true, saveAsCopy ? 'Saving copy...' : 'Processing trim...')

    try {
      const result = await window.clipit.trim(selectedClip.path, trimStart, trimEnd, saveAsCopy)

      if (result.success) {
        if (saveAsCopy) {
          addToast(`Saved copy: ${result.sizeMb} MB`, 'success')
        } else {
          addToast(`Video trimmed: ${result.sizeMb} MB`, 'success')
        }
        await refreshClips()
        await refreshGames() // Update game counts
        handleResetTrim()
      } else {
        addToast(result.error || 'Trim failed', 'error')
      }
    } catch (error) {
      addToast('Trim failed', 'error')
    } finally {
      setLoading(false)
    }
  }, [selectedClip, trimStart, trimEnd, saveAsCopy, setLoading, addToast, refreshClips, refreshGames, handleResetTrim])

  const handleShare = useCallback(async () => {
    if (!selectedClip) return

    const isStreamable = shareDestination === 'streamable'

    try {
      const currentSettings = await window.clipit.getSettings()

      if (isStreamable && (!currentSettings.streamableUsername || !currentSettings.streamablePassword)) {
        addToast('Streamable credentials not configured. Go to Settings > Accounts.', 'error')
        return
      }

      // Show encoding message if encoding is enabled and file is a video
      const isVideo = selectedClip.type === 'video'
      if (currentSettings.encodeOnShare && isVideo) {
        setLoading(true, 'Encoding video...')
        // Small delay to show the encoding message
        await new Promise(resolve => setTimeout(resolve, 100))
      } else {
        setLoading(true, isStreamable ? 'Uploading to Streamable...' : 'Preparing to share...')
      }

      // Set up upload progress listener for Streamable
      let cleanupProgress: (() => void) | null = null
      if (isStreamable) {
        cleanupProgress = window.clipit.onUploadProgress((progress) => {
          setLoading(true, `Uploading to Streamable... ${progress.percent}%`)
        })
      }

      try {
        const result = await window.clipit.share({
          path: selectedClip.path,
          destination: shareDestination,
          encode: currentSettings.encodeOnShare,
          codec: currentSettings.codec,
          quality: currentSettings.quality,
          fps: currentSettings.fps,
          resolution: currentSettings.resolution
        })

        if (result.success) {
          if (result.shareUrl) {
            await window.clipit.copyToClipboard(result.shareUrl)
            if (isStreamable) {
              addToast('Streamable URL copied to clipboard!', 'success')
            } else {
              addToast(result.alreadyShared ? 'URL copied to clipboard!' : 'Share URL copied to clipboard!', 'success')
              // Notify sidebar that tunnel state may have changed
              window.dispatchEvent(new Event('tunnel-state-changed'))
            }
          } else {
            addToast('Shared successfully', 'success')
          }
        } else {
          addToast(result.error || 'Share failed', 'error')
        }
      } finally {
        if (cleanupProgress) cleanupProgress()
      }
    } catch (error) {
      addToast('Share failed', 'error')
    } finally {
      setLoading(false)
    }
  }, [selectedClip, shareDestination, setLoading, addToast])

  const compressJobs = useCompressQueue()
  const isClipBeingReplaced = !!selectedClip && isReplacingClip(compressJobs, selectedClip.path)
  const pendingRenames = usePendingRenames()
  const pendingRename = selectedClip ? pendingRenames.get(selectedClip.path) : undefined
  const replaceJob = selectedClip ? compressJobs.find(job => job.clip.path === selectedClip.path && job.request.deleteOriginal) : undefined

  // In/out points moved away from the ends of the clip
  const hasTrim = duration > 0 && (trimStart > 0.01 || trimEnd < duration - 0.01)

  const handleOpenCompress = useCallback(() => {
    if (!selectedClip || selectedClip.type !== 'video') return
    if (compressJobs.some(job => job.clip.path === selectedClip.path)) {
      addToast('This clip is already being compressed', 'info')
      return
    }
    videoRef.current?.pause()
    // The dialog is not part of the fullscreen element, so leave fullscreen first
    if (document.fullscreenElement) document.exitFullscreen()
    setShowCompress(true)
  }, [selectedClip, compressJobs, addToast])

  const trimRange = hasTrim ? { start: trimStart, end: trimEnd } : undefined

  // What the one-click button will do, using the settings last picked in the dialog
  const quickCompress = useMemo(() => {
    if (!clipProbe) return null
    const presetId = loadPresetId()
    const settings = settingsForPreset(presetId, loadCustomSettings())
    const section = probeForSection(clipProbe, trimRange?.start, trimRange?.end)
    const beforeMb = Math.round(section.sizeBytes / (1024 * 1024) * 10) / 10
    const afterMb = estimateSizeMb(settings, section)
    return {
      settings,
      presetName: presetName(presetId),
      deleteOriginal: loadDeleteOriginal(),
      beforeMb,
      afterMb,
      savedPercent: beforeMb > 0 ? Math.round((1 - afterMb / beforeMb) * 100) : 0
    }
    // compressPrefsVersion re-reads the saved settings after the dialog closes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipProbe, trimRange?.start, trimRange?.end, compressPrefsVersion])

  const handleQuickCompress = useCallback(() => {
    if (!selectedClip || selectedClip.type !== 'video') return
    if (compressJobs.some(job => job.clip.path === selectedClip.path)) {
      addToast('This clip is already being compressed', 'info')
      return
    }
    if (!clipProbe || !quickCompress) {
      addToast('Still reading the clip, try again in a moment', 'info')
      return
    }
    enqueueCompress(selectedClip, buildCompressRequest(selectedClip.path, quickCompress.settings, clipProbe, quickCompress.deleteOriginal, trimRange))
    // Name it while it compresses, or move on if it already has a name
    if (isRawRecordingName(selectedClip.name)) {
      autoRenamePath.current = selectedClip.path
      setRenameRequest(n => n + 1)
    } else {
      selectNextClip()
    }
  }, [selectedClip, compressJobs, clipProbe, quickCompress, trimRange, addToast, selectNextClip])

  // The rename box opened by C; finishing it moves on to the next clip
  const autoRenamePath = useRef<string | null>(null)
  const [renameRequest, setRenameRequest] = useState(0)
  useEffect(() => {
    if (selectedClip && selectedClip.path !== autoRenamePath.current) autoRenamePath.current = null
  }, [selectedClip])
  // Enter on the box opened by C moves on; Escape or clicking away keeps you on the clip
  const handleTitleClose = useCallback((reason: 'enter' | 'escape' | 'blur') => {
    if (!selectedClip || autoRenamePath.current !== selectedClip.path) return
    autoRenamePath.current = null
    if (reason === 'enter') selectNextClip()
  }, [selectedClip, selectNextClip])

  // What's typed in the rename box, kept here so it survives the player reloading the clip
  // (e.g. when compressing finishes mid-typing)
  const [titleDraft, setTitleDraft] = useState<{ path: string; value: string } | null>(null)
  const handleDraftChange = useCallback((value: string | null) => {
    if (!selectedClip) return
    setTitleDraft(value === null ? null : { path: selectedClip.path, value })
  }, [selectedClip])

  // The new name shows right away; the file itself is renamed once you move off the clip
  const handleRename = useCallback(async (newName: string): Promise<boolean> => {
    if (!selectedClip) return false
    if (/[<>:"/\\|?*]/.test(newName)) {
      addToast('A name can\'t contain < > : " / \\ | ? *', 'error')
      return false
    }
    if (newName === selectedClip.name) cancelRename(selectedClip.path)
    else queueRename(selectedClip.path, newName)
    return true
  }, [selectedClip, addToast])

  const handleCompressStart = useCallback((request: CompressRequest) => {
    if (!selectedClip) return
    setShowCompress(false)
    enqueueCompress(selectedClip, request)
  }, [selectedClip])

  // Refresh the list when a background compression ends, and follow the clip
  // to its compressed file if it's still the one on screen
  const selectedClipRef = useRef(selectedClip)
  selectedClipRef.current = selectedClip
  useEffect(() => {
    return onCompressFinished(async (job, result) => {
      if (!result.success) {
        if (!result.cancelled) {
          addToast(`${job.clip.name}: ${result.error || 'Compression failed'}`, 'error')
        }
        return
      }

      addToast(`Compressed ${job.clip.name}: ${result.originalSizeMb} MB → ${result.sizeMb} MB`, 'success')
      if (job.request.deleteOriginal && result.deletedOriginal === false) {
        addToast('The original could not be deleted, it was kept', 'info')
      }

      const wasViewing = selectedClipRef.current?.path === job.clip.path
      const followOutput = wasViewing && job.request.deleteOriginal && result.output
      // A half-typed name moves to the compressed file, and its rename waits until we're there
      if (followOutput) {
        holdRename(result.output!)
        setTitleDraft(draft => draft && draft.path === job.clip.path ? { ...draft, path: result.output! } : draft)
      }
      try {
        await refreshClips()
        await refreshGames()
        // The player was showing the "compressing" screen, so it loads the new file fresh;
        // the clip is swapped for its new details without clearing the selection,
        // which would close a rename box mid-typing
        const current = selectedClipRef.current?.path
        if (followOutput && (current === job.clip.path || current === result.output)) {
          const clips = await window.clipit.getClips(job.clip.game)
          const compressed = clips.find(c => c.path === result.output)
          if (compressed) selectClip(compressed)
        }
      } finally {
        if (followOutput) releaseRename(result.output!)
      }
    })
  }, [addToast, selectClip, refreshClips, refreshGames])

  const handleRemovePerson = useCallback((person: Person) => {
    if (window.confirm(`Delete ${person.name} from Clipit? They'll be untagged from every clip.`)) {
      removePerson(person.id)
    }
  }, [removePerson])

  const handleDelete = useCallback(() => {
    if (!selectedClip) return
    deleteClips([selectedClip])
  }, [selectedClip, deleteClips])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedClip || selectedClip.type !== 'video') return
      if (isClipBeingReplaced) return
      if (e.target instanceof HTMLInputElement) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault()
          handlePlayPause()
          break
        case 'i':
          handleSetTrimStart(currentTime)
          break
        case 'o':
          setTrimEnd(currentTime)
          break
        case 'r':
          handleResetTrim()
          break
        case 'm':
          handleToggleMute()
          break
        case 's':
          handleCycleSpeed()
          break
        case 'x':
          if (trimStart !== 0 || trimEnd !== duration) {
            e.preventDefault()
            handleTrim()
          }
          break
        case 'c':
          e.preventDefault()
          // C compresses straight away, Shift+C opens the options
          if (e.shiftKey) handleOpenCompress()
          else handleQuickCompress()
          break
        case 'f':
          handleToggleFullscreen()
          break
        case 'arrowup':
          e.preventDefault()
          handleVolumeChange(volume + 0.05)
          break
        case 'arrowdown':
          e.preventDefault()
          handleVolumeChange(volume - 0.05)
          break
        case 'arrowleft':
          e.preventDefault()
          handleSkip(-skipSeconds)
          break
        case 'arrowright':
          e.preventDefault()
          handleSkip(skipSeconds)
          break
        case ',':
        case '<':
          e.preventDefault()
          handleStepFrame(-1)
          break
        case '.':
        case '>':
          e.preventDefault()
          handleStepFrame(1)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedClip, isClipBeingReplaced, currentTime, volume, trimStart, trimEnd, duration, handlePlayPause, handleResetTrim, handleSetTrimStart, handleToggleMute, handleToggleFullscreen, handleVolumeChange, handleTrim, handleOpenCompress, handleQuickCompress, handleStepFrame, handleSkip, handleCycleSpeed, skipSeconds])

  // Escape while fullscreen should only leave fullscreen, not also clear the sidebar selection
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.fullscreenElement) {
        e.stopImmediatePropagation()
        document.exitFullscreen()
      }
    }

    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (saveDropdownRef.current && !saveDropdownRef.current.contains(e.target as Node)) {
        setShowSaveDropdown(false)
      }
    }

    if (showSaveDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showSaveDropdown])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (shareDropdownRef.current && !shareDropdownRef.current.contains(e.target as Node)) {
        setShowShareDropdown(false)
      }
    }

    if (showShareDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showShareDropdown])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }

  if (!selectedClip) {
    return (
      <div className="main-content">
        <div className="player-container">
          <div className="no-selection">Select a clip to view</div>
        </div>
      </div>
    )
  }

  const clipTitle = (
    <ClipTitle
      name={pendingRename ?? selectedClip.name}
      onRename={handleRename}
      // Only the clip C was pressed on; a fresh title on the next clip mustn't open
      editRequest={autoRenamePath.current === selectedClip.path ? renameRequest : 0}
      onClose={handleTitleClose}
      draft={titleDraft?.path === selectedClip.path ? titleDraft.value : null}
      onDraftChange={handleDraftChange}
    />
  )

  // The player has to let go of a clip that is being compressed in place
  if (isClipBeingReplaced && replaceJob) {
    return (
      <div className="main-content">
        <div className="player-container">
          <div className="no-selection compress-placeholder">
            <div className="compress-placeholder-title">{clipTitle}</div>
            <Loader2 size={32} className="compress-spin" />
            <div>
              {replaceJob.status === 'running'
                ? `Compressing... ${replaceJob.percent}%`
                : 'Queued for compression'}
            </div>
            <div className="compress-placeholder-hint">The original is being replaced, so it can't be played until it's done. Other clips work as normal.</div>
          </div>
        </div>
      </div>
    )
  }

  const isVideo = selectedClip.type === 'video'

  // Next to the volume: the common speeds are one click, the rest in a menu that opens upwards.
  // Clicking the active speed again goes back to 1x.
  const offMenu = !SPEED_BUTTONS.includes(playbackSpeed)
  const speedControl = (
    <div className="speed-control" ref={speedMenuRef} title="Playback speed (S cycles 1x, 0.5x, 0.25x)">
      <div className="speed-quick">
        <Gauge size={15} className="speed-icon" />
        {SPEED_BUTTONS.map(speed => (
          <button
            key={speed}
            className={speed === playbackSpeed ? 'active' : ''}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPlaybackSpeed(speed === playbackSpeed ? 1 : speed)}
          >
            {speed}x
          </button>
        ))}
        <button
          className={`speed-more ${offMenu ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation()
            setShowSpeedMenu(!showSpeedMenu)
          }}
          title="More speeds"
        >
          {offMenu ? `${playbackSpeed}x` : <ChevronDown size={14} />}
        </button>
      </div>
      {showSpeedMenu && (
        <div className="speed-menu" onClick={(e) => e.stopPropagation()}>
          {PLAYBACK_SPEEDS.map(speed => (
            <button
              key={speed}
              className={speed === playbackSpeed ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setPlaybackSpeed(speed)
                setShowSpeedMenu(false)
              }}
            >
              {speed}x
            </button>
          ))}
        </div>
      )}
    </div>
  )

  // How far ← and → jump: − and + step it, the middle opens presets and a custom value
  const skipControl = (
    <div className="skip-control" ref={skipMenuRef} title="How far the ← and → keys skip">
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => setSkipSeconds(skipSeconds - (skipSeconds <= 1 ? 0.5 : 1))} title="Skip less">
        <Minus size={13} />
      </button>
      <button className="skip-value" onMouseDown={(e) => e.preventDefault()} onClick={() => setShowSkipMenu(!showSkipMenu)} title="Choose how far ← and → skip">
        ←→ {skipSeconds}s
      </button>
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => setSkipSeconds(skipSeconds + (skipSeconds < 1 ? 0.5 : 1))} title="Skip more">
        <Plus size={13} />
      </button>
      {showSkipMenu && (
        <div className="speed-menu skip-menu" onClick={(e) => e.stopPropagation()}>
          {SKIP_PRESETS.map(seconds => (
            <button
              key={seconds}
              className={seconds === skipSeconds ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSkipSeconds(seconds)
                setShowSkipMenu(false)
              }}
            >
              {seconds}s
            </button>
          ))}
          <label className="skip-custom">
            Custom
            <input
              type="number"
              min={0.5}
              max={120}
              step={0.5}
              defaultValue={skipSeconds}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  const value = parseFloat((e.target as HTMLInputElement).value)
                  if (value > 0) setSkipSeconds(value)
                  setShowSkipMenu(false)
                }
                if (e.key === 'Escape') setShowSkipMenu(false)
              }}
              onBlur={(e) => {
                const value = parseFloat(e.target.value)
                if (value > 0) setSkipSeconds(value)
              }}
            />
            s
          </label>
        </div>
      )}
    </div>
  )

  // Sits in the button row normally, and over the video in fullscreen
  const volumeControl = (
    <div className="volume-control">
      <div
        className="mute-indicator"
        title={isMuted ? 'Audio Muted (Click or M to unmute)' : 'Audio On (Click or M to mute)'}
        onClick={(e) => {
          e.stopPropagation()
          handleToggleMute()
        }}
        style={{ cursor: 'pointer' }}
      >
        {isMuted || volume === 0 ? <VolumeX size={20} /> : volume < 0.5 ? <Volume1 size={20} /> : <Volume2 size={20} />}
      </div>
      <input
        type="range"
        className="volume-slider"
        min={0}
        max={1}
        step={0.01}
        value={isMuted ? 0 : volume}
        title={`Volume ${Math.round((isMuted ? 0 : volume) * 100)}% (Up/Down arrows)`}
        style={{ '--volume-fill': `${(isMuted ? 0 : volume) * 100}%` } as React.CSSProperties}
        onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
        // Drop focus so Space, M, I, O etc. keep working after dragging
        onMouseUp={(e) => e.currentTarget.blur()}
      />
    </div>
  )

  return (
    <div className="main-content">
      <div className="player-container" ref={playerContainerRef}>
        {isVideo ? (
          <>
            <video
              ref={videoRef}
              className="video-player"
              src={window.clipit.getVideoUrl(selectedClip.path)}
              muted={isMuted}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onClick={(e) => {
                // The second click of a double-click is handled by onDoubleClick
                if (e.detail > 1) return
                handlePlayPause()
              }}
              onDoubleClick={() => {
                // Undo the play/pause from the first click, then toggle fullscreen
                handlePlayPause()
                handleToggleFullscreen()
              }}
              onError={(e) => {
                console.error('[Video Player] Error loading video:', selectedClip.path, e)
                addToast('Failed to load video', 'error')
                setIsVideoLoading(false)
              }}
            />
            {isVideoLoading && (
              <div className="video-loading-overlay">
                <Loader2 size={48} className="video-loading-spinner" />
              </div>
            )}
            {!isVideoLoading && (
              <>
                <div className="playback-time-overlay">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </div>
                <div className="player-top-controls">
                  {isFullscreen && <div className="fullscreen-audio">{volumeControl}{speedControl}</div>}
                  <div
                    className="fullscreen-toggle"
                    title={isFullscreen ? 'Exit Fullscreen (F or Esc)' : 'Fullscreen (F or double-click)'}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleFullscreen()
                    }}
                  >
                    {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <img
            className="image-viewer"
            src={window.clipit.getImageUrl(selectedClip.path)}
            alt={selectedClip.name}
            onError={(e) => {
              console.error('[Image Viewer] Error loading image:', selectedClip.path, e)
              addToast('Failed to load image', 'error')
            }}
          />
        )}
      </div>

      <div className="controls">
        <div className="clip-title-row">
          {clipTitle}
          <div className="clip-title-meta">
            <span>{formatUkDate(selectedClip.modified)}</span>
            <span>{formatUkTime(selectedClip.modified)}</span>
            <span>{selectedClip.sizeMb} MB</span>
          </div>
          <PeoplePicker
            people={people}
            selected={selectedClip.people ?? []}
            onChange={(ids) => setClipPeople(selectedClip, ids)}
            onAdd={addPerson}
            onRemove={handleRemovePerson}
            onManage={() => setShowFriendManager(true)}
            label="Friends"
          />
        </div>

        {isVideo && (
          <>
            <Timeline
              duration={duration}
              currentTime={currentTime}
              trimStart={trimStart}
              trimEnd={trimEnd}
              onSeek={handleSeek}
              onTrimStartChange={handleSetTrimStart}
              onTrimEndChange={setTrimEnd}
              frames={filmstrip}
            />

            <div className="time-display">
              <span className="time-trim-start">{formatTime(trimStart)}</span>
              <span>{formatTime(trimEnd - trimStart)}</span>
              <span className="time-trim-end">{formatTime(trimEnd)}</span>
            </div>
          </>
        )}

        {!isVideo && clipInfo && (
          <div className="image-info">
            {clipInfo.width} × {clipInfo.height} • {selectedClip.sizeMb} MB
          </div>
        )}

        <div className="action-buttons">
          {isVideo && (
            <>
              <button className="btn btn-secondary" onClick={handlePlayPause}>
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                {isPlaying ? 'Pause' : 'Play'}
                <kbd className="btn-kbd">Space</kbd>
              </button>
              <div className="split-button-container" ref={saveDropdownRef}>
                <button
                  className="btn btn-primary split-button-main"
                  onClick={handleTrim}
                  disabled={trimStart === 0 && trimEnd === duration}
                  title="Cut (X)"
                >
                  <Scissors size={16} />
                  {saveAsCopy ? 'Save Copy' : 'Overwrite Original'}
                  <kbd className="btn-kbd">X</kbd>
                </button>
                <button
                  className="btn btn-primary split-button-arrow"
                  onClick={() => setShowSaveDropdown(!showSaveDropdown)}
                  disabled={trimStart === 0 && trimEnd === duration}
                />
                {showSaveDropdown && (
                  <div className="split-button-dropdown">
                    <button
                      className={`split-button-option ${saveAsCopy ? 'selected' : ''}`}
                      onClick={() => handleSaveOptionChange(true)}
                    >
                      Save Copy
                    </button>
                    <button
                      className={`split-button-option ${!saveAsCopy ? 'selected' : ''}`}
                      onClick={() => handleSaveOptionChange(false)}
                    >
                      Overwrite Original
                    </button>
                  </div>
                )}
              </div>
              <div className="split-button-container compress-split">
                {quickCompress && (
                  <div className="compress-quick-hint" title={`${quickCompress.presetName}${quickCompress.deleteOriginal ? ', replaces the original' : ', saves a copy'}${trimRange ? ', trimmed part only' : ''}`}>
                    {quickCompress.beforeMb} → ~{quickCompress.afterMb} MB
                    {quickCompress.savedPercent > 0 && <span className="compress-quick-saving"> −{quickCompress.savedPercent}%</span>}
                  </div>
                )}
                <button
                  className="btn btn-primary split-button-main"
                  onClick={handleQuickCompress}
                  title={quickCompress ? `Compress with ${quickCompress.presetName} (C)` : 'Compress (C)'}
                >
                  <Minimize2 size={16} />
                  Compress
                  <kbd className="btn-kbd">C</kbd>
                </button>
                <button
                  className="btn btn-primary split-button-arrow"
                  onClick={handleOpenCompress}
                  title="Compress options (Shift+C)"
                />
              </div>
            </>
          )}
          <div className="split-button-container" ref={shareDropdownRef}>
            <button className="btn btn-secondary split-button-main" onClick={handleShare}>
              <Share2 size={16} />
              {shareDestination === 'streamable' ? 'Streamable' : 'Tunnel'}
            </button>
            <button
              className="btn btn-secondary split-button-arrow"
              onClick={() => setShowShareDropdown(!showShareDropdown)}
            />
            {showShareDropdown && (
              <div className="split-button-dropdown">
                <button
                  className={`split-button-option ${shareDestination === 'tunnel' ? 'selected' : ''}`}
                  onClick={() => handleShareDestinationChange('tunnel')}
                >
                  Tunnel
                </button>
                <button
                  className={`split-button-option ${shareDestination === 'streamable' ? 'selected' : ''} ${!settings?.streamableUsername || !settings?.streamablePassword ? 'disabled' : ''}`}
                  onClick={() => {
                    if (settings?.streamableUsername && settings?.streamablePassword) {
                      handleShareDestinationChange('streamable')
                    } else {
                      addToast('Configure Streamable credentials in Settings > Accounts first', 'info')
                      setShowShareDropdown(false)
                    }
                  }}
                >
                  Streamable
                </button>
              </div>
            )}
          </div>
          <button className="btn btn-danger" onClick={handleDelete}>
            <Trash2 size={16} />
            Delete
            <kbd className="btn-kbd">Del</kbd>
          </button>

          {isVideo && volumeControl}
          {isVideo && speedControl}
          {isVideo && skipControl}

          {isVideo && (
            <div className="shortcuts-hint">
              {SHORTCUTS.map(([key, label]) => (
                <div className="shortcut-item" key={label}>
                  <kbd>{key}</kbd>
                  <span>{label === 'Skip' ? `${skipSeconds}s` : label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCompress && (
        <CompressModal
          clip={selectedClip}
          onClose={() => {
            setShowCompress(false)
            setCompressPrefsVersion(v => v + 1)
          }}
          trim={trimRange}
          onStart={handleCompressStart}
        />
      )}
    </div>
  )
}
