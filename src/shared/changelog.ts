export interface ChangelogEntry {
  version: string
  changes: string[]
}

const changelog: ChangelogEntry[] = [
  {
    version: '1.6.0',
    changes: [
      'Experimental Discord overlay auto-tag: scans your clips for the voice overlay and tags the friends it finds, with a Friend Manager to link Discord names and merge duplicates',
      'Pressing C on a raw clip opens the name box while it compresses, and Enter jumps to the next clip',
      'Renames show straight away and the file is renamed when you move to another clip, so playback no longer stalls; Escape and clicking off save the name',
      'One-click 0.25x, 0.5x, 1x and 2x speed buttons, and every clip starts at 1x',
      'Choose how far the arrow keys skip (3 seconds by default)',
      'Notifications moved to the top right so they no longer cover the timeline',
      'Fixed a Loading spinner that stayed after tagging a friend',
    ],
  },
  {
    version: '1.5.0',
    changes: [
      'Tag friends on clips, filter clips by one or more friends, and an All clips view across every game',
      'New clips appear on their own, plus a clip search box (Ctrl+F)',
      'Playback speed menu from 0.1x to 5x (S toggles 1x, 0.5x, 0.25x)',
      'Clip list as a list or 1, 2 or 3 across; game folders sort by recently added, most clips or name and show clip count and size',
      'Clips renamed or trimmed but not compressed glow yellow; already-compressed clips are spotted automatically',
      'Thumbnails are kept in Clipit\'s own folder instead of next to your clips, and a Clean up button clears cached pictures',
      'Bigger title bar with date, time, size and friends next to the clip name',
    ],
  },
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
