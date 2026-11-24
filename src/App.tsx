import { useCallback, useEffect, useMemo, useState } from 'react'
import { Auth, loadAuthConfig, saveAuthConfig, type AuthConfig } from './data/auth'
import type { Backend } from './data/backend'
import { GraphBackend } from './data/graphBackend'
import { GraphClient } from './data/graphClient'
import { LocalBackend, resetLocalData } from './data/localBackend'
import { addDays, longToday, toLocalDate } from './model/dates'
import type { Mode, SortMode, Task, ViewRef } from './model/types'
import { addDefaults, buildView, dayProgress, inScope, viewTitle, visiblePlans } from './model/views'
import { DetailPane } from './components/DetailPane'
import * as I from './components/Icons'
import { OverviewCard, SuggestionsPanel } from './components/OverviewCard'
import { SettingsDialog, ThemeMenu, type Look, type Scheme } from './components/Settings'
import { PlanSetup, Welcome } from './components/Setup'
import { Sidebar } from './components/Sidebar'
import { TaskRow } from './components/TaskRow'
import { useStore } from './useStore'

const SORTS: { id: SortMode; name: string }[] = [
  { id: 'default', name: 'Default' },
  { id: 'importance', name: 'Importance' },
  { id: 'dueDate', name: 'Due date' },
  { id: 'alphabetical', name: 'Alphabetically' },
  { id: 'created', name: 'Creation date' },
]

function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (next: T) => {
      setV(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* ignore */
      }
    },
    [key],
  )
  return [v, set]
}

type Session =
  | { kind: 'none' }
  | { kind: 'checking' }
  | { kind: 'local'; backend: LocalBackend }
  | { kind: 'graph'; backend: GraphBackend; auth: Auth; userName: string }

