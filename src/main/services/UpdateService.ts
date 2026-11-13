import { autoUpdater } from 'electron-updater'
import { BrowserWindow, app } from 'electron'

// How often a running Clipit looks for a newer version
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export class UpdateService {
  private mainWindow: BrowserWindow | null = null
  // Background checks stay quiet when they fail (offline, GitHub down); one the user asked for reports it
  private userInitiated = false
  private downloading = false
  private downloaded = false
  private recheckTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Fetch new versions in the background (only the changed parts, thanks to the blockmap),
    // so by the time anyone sees the banner the update is already on disk
    autoUpdater.autoDownload = true
    // Anything not installed yet is installed silently when Clipit is closed
    autoUpdater.autoInstallOnAppQuit = true

    // Set up event listeners
    this.setupEventListeners()
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  private setupEventListeners() {
    autoUpdater.on('error', (error) => {
      const report = this.userInitiated || this.downloading
      this.userInitiated = false
      this.downloading = false
      if (report) this.sendToRenderer('update-error', { error: error.message })
      else console.error('[update] background check failed:', error.message)
    })

    autoUpdater.on('checking-for-update', () => {
      this.sendToRenderer('update-checking')
    })

    autoUpdater.on('update-available', (info) => {
      this.userInitiated = false
      this.downloading = true
      this.sendToRenderer('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes
      })
    })

    autoUpdater.on('update-not-available', () => {
      this.userInitiated = false
      this.sendToRenderer('update-not-available')
    })

    autoUpdater.on('download-progress', (progressObj) => {
      this.sendToRenderer('update-download-progress', {
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      this.downloading = false
      this.downloaded = true
      this.sendToRenderer('update-downloaded', {
        version: info.version
      })
    })
  }

  private sendToRenderer(channel: string, data?: any) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }

  // Check for updates (call this on app startup), then again every few hours
  checkForUpdates() {
    // Only check in production (packaged app)
    if (!app.isPackaged) {
      return
    }

    this.checkInBackground()
    if (!this.recheckTimer) {
      this.recheckTimer = setInterval(() => this.checkInBackground(), RECHECK_INTERVAL_MS)
    }
  }

  private checkInBackground() {
    // Nothing more to find once a version is downloaded or on its way
    if (this.downloading || this.downloaded) return
    autoUpdater.checkForUpdates().catch(() => {
      // Reported through the error event
    })
  }

  // Manual check triggered by user
  async checkForUpdatesManual() {
    if (this.downloading || this.downloaded) return
    this.userInitiated = true
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.userInitiated = false
      this.sendToRenderer('update-error', { error: 'Failed to check for updates' })
    }
  }

  // Updates download by themselves; this only matters if a download was interrupted
  downloadUpdate() {
    if (this.downloading || this.downloaded) return
    this.downloading = true
    autoUpdater.downloadUpdate().catch(() => {
      this.downloading = false
    })
  }

  // Install update (triggered by user clicking restart button). Silent: no installer
  // window, Clipit closes, updates in the background and reopens by itself.
  installUpdate() {
    autoUpdater.quitAndInstall(true, true)
  }
}

export const updateService = new UpdateService()
