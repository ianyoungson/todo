import { friendlyDue } from '../model/dates'
import { labelInfo, type Plan, type Task, type TaskList } from '../model/types'
import * as I from './Icons'

interface Props {
  task: Task
  plan?: Plan
  list?: TaskList
  showPlan: boolean
  today: string
  selected: boolean
  onToggle: () => void
  onStar: () => void
  onOpen: () => void
}

export function TaskRow({ task, plan, list, showPlan, today, selected, onToggle, onStar, onOpen }: Props) {
  const meta: JSX.Element[] = []
  if (task.source === 'email') {
    meta.push(
      <span key="src" className="meta-item">
        <I.Mail size={13} /> {task.from ? `Flagged email · ${task.from}` : 'Flagged email'}
      </span>,
    )
  } else {
    if (task.myDay) meta.push(<span key="md" className="meta-item"><I.Sun size={13} /> My Day</span>)
    const where = [list?.name, showPlan ? plan?.title : undefined].filter(Boolean).join(' · ')
    if (where) meta.push(<span key="where" className="meta-item">{where}</span>)
  }
  if (task.stepCount > 0)
    meta.push(<span key="steps" className="meta-item">{task.stepsDone} of {task.stepCount}</span>)
  if (task.dueDate) {
    const overdue = !task.completed && task.dueDate < today
    meta.push(
      <span key="due" className={'meta-item' + (overdue ? ' overdue' : task.dueDate === today ? ' due-today' : '')}>
        <I.Calendar size={13} /> {friendlyDue(task.dueDate, today)}
      </span>,
    )
  }
  if (task.hasNotes) meta.push(<span key="note" className="meta-item" title="Has notes"><I.Note size={13} /></span>)
  for (const k of task.labels) {
    const l = labelInfo(plan, k)
    meta.push(
      <span key={k} className="meta-item label">
        <span className="dot" style={{ background: l.color }} />
        {l.name}
      </span>,
    )
  }

  return (
    <div
      className={'task-row glass' + (task.completed ? ' done' : '') + (selected ? ' selected' : '')}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
    >
      <button
        className={'check' + (task.completed ? ' on' : '')}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        aria-label={task.completed ? 'Mark as not completed' : 'Mark as completed'}
        aria-pressed={task.completed}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <circle cx="10" cy="10" r="8.5" />
          <path d="M6.3 10.3l2.4 2.4 5-5" />
        </svg>
      </button>
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        {meta.length > 0 && <div className="task-meta">{meta}</div>}
      </div>
      <button
        className={'star' + (task.important ? ' on' : '')}
        onClick={(e) => {
          e.stopPropagation()
          onStar()
        }}
        aria-label={task.important ? 'Remove importance' : 'Mark as important'}
        aria-pressed={task.important}
      >
        <I.Star filled={task.important} size={19} />
      </button>
    </div>
  )
}
