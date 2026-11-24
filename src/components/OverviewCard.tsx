import { useMemo, useState } from 'react'
import { buildOverview, suggestions } from '../model/overview'
import type { Task } from '../model/types'
import * as I from './Icons'

interface Props {
  tasks: Task[]
  today: string
  onOpen: (t: Task) => void
  onGoMyTasks: () => void
  onRefresh: () => void
}

export function OverviewCard({ tasks, today, onOpen, onGoMyTasks, onRefresh }: Props) {
  const [spinning, setSpinning] = useState(false)
  const o = useMemo(() => buildOverview(tasks, today), [tasks, today])
  return (
    <section className="overview glass" aria-label="Overview">
      <div className="overview-head">
        <I.Sparkle size={16} />
        <strong>Overview</strong>
        <span className="muted">
          {o.taskCount} {o.taskCount === 1 ? 'task' : 'tasks'} · {o.emailCount} {o.emailCount === 1 ? 'email' : 'emails'}
        </span>
        <span className="spacer" />
        <button className="link-btn" onClick={onGoMyTasks}>
          My tasks <I.Chevron size={13} />
        </button>
        <button
          className={'icon-btn tiny' + (spinning ? ' spin' : '')}
          onClick={async () => {
            setSpinning(true)
            await onRefresh()
            setSpinning(false)
          }}
          aria-label="Refresh"
          title="Refresh"
        >
          <I.Refresh size={15} />
        </button>
      </div>
      <h3>Today</h3>
      <p>{o.summary}</p>
      {o.picks.length > 0 && (
        <div className="picks">
          {o.picks.map((p, i) => (
            <button key={p.task.id} className="pick" onClick={() => onOpen(p.task)}>
              <div className="pick-title">
                <span className="pick-num">{i + 1}</span>
                {p.task.title}
              </div>
              <div className="pick-reason">{p.reason}</div>
            </button>
          ))}
        </div>
      )}
      <div className="overview-foot muted small">Generated on this device from your tasks and flagged emails.</div>
    </section>
  )
}

interface SuggestProps {
  tasks: Task[]
  today: string
  onAdd: (t: Task) => void
  onClose: () => void
}

export function SuggestionsPanel({ tasks, today, onAdd, onClose }: SuggestProps) {
  const items = suggestions(tasks, today)
  return (
    <div className="popover glass suggestions" role="dialog" aria-label="Suggestions">
      <div className="popover-head">
        <strong>Suggestions</strong>
        <button className="icon-btn tiny" onClick={onClose} aria-label="Close">
          <I.Close size={14} />
        </button>
      </div>
      {items.length === 0 && <p className="muted small">Nothing to suggest: no overdue, due-soon or important tasks outside My Day.</p>}
      {items.map(({ task, why }) => (
        <div key={task.id} className="suggestion">
          <div>
            <div className="sg-title">{task.title}</div>
            <div className="muted small">{why}</div>
          </div>
          <button className="icon-btn" onClick={() => onAdd(task)} aria-label={`Add ${task.title} to My Day`} title="Add to My Day">
            <I.Plus size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}
