import Store from 'electron-store'

// Remembers which clips Clipit has trimmed or compressed, so untouched ones can be highlighted
interface EditSchema {
  editedPaths: string[]
  compressedPaths: string[]
}

const store = new Store<EditSchema>({
  name: 'clipit-edits',
  defaults: { editedPaths: [], compressedPaths: [] }
})

// Windows paths are case-insensitive
function key(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath
}

const cache: Partial<Record<keyof EditSchema, Set<string>>> = {}

function load(name: keyof EditSchema): Set<string> {
  if (!cache[name]) cache[name] = new Set(store.get(name))
  return cache[name]!
}

function save(name: keyof EditSchema): void {
  store.set(name, [...load(name)])
}

export function isEdited(filePath: string): boolean {
  return load('editedPaths').has(key(filePath))
}

export function isCompressed(filePath: string): boolean {
  return load('compressedPaths').has(key(filePath))
}

export function markEdited(filePath: string): void {
  load('editedPaths').add(key(filePath))
  save('editedPaths')
}

export function markCompressed(filePath: string): void {
  markEdited(filePath)
  load('compressedPaths').add(key(filePath))
  save('compressedPaths')
}

export function moveEdited(oldPath: string, newPath: string): void {
  for (const name of ['editedPaths', 'compressedPaths'] as const) {
    const paths = load(name)
    if (paths.delete(key(oldPath))) {
      paths.add(key(newPath))
      save(name)
    }
  }
}

export function forgetEdited(filePath: string): void {
  for (const name of ['editedPaths', 'compressedPaths'] as const) {
    if (load(name).delete(key(filePath))) save(name)
  }
}
