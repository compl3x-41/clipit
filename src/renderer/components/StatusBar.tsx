import { Loader2, X, Clock } from 'lucide-react'
import { useCompressQueue, cancelCompressJob } from '../compressQueue'

export default function StatusBar() {
  const jobs = useCompressQueue()
  if (jobs.length === 0) return null

  const running = jobs.find(job => job.status === 'running')
  const queued = jobs.filter(job => job.status === 'queued')

  return (
    <div className="status-bar">
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
