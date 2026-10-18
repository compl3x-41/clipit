import type { Person } from './types'

// Reading names out of the Discord overlay, and matching them to friends

const BADGE_WORDS = new Set(['live', 'mute', 'muted', 'deafened', 'streaming'])

/**
 * Lowercase letters and digits only, so "Christian_Separ" and "christiansepar" compare equal
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Turn the OCR lines from one overlay crop into names: drop badges like LIVE,
 * avatar specks read as stray letters, and anything too short to be a name.
 */
export function parseOverlayLines(lines: string[]): string[] {
  const names: string[] = []
  for (const line of lines) {
    // A LIVE badge right after a name can be read as part of it, e.g. "ChristianSepar!!VE"
    let tokens = line
      .replace(/(?<=[\p{Ll}\p{N}_])(?:LIVE|[!|Il1]{1,2}VE)\b/gu, ' ')
      .replace(/[^\p{L}\p{N}_.\-\s]/gu, ' ')
      .split(/\s+/)
      .filter(token => token && !BADGE_WORDS.has(token.toLowerCase()))
    // The avatar to the left of a name often reads as one or two junk characters
    while (tokens.length > 1 && tokens[0].length <= 2) tokens = tokens.slice(1)
    const name = tokens.join(' ').replace(/^[._\-]+|[._\-]+$/g, '').trim()
    const letters = normalizeName(name)
    if (letters.length < 3 || /^\d+$/.test(letters)) continue
    names.push(name)
  }
  return names
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]
}

/**
 * Close enough to be the same name, allowing for a misread letter or two
 */
export function namesMatch(a: string, b: string): boolean {
  const x = normalizeName(a)
  const y = normalizeName(b)
  if (!x || !y) return false
  if (x === y) return true
  // Short names are too easy to confuse ("Chris" and "Cheis"), so they must match exactly
  const longest = Math.max(x.length, y.length)
  if (longest < 6) return false
  return 1 - editDistance(x, y) / longest >= 0.8
}

function knownNames(person: Person): string[] {
  return [person.name, ...(person.aliases ?? [])]
}

/**
 * The friend this name belongs to: an exact match anywhere wins over a near miss
 */
export function findPerson(people: Person[], name: string): Person | undefined {
  const target = normalizeName(name)
  return people.find(person => knownNames(person).some(known => normalizeName(known) === target)) ??
    people.find(person => knownNames(person).some(known => namesMatch(known, name)))
}
