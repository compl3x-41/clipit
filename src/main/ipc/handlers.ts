import { ipcMain, dialog, clipboard, shell, app } from 'electron'
import { settingsStore } from '../store/SettingsStore'
import { getGames, getClips, getClipInfo } from '../services/MediaService'
import { watchRecordings } from '../services/FolderWatchService'
import { getPeople, addPerson, removePerson, setClipPeople } from '../store/PeopleStore'
import { trimVideo } from '../services/TrimService'
import { compressVideo, cancelCompress, probeVideo } from '../services/CompressService'
import { getFilmstrip } from '../services/FilmstripService'
import { shareMedia } from '../services/ShareService'
import { deleteFile, renameFile, showInExplorer, setPendingDeletes } from '../services/FileService'
import { detectAvailableEncoders } from '../services/FFmpegService'
import { tunnelService } from '../services/TunnelService'
import { updateService } from '../services/UpdateService'
import type { ShareRequest, Settings, CompressRequest } from '../../shared/types'

export function registerIpcHandlers() {
  // Media operations
  ipcMain.handle('clipit:media:get-games', async () => {
    return getGames()
  })

  ipcMain.handle('clipit:media:get-clips', async (_, args: { game?: string }) => {
    return getClips(args.game)
  })

  ipcMain.handle('clipit:media:get-clip-info', async (_, args: { path: string }) => {
    return getClipInfo(args.path)
  })

  // Trim operations
  ipcMain.handle('clipit:trim:execute', async (_, args: { path: string; start: number; end: number; saveAsCopy?: boolean }) => {
    return trimVideo(args.path, args.start, args.end, args.saveAsCopy || false)
  })

  // Friends tagged on clips
  ipcMain.handle('clipit:people:list', async () => getPeople())
  ipcMain.handle('clipit:people:add', async (_, args: { name: string }) => addPerson(args.name))
  ipcMain.handle('clipit:people:remove', async (_, args: { id: string }) => removePerson(args.id))
  ipcMain.handle('clipit:people:set-clip', async (_, args: { path: string; ids: string[] }) => {
    setClipPeople(args.path, args.ids)
    return getPeople()
  })

  ipcMain.handle('clipit:media:filmstrip', async (_, args: { path: string; count: number }) => {
    return getFilmstrip(args.path, args.count)
  })

  // Compress operations
  ipcMain.handle('clipit:compress:probe', async (_, args: { path: string }) => {
    return probeVideo(args.path)
  })

  ipcMain.handle('clipit:compress:execute', async (event, request: CompressRequest) => {
    return compressVideo(request, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('compress-progress', progress)
      }
    })
  })

  ipcMain.handle('clipit:compress:cancel', async () => {
    cancelCompress()
  })

  // Share operations
  ipcMain.handle('clipit:share:execute', async (_, request: ShareRequest) => {
    return shareMedia(request)
  })

  // File operations
  ipcMain.handle('clipit:file:delete', async (_, args: { path: string }) => {
    return deleteFile(args.path)
  })

  ipcMain.on('clipit:file:set-pending-deletes', (_, paths: string[]) => {
    setPendingDeletes(Array.isArray(paths) ? paths.filter(p => typeof p === 'string') : [])
  })

  ipcMain.handle('clipit:file:rename', async (_, args: { path: string; newName: string }) => {
    return renameFile(args.path, args.newName)
  })

  ipcMain.handle('clipit:file:show-in-explorer', async (_, args: { path: string }) => {
    return showInExplorer(args.path)
  })

  // Settings operations
  ipcMain.handle('clipit:settings:get', async () => {
    return settingsStore.getAll()
  })

  ipcMain.handle('clipit:settings:set', async (_, settings: Partial<Settings>) => {
    settingsStore.setAll(settings)
    watchRecordings()
    return { success: true }
  })

  ipcMain.handle('clipit:settings:pick-directory', async (_, args: { title: string }) => {
    const result = await dialog.showOpenDialog({
      title: args.title,
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  // GPU detection
  ipcMain.handle('clipit:gpu:detect-encoders', async () => {
    return detectAvailableEncoders()
  })

  // Utility operations
  ipcMain.handle('clipit:util:copy-clipboard', async (_, args: { text: string }) => {
    clipboard.writeText(args.text)
  })

  ipcMain.handle('clipit:util:open-external', async (_, args: { url: string }) => {
    // Validate URL to prevent exploitation
    try {
      const url = new URL(args.url)
      // Only allow http and https protocols for security
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Invalid protocol. Only HTTP and HTTPS URLs are allowed.')
      }
      await shell.openExternal(args.url)
    } catch (error) {
      throw error
    }
  })

  // App state
  ipcMain.handle('clipit:app:is-configured', async () => {
    return settingsStore.isConfigured()
  })

  ipcMain.handle('clipit:app:get-version', () => {
    return app.getVersion()
  })

  // Tunnel operations
  ipcMain.handle('clipit:tunnel:start', async () => {
    return tunnelService.start()
  })

  ipcMain.handle('clipit:tunnel:stop', async () => {
    await tunnelService.stop()
    return { success: true }
  })

  ipcMain.handle('clipit:tunnel:get-info', async () => {
    return tunnelService.getInfo()
  })

  // Update operations
  ipcMain.handle('clipit:update:check', async () => {
    updateService.checkForUpdatesManual()
  })

  ipcMain.handle('clipit:update:download', async () => {
    updateService.downloadUpdate()
  })

  ipcMain.handle('clipit:update:install', async () => {
    updateService.installUpdate()
  })
}
