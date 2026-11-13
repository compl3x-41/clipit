import { useState, useEffect, useRef } from 'react'
import { Layers, ImagePlus, Film, RotateCcw, FolderOpen } from 'lucide-react'
import { ALL_CLIPS } from '../../shared/types'
import type { Game } from '../../shared/types'

export type GameLayout = 'grid' | 'list'

const UNCATEGORIZED = 'Uncategorized'

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

function folderStats(game: { count: number; sizeBytes?: number }): string {
  if (game.count === 0) return 'Empty'
  return `${game.count} ${game.count === 1 ? 'clip' : 'clips'} · ${formatBytes(game.sizeBytes ?? 0)}`
}

// "Today", "3d ago", "2w ago" for when a clip was last added
function timeAgo(ms?: number): string | null {
  if (!ms) return null
  const days = Math.floor((Date.now() - ms) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

// A steady colour per game, for the tile shown before (or instead of) cover art
function hueFor(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) | 0
  return Math.abs(hash) % 360
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * Cover art for a game folder: Steam art or a picked image, else the newest clip,
 * else a coloured tile with the game's initials
 */
export function GameCover({ game, version, className = '' }: { game: Game; version: number; className?: string }) {
  // Uncategorized only has art if the user picked some, so it soon falls through to its newest clip
  const [stage, setStage] = useState<'cover' | 'clip' | 'none'>('cover')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setStage('cover')
    setLoaded(false)
  }, [game.name, game.latestPath, version])

  const src = stage === 'cover'
    ? window.clipit.getCoverUrl(game.name, version)
    : stage === 'clip' && game.latestPath
      ? window.clipit.getThumbnailUrl(game.latestPath)
      : null

  const handleError = () => {
    setLoaded(false)
    setStage(stage === 'cover' && game.latestPath ? 'clip' : 'none')
  }

  return (
    <div className={`game-cover ${className}`} style={{ '--cover-hue': hueFor(game.name) } as React.CSSProperties}>
      <span className="game-cover-initials">{game.name === UNCATEGORIZED ? <FolderOpen size={22} /> : initials(game.name)}</span>
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          className={`game-cover-img ${loaded ? 'loaded' : ''} ${stage === 'clip' ? 'from-clip' : ''}`}
          onLoad={(e) => {
            // The thumbnail protocol answers with an empty image when thumbnails are off
            if ((e.target as HTMLImageElement).naturalWidth > 0) setLoaded(true)
            else handleError()
          }}
          onError={handleError}
        />
      )}
    </div>
  )
}

interface GameFoldersProps {
  games: Game[]
  layout: GameLayout
  totalClips: number
  totalBytes: number
  coverVersion: (game: string) => number
  onOpen: (game: string) => void
  onCoverChanged: (game: string) => void
  onError: (message: string) => void
}

