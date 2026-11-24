import { useEffect, useState } from 'react'
import { addDays } from '../model/dates'
import { LABEL_COLORS, labelInfo, type Plan, type Step, type Task, type TaskDetails, type TaskList } from '../model/types'
import type { Store } from '../useStore'
import type { Backend } from '../data/backend'
import * as I from './Icons'

const MAX_STEPS = 20

interface Props {
  task: Task
  plan?: Plan
  lists: TaskList[]
  backend: Backend
  store: Store
  today: string
  onClose: () => void
}

export function DetailPane({ task, plan, lists, backend, store, today, onClose }: Props) {
  const [details, setDetails] = useState<TaskDetails | null>(null)
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState('')
  const [newStep, setNewStep] = useState('')
  const [showAllLabels, setShowAllLabels] = useState(false)
  const isEmail = task.source === 'email'

  useEffect(() => setTitle(task.title), [task.id, task.title])

  useEffect(() => {
    let live = true
    setDetails(null)
    backend
      .getDetails(task)
      .then((d) => {
        if (!live) return
        setDetails(d)
        setNotes(d.notes)
      })
      .catch(() => live && setDetails({ taskId: task.id, notes: '', steps: [] }))
    return () => {
      live = false
    }
    // Only refetch when a different task is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, backend])

  const saveSteps = async (steps: Step[]) => {
    if (!details) return
    setDetails({ ...details, steps }) // optimistic
    const next = await store.updateDetails(task, details, { steps })
    if (next) setDetails(next)
    else setDetails(details)
  }

  const saveNotes = async () => {
    if (!details || notes === details.notes) return
    const next = await store.updateDetails(task, details, { notes })
    if (next) setDetails(next)
  }

  const commitTitle = () => {
    const t = title.trim()
    if (t && t !== task.title) void store.updateTask(task, { title: t })
    else setTitle(task.title)
  }

  const planLists = lists.filter((l) => l.planId === task.planId)
  const labelKeys = LABEL_COLORS.map((_, i) => `category${i + 1}`)
  const shownLabels = showAllLabels
    ? labelKeys
    : labelKeys.filter((k) => task.labels.includes(k) || plan?.labels[k]?.trim())

  return (
    <aside className="detail glass" aria-label="Task details">
      <div className="detail-scroll">
        <div className="detail-card">
          <div className="detail-title-row">
            <button
              className={'check' + (task.completed ? ' on' : '')}
              onClick={() => store.updateTask(task, { completed: !task.completed })}
              aria-label={task.completed ? 'Mark as not completed' : 'Mark as completed'}
            >
              <svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true">
                <circle cx="10" cy="10" r="8.5" />
                <path d="M6.3 10.3l2.4 2.4 5-5" />
              </svg>
            </button>
            {isEmail ? (
              <div className={'detail-title' + (task.completed ? ' done' : '')}>{task.title}</div>
            ) : (
              <textarea
                className={'detail-title' + (task.completed ? ' done' : '')}
                value={title}
                rows={1}
                onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLTextAreaElement).blur()
                }}
                aria-label="Task title"
              />
            )}
            <button
              className={'star' + (task.important ? ' on' : '')}
              onClick={() => store.updateTask(task, { important: !task.important })}
              aria-label={task.important ? 'Remove importance' : 'Mark as important'}
            >
              <I.Star filled={task.important} size={20} />
            </button>
          </div>

          {!isEmail && (
            <div className="steps">
              {details === null && <div className="muted small">Loading steps…</div>}
              {details?.steps.map((s, i) => (
                <div key={s.id || i} className="step">
                  <button
                    className={'check small' + (s.done ? ' on' : '')}
                    onClick={() => saveSteps(details.steps.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
                    aria-label={s.done ? 'Mark step as not done' : 'Mark step as done'}
                  >
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                      <circle cx="10" cy="10" r="8.5" />
                      <path d="M6.3 10.3l2.4 2.4 5-5" />
                    </svg>
                  </button>
                  <input
                    className={'step-title' + (s.done ? ' done' : '')}
                    defaultValue={s.title}
                    aria-label="Step"
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      if (v && v !== s.title) saveSteps(details.steps.map((x, j) => (j === i ? { ...x, title: v } : x)))
                      else e.target.value = s.title
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                  <button
                    className="icon-btn tiny"
                    onClick={() => saveSteps(details.steps.filter((_, j) => j !== i))}
                    aria-label="Delete step"
                  >
                    <I.Close size={14} />
                  </button>
                </div>
              ))}
              {details && details.steps.length < MAX_STEPS && (
                <div className="step add">
                  <I.Plus size={16} />
                  <input
                    value={newStep}
                    placeholder={details.steps.length ? 'Next step' : 'Add step'}
                    onChange={(e) => setNewStep(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newStep.trim()) {
                        void saveSteps([...details.steps, { id: '', title: newStep.trim(), done: false }])
                        setNewStep('')
                      }
                    }}
                    aria-label="Add step"
                  />
                </div>
              )}
              {details && details.steps.length >= MAX_STEPS && (
                <div className="muted small">Planner allows up to 20 steps per task.</div>
              )}
            </div>
          )}
        </div>

        {!isEmail && (
          <button
            className={'detail-card action' + (task.myDay ? ' on' : '')}
            onClick={() => store.updateTask(task, { myDay: !task.myDay })}
          >
            <I.Sun size={18} />
            <span>{task.myDay ? 'Added to My Day' : 'Add to My Day'}</span>
            {task.myDay && <I.Close size={15} className="end" />}
          </button>
        )}

        {!isEmail && (
          <div className="detail-card">
            <div className="field">
              <I.Calendar size={18} />
              <input
                type="date"
                value={task.dueDate ?? ''}
                onChange={(e) => store.updateTask(task, { dueDate: e.target.value || undefined })}
                aria-label="Due date"
              />
            </div>
            <div className="chips">
              <button className="chip" onClick={() => store.updateTask(task, { dueDate: today })}>Today</button>
              <button className="chip" onClick={() => store.updateTask(task, { dueDate: addDays(today, 1) })}>Tomorrow</button>
              <button className="chip" onClick={() => store.updateTask(task, { dueDate: addDays(today, 7) })}>Next week</button>
              {task.dueDate && (
                <button className="chip ghost" onClick={() => store.updateTask(task, { dueDate: undefined })}>Remove</button>
              )}
            </div>
          </div>
        )}

        {!isEmail && planLists.length > 0 && (
          <div className="detail-card">
            <label className="field">
              <I.Lines size={18} />
              <select
                value={task.listId}
                onChange={(e) => store.updateTask(task, { listId: e.target.value })}
                aria-label="List"
              >
                {planLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {!isEmail && (
          <div className="detail-card">
            <div className="field-head">
              <I.Tag size={18} /> <span>Labels</span>
              <button className="link-btn" onClick={() => setShowAllLabels((v) => !v)}>
                {showAllLabels ? 'Fewer' : 'All colours'}
              </button>
            </div>
            <div className="chips">
              {shownLabels.map((k) => {
                const l = labelInfo(plan, k)
                const on = task.labels.includes(k)
                return (
                  <button
                    key={k}
                    className={'chip label' + (on ? ' on' : '')}
                    style={{ ['--c' as string]: l.color }}
                    onClick={() =>
                      store.updateTask(task, {
                        labels: on ? task.labels.filter((x) => x !== k) : [...task.labels, k],
                      })
                    }
                    aria-pressed={on}
                  >
                    <span className="dot" style={{ background: l.color }} />
                    {l.name}
                  </button>
                )
              })}
              {shownLabels.length === 0 && <span className="muted small">No labels yet. Show all colours to pick one.</span>}
            </div>
          </div>
        )}

        {isEmail ? (
          <div className="detail-card">
            <p className="muted small">
              {task.from ? `From ${task.from}. ` : ''}Completing this task marks the email's flag as complete in Outlook.
            </p>
            {task.webLink && (
              <a className="btn" href={task.webLink} target="_blank" rel="noreferrer">
                <I.Mail size={16} /> Open in Outlook
              </a>
            )}
          </div>
        ) : (
          <div className="detail-card">
            <textarea
              className="notes"
              placeholder="Add note"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              disabled={details === null}
              rows={5}
              aria-label="Notes"
            />
          </div>
        )}
      </div>

      <div className="detail-foot">
        <button className="icon-btn" onClick={onClose} aria-label="Close details" title="Close">
          <I.Chevron dir="right" />
        </button>
        <span className="muted small">
          {task.completed && task.completedAt
            ? `Completed ${new Date(task.completedAt).toLocaleDateString()}`
            : `Created ${new Date(task.createdAt).toLocaleDateString()}`}
        </span>
        <button
          className="icon-btn danger"
          onClick={() => {
            const what = isEmail ? 'Remove the flag from this email?' : `Delete "${task.title}"? This can't be undone.`
            if (confirm(what)) {
              void store.deleteTask(task)
              onClose()
            }
          }}
          aria-label={isEmail ? 'Unflag email' : 'Delete task'}
          title={isEmail ? 'Unflag' : 'Delete'}
        >
          <I.Trash />
        </button>
      </div>
    </aside>
  )
}
