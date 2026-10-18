import { Loader2, X, Clock, ScanText } from 'lucide-react'
import { useScanProgress } from '../scanState'
import { useCompressQueue, cancelCompressJob } from '../compressQueue'

export default function StatusBar() {
  const jobs = useCompressQueue()
  const scan = useScanProgress()
  const scanning = !!scan?.running
  if (jobs.length === 0 && !scanning) return null

  const running = jobs.find(job => job.status === 'running')
  const queued = jobs.filter(job => job.status === 'queued')

  return (
    <div className="status-bar">
      {scan && scanning && (
        <div className="status-job">
          <ScanText size={14} className="compress-spin-slow" />
          <span className="status-job-label">{scan.mode === 'test' ? 'Test scan' : 'Finding friends'}</span>
          <span className="status-job-name" title={scan.current}>{scan.current}</span>
          <div className="compress-progress-bar status-job-bar">
            <div className="compress-progress-fill" style={{ width: `${Math.round((scan.done / Math.max(1, scan.total)) * 100)}%` }} />
          </div>
          <span className="status-job-percent">{scan.done}/{scan.total} · {scan.clipsTagged} tagged</span>
          <button className="status-job-cancel" onClick={() => window.clipit.cancelScan()} title="Stop scanning">
            <X size={14} />
          </button>
        </div>
      )}
      {running && (
        <div className="status-job">
          <Loader2 size={14} className="compress-spin" />
          <span className="status-job-label">Compressing</span>
          <span className="status-job-name" title={running.clip.path}>{running.clip.name}</span>
          <div className="compress-progress-bar status-job-bar">
            <div className="compress-progress-fill" style={{ width: `${running.percent}%` }} />
          </div>
          <span className="status-job-percent">{running.percent}%</span>
          <button className="status-job-cancel" onClick={() => cancelCompressJob(running.id)} title="Stop compressing">
            <X size={14} />
          </button>
        </div>
      )}
      {queued.map(job => (
        <div className="status-job status-job-queued" key={job.id}>
          <Clock size={14} />
          <span className="status-job-label">Queued</span>
          <span className="status-job-name" title={job.clip.path}>{job.clip.name}</span>
          <button className="status-job-cancel" onClick={() => cancelCompressJob(job.id)} title="Remove from queue">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
