// Shared types between main and renderer

export interface Game {
  name: string
  count: number
  // Newest clip in the folder, so folders can be sorted by most recently added to
  latest?: number
  sizeBytes?: number
}

export interface Clip {
  path: string
  name: string
  game: string
  type: 'video' | 'image'
  sizeMb: number
  modified: number
  modifiedStr: string
  // Trimmed or compressed by Clipit
  edited?: boolean
  compressed?: boolean
  // Ids of the friends tagged in this clip
  people?: string[]
  // Opened by dragging in a file from outside the recordings folder
  external?: boolean
}

export interface Person {
  id: string
  name: string
  // When they were last added to a clip, so recent friends come first
  lastUsed: number
  // Other names they go by, e.g. their Discord name, used to recognise them in the overlay
  aliases?: string[]
}

// Part of the video the Discord overlay sits in, as fractions of the frame
export interface OverlayRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface ScanSettings {
  region: OverlayRegion
  // Frames read per clip; the overlay may only show people while they talk
  framesPerClip: number
}

export interface ScanProgress {
  running: boolean
  mode: 'library' | 'test'
  total: number
  done: number
  current?: string
  // Clips where the overlay showed at least one name
  clipsWithNames: number
  // Clips that got at least one friend tagged
  clipsTagged: number
  skipped: number
  failed: number
  error?: string
}

export interface ScanDebugItem {
  clip: string
  // The cropped overlay frames as data URLs
  frames: string[]
  lines: string[]
  names: string[]
  matched: string[]
  error?: string
}

export interface UnlinkedName {
  name: string
  clips: number
}

// Pseudo game folder that lists the clips of every game
export const ALL_CLIPS = '__all__'

export interface ClipInfo {
  type: 'video' | 'image'
  duration?: number
  width?: number
  height?: number
  codec?: string
}

export interface TrimResult {
  success: boolean
  output?: string
  sizeMb?: number
  error?: string
  savedAsCopy?: boolean
}

export type ShareDestination = 'tunnel' | 'streamable'

export interface ShareRequest {
  path: string
  destination?: ShareDestination
  encode?: boolean
  codec?: 'h264' | 'h265'
  quality?: 'high' | 'medium' | 'low'
  fps?: 'original' | '60' | '30'
  resolution?: 'original' | '1080' | '720'
}

export interface CompressRequest {
  path: string
  resolution: 'original' | '1440' | '1080' | '720' | '480'
  fps: 'original' | '60' | '30'
  codec: 'h264' | 'h265'
  videoBitrateKbps: number
  audioBitrateKbps: number
  deleteOriginal: boolean
  // Only encode this section of the clip, in seconds
  startTime?: number
  endTime?: number
}

export interface CompressResult {
  success: boolean
  output?: string
  sizeMb?: number
  originalSizeMb?: number
  deletedOriginal?: boolean
  cancelled?: boolean
  error?: string
  // Set when a rename asked for during compression didn't work
  renameError?: string
}

export interface CompressProgress {
  percent: number
}

export interface UploadProgress {
  percent: number
  uploadedMb: number
  totalMb: number
}

export interface ShareResult {
  success: boolean
  shareUrl?: string
  sharePath?: string
  alreadyShared?: boolean
  encoded?: boolean
  sizeMb?: number
  error?: string
}

export interface Settings {
  recordingsDir: string
  shareDir: string
  generateThumbnails: boolean
  hasSeenTunnelNotice: boolean
  encodeOnShare: boolean
  codec: 'h264' | 'h265'
  quality: 'high' | 'medium' | 'low'
  fps: 'original' | '60' | '30'
  resolution: 'original' | '1080' | '720'
  preferredEncoder: string
  streamableUsername: string
  streamablePassword: string
  lastSeenChangelog: string
}

export interface EncoderInfo {
  name: string
  type: 'nvidia' | 'amd' | 'intel' | 'cpu'
  available: boolean
}

// File filter for dialog
export interface FileFilter {
  name: string
  extensions: string[]
}

// Constants
export const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm']
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']
