// ShadowPlay's own names, e.g. "WARDOGS 2026.10.16 - 02.16.04.26.DVR.mp4".
// A clip whose name no longer looks like this has been renamed.
const RAW_RECORDING_NAME = /^.+?\s(?:-\s)?\d{4}\.\d{2}\.\d{2}\s-\s\d{2}\.\d{2}\.\d{2}(?:\.\d{2})?(?:\.DVR)?\.[^.]+$/i

export function isRawRecordingName(name: string): boolean {
  return RAW_RECORDING_NAME.test(name)
}

export function splitFileName(name: string): [string, string] {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}
