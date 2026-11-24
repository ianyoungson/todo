import { useState } from 'react'
import type { Mode, Plan, SmartListId, Task, TaskList, ViewRef } from '../model/types'
import { openCount, SMART_LISTS } from '../model/views'
import * as I from './Icons'

const SMART_ICONS: Record<SmartListId, (p: { size?: number }) => JSX.Element> = {
  myday: I.Sun,
  mytasks: I.ListCheck,
  important: I.Star,
  planned: I.Calendar,
  all: I.Infinity,
  completed: I.CheckCircle,
  flagged: I.Flag,
}

interface Props {
  title: string
  mode: Mode
  onMode: (m: Mode) => void
  view: ViewRef
  onView: (v: ViewRef) => void
  search: string
  onSearch: (s: string) => void
  plans: Plan[]
  lists: TaskList[]
  tasks: Task[]
  onNewList: (name: string) => void
  onSettings: () => void
  onCollapse: () => void
}

function same(a: ViewRef, b: ViewRef) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function Sidebar(p: Props) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const personal = p.plans.find((x) => x.personal)
  const others = p.mode === 'full' ? p.plans.filter((x) => !x.personal) : []
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const item = (v: ViewRef, label: string, icon: JSX.Element, key: string) => {
    const count = openCount(p.tasks, v)
    const active = same(v, p.view) && !p.search
    return (
      <button
        key={key}
        className={'nav-item' + (active ? ' active' : '')}
        onClick={() => {
          p.onSearch('')
          p.onView(v)
        }}
        aria-current={active ? 'page' : undefined}
      >
        <span className="nav-icon">{icon}</span>
        <span className="nav-label">{label}</span>
        {count > 0 && <span className="nav-count">{count}</span>}
      </button>
    )
  }

  const submit = () => {
    const n = name.trim()
    if (n) p.onNewList(n)
    setName('')
    setAdding(false)
  }

  return (
    <aside className="sidebar glass">
      <div className="sidebar-head">
        <span className="brand-logo">
          <I.Logo />
        </span>
        <div className="brand-text">
          <div className="brand-title">{p.title}</div>
          <div className="brand-sub">ToDo 2.0</div>
        </div>
        <button className="icon-btn" onClick={p.onCollapse} aria-label="Hide sidebar" title="Hide sidebar">
          <I.Sidebar />
        </button>
      </div>

      <div className="segmented" role="tablist" aria-label="Mode">
        {(['simple', 'full'] as Mode[]).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={p.mode === m}
            className={p.mode === m ? 'on' : ''}
            onClick={() => p.onMode(m)}
            title={m === 'simple' ? 'Only your own to-do list' : 'Show every plan you are in'}
          >
            {m === 'simple' ? 'Simple' : 'Full'}
          </button>
        ))}
      </div>

      <label className="search">
        <I.Search size={15} />
        <input
          value={p.search}
          onChange={(e) => p.onSearch(e.target.value)}
          placeholder="Search or #tag"
          aria-label="Search tasks"
        />
        {p.search && (
          <button className="icon-btn tiny" onClick={() => p.onSearch('')} aria-label="Clear search">
            <I.Close size={14} />
          </button>
        )}
      </label>

      <nav className="nav">
        {SMART_LISTS.map((s) => {
          const Icon = SMART_ICONS[s.id]
          return item({ kind: 'smart', id: s.id }, s.name, <Icon size={18} />, s.id)
        })}

        <div className="nav-divider" />
        <div className="nav-section">My lists</div>
        {personal &&
          p.lists
            .filter((l) => l.planId === personal.id)
            .map((l) => item({ kind: 'list', planId: l.planId, listId: l.id }, l.name, <I.Lines size={18} />, l.id))}

        {adding && (
          <div className="nav-item editing">
            <span className="nav-icon">
              <I.Lines size={18} />
            </span>
            <input
              autoFocus
              value={name}
              placeholder="Untitled list"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') setAdding(false)
              }}
              onBlur={submit}
            />
          </div>
        )}

        {others.length > 0 && (
          <>
            <div className="nav-divider" />
            <div className="nav-section">Plans</div>
            {others.map((plan) => {
              const isOpen = open[plan.id]
              return (
                <div key={plan.id}>
                  <div className="plan-row">
                    <button
                      className="icon-btn tiny"
                      onClick={() => setOpen((o) => ({ ...o, [plan.id]: !isOpen }))}
                      aria-label={isOpen ? 'Collapse' : 'Expand'}
                      aria-expanded={!!isOpen}
                    >
                      <I.Chevron size={14} dir={isOpen ? 'down' : 'right'} />
                    </button>
                    {item({ kind: 'plan', planId: plan.id }, plan.title, <I.Board size={18} />, plan.id)}
                  </div>
                  {isOpen && (
                    <div className="plan-lists">
                      {p.lists
                        .filter((l) => l.planId === plan.id)
                        .map((l) =>
                          item({ kind: 'list', planId: plan.id, listId: l.id }, l.name, <I.Lines size={16} />, l.id),
                        )}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </nav>

      <div className="sidebar-foot">
        <button className="new-list" onClick={() => setAdding(true)} disabled={!personal}>
          <I.Plus size={16} /> New list
        </button>
        <button className="icon-btn" onClick={p.onSettings} aria-label="Settings" title="Settings">
          <I.Gear size={17} />
        </button>
      </div>
    </aside>
  )
}
