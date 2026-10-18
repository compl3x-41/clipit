export interface ChangelogEntry {
  version: string
  changes: string[]
}

const changelog: ChangelogEntry[] = [
  {
    version: '1.4.0',
    changes: [
      'New Modern theme (default) with thumbnail cards and a filmstrip timeline with hover previews; Classic is still in Settings',
      'One-click Compress with presets, size estimates, trim support and a background queue with a status bar',
      'Delete with a 15 second Undo instead of a confirm box, and the next clip starts playing',
      'Click the file name above the timeline to rename it; fixed F2 rename on Windows',
      'Unedited clips glow red, thumbnails show the recording date and time, hover a clip for full details',
      'Trimmed and compressed files keep the original date so they stay in place when sorted by newest',
      'Fullscreen and volume controls, 5 second skip on arrow keys, frame step on < >, resizable clip list',
      'Opens maximised',
    ],
  },
  {
    version: '1.3.2',
    changes: [
      'Fixed TypeScript type errors in settings modal (codec, quality, fps, resolution)',
      'Removed unused imports and variables across the codebase',
    ],
  },
  {
    version: '1.3.1',
    changes: [
      'Fixed thumbnail generation issue',
    ],
  },
  {
    version: '1.3.0',
    changes: [
      'Added Streamable upload integration (direct video uploads)',
    ],
  },
]

export default changelog