export default function App() {
  const [backendChoice, setBackendChoice] = usePersisted<'graph' | 'local' | null>('todo2.backend', null)
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(() => loadAuthConfig())
  const [session, setSession] = useState<Session>({ kind: 'checking' })
  const [look, setLook] = usePersisted<Look>('todo2.look', 'fresh')
  const [scheme, setScheme] = usePersisted<Scheme>('todo2.scheme', 'system')

  useEffect(() => {
    document.documentElement.dataset.look = look
    if (scheme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = scheme
  }, [look, scheme])

  // Work out who is signed in (or whether we are in demo mode).
  useEffect(() => {
    let live = true
    if (backendChoice === 'local') {
      setSession({ kind: 'local', backend: new LocalBackend() })
      return
    }
    if (!authConfig) {
      setSession({ kind: 'none' })
      return
    }
    const auth = new Auth(authConfig)
    setSession({ kind: 'checking' })
    auth
      .account()
      .then((acct) => {
        if (!live) return
        if (!acct) return setSession({ kind: 'none' })
        const client = new GraphClient(() => auth.token())
        setSession({ kind: 'graph', backend: new GraphBackend(client), auth, userName: acct.name ?? acct.username })
        setBackendChoice('graph')
      })
      .catch(() => live && setSession({ kind: 'none' }))
    return () => {
      live = false
    }
  }, [backendChoice, authConfig, setBackendChoice])

  if (session.kind === 'checking') return <div className="center-screen muted">Loading…</div>
  if (session.kind === 'none')
    return (
      <Welcome
        config={authConfig}
        onSaveConfig={(c) => {
          saveAuthConfig(c)
          setAuthConfig(c)
        }}
        onSignIn={() => authConfig && void new Auth(authConfig).signIn()}
        onDemo={() => setBackendChoice('local')}
      />
    )

  return (
    <Main
      key={session.kind}
      session={session}
      look={look}
      scheme={scheme}
      onLook={setLook}
      onScheme={setScheme}
      onLeave={() => {
        setBackendChoice(null)
        if (session.kind === 'graph') void session.auth.signOut()
        else setSession({ kind: 'none' })
      }}
    />
  )
}

function Main({
  session,
  look,
  scheme,
  onLook,
  onScheme,
  onLeave,
}: {
  session: Extract<Session, { kind: 'local' | 'graph' }>
  look: Look
  scheme: Scheme
  onLook: (l: Look) => void
  onScheme: (s: Scheme) => void
  onLeave: () => void
}) {
  const backend: Backend = session.backend
  const [mode, setMode] = usePersisted<Mode>('todo2.mode', 'simple')
  const [view, setView] = usePersisted<ViewRef>('todo2.view', { kind: 'smart', id: 'myday' })
  const [sort, setSort] = usePersisted<SortMode>('todo2.sort', 'default')
  const [sidebarOpen, setSidebarOpen] = usePersisted('todo2.sidebar', true)
  const [showCompleted, setShowCompleted] = usePersisted('todo2.showCompleted', true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [popover, setPopover] = useState<'sort' | 'suggest' | 'theme' | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [targetList, setTargetList] = useState<string | null>(null)
  const [, forceRerender] = useState(0)
  const store = useStore(backend, mode)

  const now = new Date()
  const today = toLocalDate(now)

  const snap = store.snap
  const plans = useMemo(() => (snap ? visiblePlans(snap.plans, mode) : []), [snap, mode])
  const tasks = useMemo(() => (snap ? inScope(snap.tasks, snap.plans, mode) : []), [snap, mode])
  const personal = snap?.plans.find((p) => p.personal)
  const lists = snap?.lists ?? []

  // If the selected view disappears (e.g. switching to Simple mode), go back to My Day.
  useEffect(() => {
    if (!snap) return
    const ok =
      view.kind === 'smart' ||
      (view.kind === 'plan' && plans.some((p) => p.id === view.planId)) ||
      (view.kind === 'list' && lists.some((l) => l.id === view.listId) && plans.some((p) => p.id === view.planId))
    if (!ok) setView({ kind: 'smart', id: 'myday' })
  }, [snap, plans, lists, view, setView])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPopover(null)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (store.state === 'setup' && session.kind === 'graph')
    return (
      <PlanSetup
        backend={session.backend}
        onSignOut={onLeave}
        onDone={async (created) => {
          await store.reload()
          if (created) setSettingsOpen(true) // offer the To Do import straight away
        }}
      />
    )
  if (store.state === 'loading' || !snap) {
    if (store.state === 'error')
      return (
        <div className="center-screen">
          <div className="setup-card glass">
            <h1>Couldn't load your tasks</h1>
            <p className="error">{store.error}</p>
            <button className="btn primary" onClick={() => store.reload()}>Try again</button>
            <button className="link-btn" onClick={onLeave}>Sign out</button>
          </div>
        </div>
      )
    return <div className="center-screen muted">Loading your tasks…</div>
  }

  const planMap = new Map(snap.plans.map((p) => [p.id, p]))
  const listMap = new Map(lists.map((l) => [l.id, l]))
  const result = buildView(tasks, snap.plans, view, sort, search)
  const title = search ? `Search: ${search}` : viewTitle(view, plans, lists)
  const selected = snap.tasks.find((t) => t.id === selectedId)
  const progress = dayProgress(tasks.filter((t) => t.source === 'planner'), today, (iso) => toLocalDate(new Date(iso)))
  const isMyDay = view.kind === 'smart' && view.id === 'myday' && !search

  // Where "Add a task" puts new tasks.
  const addTarget = (() => {
    if (view.kind === 'list') return { planId: view.planId, listId: view.listId, fixed: true }
    if (view.kind === 'plan') {
      const first = lists.find((l) => l.planId === view.planId)
      return first ? { planId: view.planId, listId: first.id, fixed: true } : null
    }
    const mine = lists.filter((l) => l.planId === personal?.id)
    const chosen = mine.find((l) => l.id === targetList) ?? mine[0]
    return chosen && personal ? { planId: personal.id, listId: chosen.id, fixed: false } : null
  })()
  const canAdd = !!addTarget && !(view.kind === 'smart' && (view.id === 'completed' || view.id === 'flagged')) && !search

  const addTask = () => {
    const t = newTitle.trim()
    if (!t || !addTarget) return
    const d = addDefaults(view)
    void store.createTask({
      title: t,
      planId: addTarget.planId,
      listId: addTarget.listId,
      myDay: d.myDay,
      important: d.important,
      dueDate: d.dueDate === 'today' ? today : undefined,
    })
    setNewTitle('')
  }

  const renderRow = (t: Task) => (
    <TaskRow
      key={t.id}
      task={t}
      plan={planMap.get(t.planId)}
      list={listMap.get(t.listId)}
      showPlan={mode === 'full' || view.kind === 'smart'}
      today={today}
      selected={t.id === selectedId}
      onToggle={() => store.updateTask(t, { completed: !t.completed })}
      onStar={() => store.updateTask(t, { important: !t.important })}
      onOpen={() => setSelectedId(t.id === selectedId ? null : t.id)}
    />
  )

  // Planned groups by due date, like To Do.
  const plannedGroups = () => {
    const groups: { name: string; items: Task[] }[] = [
      { name: 'Earlier', items: [] },
      { name: 'Today', items: [] },
      { name: 'Tomorrow', items: [] },
      { name: 'This week', items: [] },
      { name: 'Later', items: [] },
    ]
    const tomorrow = addDays(today, 1)
    const week = addDays(today, 7)
    for (const t of [...result.open].sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))) {
      const d = t.dueDate!
      const g = d < today ? 0 : d === today ? 1 : d === tomorrow ? 2 : d <= week ? 3 : 4
      groups[g].items.push(t)
    }
    return groups.filter((g) => g.items.length)
  }

  const isPlanned = view.kind === 'smart' && view.id === 'planned' && !search && sort === 'default'

  return (
    <div className={'app' + (sidebarOpen ? '' : ' no-sidebar') + (selected ? ' with-detail' : '')}>
      <div className="backdrop-blobs" aria-hidden="true" />
      {sidebarOpen && (
        <Sidebar
          title={title}
          mode={mode}
          onMode={setMode}
          view={view}
          onView={(v) => {
            setView(v)
            setSelectedId(null)
            // On phones the sidebar is an overlay; get it out of the way once a list is picked.
            if (window.matchMedia('(max-width: 760px)').matches) setSidebarOpen(false)
          }}
          search={search}
          onSearch={setSearch}
          plans={plans}
          lists={lists}
          tasks={tasks}
          onNewList={async (name) => {
            if (!personal) return
            const l = await store.createList(personal.id, name)
            if (l) setView({ kind: 'list', planId: l.planId, listId: l.id })
          }}
          onSettings={() => setSettingsOpen(true)}
          onCollapse={() => setSidebarOpen(false)}
        />
      )}

      <main className="main">
        <header className="main-head">
          {!sidebarOpen && (
            <button className="icon-btn" onClick={() => setSidebarOpen(true)} aria-label="Show sidebar" title="Show sidebar">
              <I.Sidebar />
            </button>
          )}
          <div className="head-text">
            <div className="date">{longToday(now)}</div>
            <h1>{title}</h1>
            <div className="sub">{result.open.length} open</div>
          </div>
          <div className="head-tools">
            <div className="ring" title={`${progress.done} of ${progress.total} done today`}>
              <svg viewBox="0 0 36 36" width="34" height="34" aria-hidden="true">
                <circle cx="18" cy="18" r="15" className="ring-bg" />
                <circle
                  cx="18"
                  cy="18"
                  r="15"
                  className="ring-fg"
                  strokeDasharray={`${progress.total ? (94.2 * progress.done) / progress.total : 0} 94.2`}
                />
              </svg>
              <div>
                <strong>
                  {progress.done}/{progress.total}
                </strong>
                <div className="muted small">done today</div>
              </div>
            </div>
            <div className="toolbar glass">
              {isMyDay && (
                <button className="tool" onClick={() => setPopover(popover === 'suggest' ? null : 'suggest')}>
                  <I.Bulb size={16} /> <span>Suggestions</span>
                </button>
              )}
              <button className="tool" onClick={() => setPopover(popover === 'sort' ? null : 'sort')}>
                <I.Sort size={16} /> <span>{SORTS.find((s) => s.id === sort)!.name}</span>
              </button>
              <button className="tool" onClick={() => setPopover(popover === 'theme' ? null : 'theme')} aria-label="Appearance" title="Appearance">
                <I.Palette size={16} />
              </button>
            </div>
            {popover === 'sort' && (
              <div className="popover glass menu" role="menu">
                {SORTS.map((s) => (
                  <button
                    key={s.id}
                    role="menuitemradio"
                    aria-checked={sort === s.id}
                    className={sort === s.id ? 'on' : ''}
                    onClick={() => {
                      setSort(s.id)
                      setPopover(null)
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            {popover === 'suggest' && (
              <SuggestionsPanel
                tasks={tasks}
                today={today}
                onAdd={(t) => store.updateTask(t, { myDay: true })}
                onClose={() => setPopover(null)}
              />
            )}
            {popover === 'theme' && (
              <ThemeMenu look={look} scheme={scheme} onLook={onLook} onScheme={onScheme} onClose={() => setPopover(null)} />
            )}
          </div>
        </header>

        <div className="task-scroll">
          {snap.emailError && view.kind === 'smart' && view.id === 'flagged' && (
            <div className="notice">Flagged emails couldn't be loaded: {snap.emailError}</div>
          )}
          {isMyDay && (
            <OverviewCard
              tasks={tasks}
              today={today}
              onOpen={(t) => setSelectedId(t.id)}
              onGoMyTasks={() => setView({ kind: 'smart', id: 'mytasks' })}
              onRefresh={async () => {
                await store.reload()
                forceRerender((n) => n + 1)
              }}
            />
          )}

          {isPlanned
            ? plannedGroups().map((g) => (
                <div key={g.name} className="group">
                  <div className="group-head">{g.name} <span className="muted">{g.items.length}</span></div>
                  {g.items.map(renderRow)}
                </div>
              ))
            : result.open.map(renderRow)}

          {result.open.length === 0 && result.completed.length === 0 && (
            <div className="empty muted">
              {search
                ? 'No tasks match your search.'
                : isMyDay
                  ? 'Focus on your day. Add tasks here or pick from Suggestions.'
                  : 'No tasks here yet.'}
            </div>
          )}

          {result.completed.length > 0 && (
            <div className="group">
              {result.open.length > 0 || !(view.kind === 'smart' && view.id === 'completed') ? (
                <button className="group-head toggle" onClick={() => setShowCompleted(!showCompleted)} aria-expanded={showCompleted}>
                  <I.Chevron size={14} dir={showCompleted ? 'down' : 'right'} /> Completed{' '}
                  <span className="muted">{result.completed.length}</span>
                </button>
              ) : null}
              {(showCompleted || (view.kind === 'smart' && view.id === 'completed')) && result.completed.map(renderRow)}
            </div>
          )}
        </div>

        {canAdd && addTarget && (
          <form
            className="add-bar glass"
            onSubmit={(e) => {
              e.preventDefault()
              addTask()
            }}
          >
            <I.Plus size={18} />
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Add a task" aria-label="Add a task" />
            {!addTarget.fixed && (
              <select
                className="list-pick"
                value={addTarget.listId}
                onChange={(e) => setTargetList(e.target.value)}
                aria-label="List for new tasks"
              >
                {lists
                  .filter((l) => l.planId === personal?.id)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            )}
          </form>
        )}
      </main>

      {selected && (
        <DetailPane
          key={selected.id}
          task={selected}
          plan={planMap.get(selected.planId)}
          lists={lists}
          backend={backend}
          store={store}
          today={today}
          onClose={() => setSelectedId(null)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          backend={backend}
          store={store}
          personal={personal}
          lists={lists}
          userName={session.kind === 'graph' ? session.userName : 'Demo user'}
          onClose={() => setSettingsOpen(false)}
          onSwitchPlan={
            session.kind === 'graph'
              ? () => {
                  session.backend.forgetPlan()
                  setSettingsOpen(false)
                  void store.reload()
                }
              : undefined
          }
          onResetDemo={
            session.kind === 'local'
              ? () => {
                  resetLocalData()
                  window.location.reload()
                }
              : undefined
          }
          onSignOut={onLeave}
        />
      )}

      {store.toast && (
        <div className="toast" role="status" onClick={store.clearToast}>
          {store.toast}
          <button className="icon-btn tiny" aria-label="Dismiss">
            <I.Close size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
