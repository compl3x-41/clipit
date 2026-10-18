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
    const name = cleanName(tokens.join(' '))
    const letters = normalizeName(name)
    if (letters.length < 3 || /^\d+$/.test(letters)) continue
    names.push(name)
  }
  return names
}

// A separate LIVE badge often reads as "uve", "IIVE", "LME" or "OLIVE"
function looksLikeBadge(token: string): boolean {
  const letters = normalizeName(token).replace(/\d/g, '')
  if (token.length === 1) return true
  if (letters.length < 2 || letters.length > 6) return false
  const distance = editDistance(letters, 'live')
  if (distance <= 1) return true
  if (letters.length > 5) return false
  return (letters.includes('v') && distance <= 3) || (letters.startsWith('l') && distance <= 2)
}

/**
 * Tidy one name: drop a misread LIVE badge or stray letter after it, and edge punctuation.
 * Safe to run again on a name that's already clean.
 */
export function cleanName(name: string): string {
  const tokens = name.trim().split(/\s+/)
  while (tokens.length > 1 && looksLikeBadge(tokens[tokens.length - 1])) tokens.pop()
  return tokens.join(' ').replace(/^[._\-]+|[._\-]+$/g, '').trim()
}

/**
 * Whether text from the overlay corner looks like a Discord name rather than game HUD
 * or in-game chat ("TEAM someone get in the zone", "OVERALL", "212 m", "FPS 116").
 * Only used to decide which unknown names to suggest; matching friends doesn't use it.
 */
export function isLikelyName(name: string): boolean {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 2 || name.length > 32) return false
  const letters = name.replace(/[^\p{L}]/gu, '')
  if (letters.length < 3) return false
  // HUD labels are all capitals
  if (letters === letters.toUpperCase()) return false
  // Distances, frame rates, clocks and sizes
  if (/\d\s*(m|km|fps|hz|mhz|ghz|gb|mb|ms)\b/i.test(name) || /\bfps\b/i.test(name)) return false
  // Smeared text such as "LLLLL" or "jjj ij"
  if (/(.)\1{2,}/i.test(name.replace(/\s/g, ''))) return false
  return true
}

/**
 * normalizeName, with letters OCR mixes up folded together: "comp13x", "compi3x" and "compl3x" agree
 */
export function looseName(name: string): string {
  return normalizeName(name).replace(/[1i|!]/g, 'l').replace(/[0ø]/g, 'o')
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
  if (sameName(a, b)) return true
  const x = looseName(a)
  const y = looseName(b)
  // Short names are too easy to confuse ("Chris" and "Cheis"), so they must match exactly
  const longest = Math.max(x.length, y.length)
  if (longest < 6) return false
  return 1 - editDistance(x, y) / longest >= 0.8
}

/**
 * The same name apart from case, spacing and letters OCR mixes up ("comp13x" for "compl3x").
 * Short names only fold when they're 5 letters or more, so "All" isn't read as "Ali".
 */
export function sameName(a: string, b: string): boolean {
  const x = normalizeName(a)
  const y = normalizeName(b)
  if (!x || !y) return false
  if (x === y) return true
  return x.length >= 5 && looseName(a) === looseName(b)
}

function knownNames(person: Person): string[] {
  return [person.name, ...(person.aliases ?? [])]
}

/**
 * The friend this name belongs to: an exact match anywhere wins over a near miss
 */
export function findPerson(people: Person[], rawName: string): Person | undefined {
  const name = cleanName(rawName)
  return people.find(person => knownNames(person).some(known => sameName(known, name))) ??
    people.find(person => knownNames(person).some(known => namesMatch(known, name)))
}