export default function GameFolders({ games, layout, totalClips, totalBytes, coverVersion, onOpen, onCoverChanged, onError }: GameFoldersProps) {
  const [menu, setMenu] = useState<{ game: Game; x: number; y: number; choice: 'auto' | 'custom' | 'clip' } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('contextmenu', close, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // Keep the menu on screen near the bottom and right edges
  useEffect(() => {
    const el = menuRef.current
    if (!menu || !el) return
    const rect = el.getBoundingClientRect()
    const x = Math.min(menu.x, window.innerWidth - rect.width - 8)
    const y = Math.min(menu.y, window.innerHeight - rect.height - 8)
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y })
  }, [menu])

  const openMenu = async (e: React.MouseEvent, game: Game) => {
    e.preventDefault()
    const x = e.clientX
    const y = e.clientY
    const choice = await window.clipit.getCoverChoice(game.name).catch(() => 'auto' as const)
    setMenu({ game, x, y, choice })
  }

  const runMenuAction = async (action: () => Promise<void>) => {
    setMenu(null)
    try {
      await action()
    } catch (error) {
      onError(String(error))
    }
  }

  const chooseCover = (game: Game) => runMenuAction(async () => {
    const result = await window.clipit.chooseCover(game.name)
    if (result.success) onCoverChanged(game.name)
    else if (!result.cancelled && result.error) onError(result.error)
  })

  const useClip = (game: Game) => runMenuAction(async () => {
    await window.clipit.useClipAsCover(game.name)
    onCoverChanged(game.name)
  })

  const resetCover = (game: Game) => runMenuAction(async () => {
    await window.clipit.resetCover(game.name)
    onCoverChanged(game.name)
  })

  const openFolder = (game: Game) => runMenuAction(async () => {
    const result = await window.clipit.openGameFolder(game.name)
    if (!result.success) onError(result.error || 'Could not open the folder')
  })

  const cardProps = (game: Game) => ({
    role: 'button',
    tabIndex: 0,
    title: game.name,
    onClick: () => onOpen(game.name),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onOpen(game.name)
      }
    },
    onContextMenu: (e: React.MouseEvent) => openMenu(e, game)
  })

  // Covers of the most recent games, layered behind the All clips banner
  const mosaic = games.filter(g => g.count > 0 && g.name !== UNCATEGORIZED).slice(0, 4)

  return (
    <div className={`game-folders game-folders-${layout}`}>
      {games.length > 1 && (
        <div
          className="game-all"
          role="button"
          tabIndex={0}
          onClick={() => onOpen(ALL_CLIPS)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onOpen(ALL_CLIPS)
            }
          }}
        >
          <div className="game-all-mosaic" aria-hidden>
            {mosaic.map(game => (
              <GameCover key={game.name} game={game} version={coverVersion(game.name)} />
            ))}
          </div>
          <div className="game-all-icon">
            <Layers size={20} />
          </div>
          <div className="game-all-text">
            <div className="game-all-title">All clips</div>
            <div className="game-all-stats">{folderStats({ count: totalClips, sizeBytes: totalBytes })} · {games.length} games</div>
          </div>
        </div>
      )}

      {games.map(game => {
        const ago = timeAgo(game.latest)
        const isEmpty = game.count === 0
        const isRoot = game.name === UNCATEGORIZED

        return layout === 'grid' ? (
          <div key={game.name} className={`game-card ${isEmpty ? 'is-empty' : ''} ${menu?.game.name === game.name ? 'menu-open' : ''}`} {...cardProps(game)}>
            <GameCover game={game} version={coverVersion(game.name)} className="game-card-cover" />
            <div className="game-card-shade" />
            {(ago || isEmpty) && <span className="game-card-chip">{isEmpty ? 'Empty' : ago}</span>}
            <div className="game-card-info">
              <div className="game-card-name">{game.name}</div>
              <div className="game-card-stats">
                {isRoot ? `Root folder · ${folderStats(game)}` : folderStats(game)}
              </div>
            </div>
          </div>
        ) : (
          <div key={game.name} className={`game-row ${isEmpty ? 'is-empty' : ''} ${menu?.game.name === game.name ? 'menu-open' : ''}`} {...cardProps(game)}>
            <GameCover game={game} version={coverVersion(game.name)} className="game-row-cover" />
            <div className="game-row-info">
              <div className="game-row-name">
                {game.name}
                {isRoot && <span className="game-row-tag">Root folder</span>}
              </div>
              <div className="game-row-stats">{folderStats(game)}</div>
            </div>
            {ago && !isEmpty && <span className="game-row-ago">{ago}</span>}
          </div>
        )
      })}

      {menu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-header">{menu.game.name}</div>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => chooseCover(menu.game)}>
            <ImagePlus size={16} />
            <span>Choose cover image…</span>
          </button>
          {menu.game.name !== UNCATEGORIZED && menu.choice !== 'clip' && menu.game.latestPath && (
            <button className="context-menu-item" onClick={() => useClip(menu.game)}>
              <Film size={16} />
              <span>Use newest clip as cover</span>
            </button>
          )}
          {menu.choice !== 'auto' && (
            <button className="context-menu-item" onClick={() => resetCover(menu.game)}>
              <RotateCcw size={16} />
              <span>Reset cover</span>
            </button>
          )}
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => openFolder(menu.game)}>
            <FolderOpen size={16} />
            <span>Open folder</span>
          </button>
        </div>
      )}
    </div>
  )
}
