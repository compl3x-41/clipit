import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'

// Text recognition with the OCR engine built into Windows 10 and 11, through PowerShell,
// so nothing extra has to be installed. One PowerShell process reads image paths from stdin
// and answers each with a line of JSON, which saves starting PowerShell per image.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Foundation.IAsyncOperation\`1, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($engine -eq $null) {
  [Console]::Out.WriteLine('{"ready":false,"error":"Windows has no OCR language installed"}')
} else {
  [Console]::Out.WriteLine('{"ready":true}')
}
[Console]::Out.Flush()
while (($path = [Console]::In.ReadLine()) -ne $null) {
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $stream.Dispose()
    $lines = @($result.Lines | ForEach-Object { $_.Text })
    [Console]::Out.WriteLine((@{ lines = $lines } | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine((@{ lines = @(); error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
  [Console]::Out.Flush()
}
`

interface OcrAnswer {
  lines: string[]
  error?: string
}

export class WindowsOcr {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private waiting: ((answer: OcrAnswer) => void)[] = []
  private ready: Promise<void> | null = null

  private start(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise((resolve, reject) => {
      if (process.platform !== 'win32') {
        reject(new Error('Overlay scanning uses Windows OCR, so it only works on Windows'))
        return
      }
      const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
      const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true })
      this.proc = proc
      let started = false
      let stderr = ''
      proc.stderr.on('data', (data) => { stderr += data.toString() })
      proc.stdout.on('data', (data) => {
        this.buffer += data.toString('utf8')
        let newline: number
        while ((newline = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, newline).replace(/^\uFEFF/, '').trim()
          this.buffer = this.buffer.slice(newline + 1)
          if (!line) continue
          let message: any
          try {
            message = JSON.parse(line)
          } catch {
            continue
          }
          if (!started) {
            started = true
            if (message.ready) resolve()
            else reject(new Error(message.error || 'Windows OCR is not available'))
          } else {
            const lines = Array.isArray(message.lines) ? message.lines : message.lines ? [message.lines] : []
            this.waiting.shift()?.({ lines: lines.map(String), error: message.error })
          }
        }
      })
      proc.on('error', (error) => {
        if (!started) reject(error)
      })
      proc.on('exit', () => {
        if (!started) reject(new Error(stderr.trim() || 'Windows OCR stopped unexpectedly'))
        for (const waiter of this.waiting.splice(0)) waiter({ lines: [], error: 'Windows OCR stopped' })
        this.proc = null
        this.ready = null
      })
    })
    return this.ready
  }

  async recognize(imagePath: string): Promise<OcrAnswer> {
    await this.start()
    return new Promise((resolve) => {
      this.waiting.push(resolve)
      this.proc!.stdin.write(imagePath + '\n')
    })
  }

  stop(): void {
    this.proc?.stdin.end()
    this.proc?.kill()
    this.proc = null
    this.ready = null
  }
}
