import fs from 'fs'

/**
 * Read an MP4/MOV's length from its header (the mvhd box) without running ffprobe,
 * which would be too slow to do for every clip in a folder. Null when it can't be read.
 */
export function readMp4Duration(filePath: string): number | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(filePath, 'r')
    const fileSize = fs.fstatSync(fd).size
    const header = Buffer.alloc(16)

    // Walk boxes between start and end looking for `type`, returning where its contents begin and end
    const findBox = (start: number, end: number, type: string): [number, number] | null => {
      let offset = start
      while (offset + 8 <= end) {
        fs.readSync(fd!, header, 0, 16, offset)
        let size = header.readUInt32BE(0)
        const boxType = header.toString('latin1', 4, 8)
        let headerSize = 8
        if (size === 1) {
          size = Number(header.readBigUInt64BE(8))
          headerSize = 16
        } else if (size === 0) {
          size = end - offset
        }
        if (size < headerSize) return null
        if (boxType === type) return [offset + headerSize, offset + size]
        offset += size
      }
      return null
    }

    const moov = findBox(0, fileSize, 'moov')
    if (!moov) return null
    const mvhd = findBox(moov[0], moov[1], 'mvhd')
    if (!mvhd) return null

    const body = Buffer.alloc(32)
    fs.readSync(fd, body, 0, 32, mvhd[0])
    const version = body.readUInt8(0)
    const timescale = version === 1 ? body.readUInt32BE(20) : body.readUInt32BE(12)
    const duration = version === 1 ? Number(body.readBigUInt64BE(24)) : body.readUInt32BE(16)
    return timescale > 0 && duration > 0 ? duration / timescale : null
  } catch {
    return null
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}
