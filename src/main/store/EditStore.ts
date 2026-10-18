import Store from 'electron-store'

// Remembers which clips Clipit has trimmed or compressed, so untouched ones can be highlighted
interface EditSchema {
  editedPaths: string[]
}

const store = new Store<EditSchema>({
  name: 'clipit-edits',
  defaults: { editedPaths: [] }
})

// Windows paths are case-insensitive
function key(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath
}

let cache: Set<string> | null = null

function load(): Set<string> {
  if (!cache) cache = new Set(store.get('editedPaths'))
  return cache
}

function save(): void {
  store.set('editedPaths', [...load()])
}

export function isEdited(filePath: string): boolean {
  return load().has(key(filePath))
}

export function markEdited(filePath: string): void {
  load().add(key(filePath))
  save()
}

export function moveEdited(oldPath: string, newPath: string): void {
  const paths = load()
  if (paths.delete(key(oldPath))) {
    paths.add(key(newPath))
    save()
  }
}

export function forgetEdited(filePath: string): void {
  if (load().delete(key(filePath))) save()
}
