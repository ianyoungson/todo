import { labelInfo } from './types'
import type { Mode, Plan, SmartListId, SortMode, Task, TaskList, ViewRef } from './types'

export const SMART_LISTS: { id: SmartListId; name: string }[] = [
  { id: 'myday', name: 'My Day' },
  { id: 'mytasks', name: 'My tasks' },
  { id: 'important', name: 'Important' },
  { id: 'planned', name: 'Planned' },
  { id: 'all', name: 'All' },
  { id: 'completed', name: 'Completed' },
  { id: 'flagged', name: 'Flagged email' },
]

/** Tasks visible in the current mode: Simple mode hides every plan except the personal one. */
export function inScope(tasks: Task[], plans: Plan[], mode: Mode): Task[] {
  if (mode === 'full') return tasks
  const personal = new Set(plans.filter((p) => p.personal).map((p) => p.id))
  return tasks.filter((t) => t.source === 'email' || personal.has(t.planId))
}

export function visiblePlans(plans: Plan[], mode: Mode): Plan[] {
  return mode === 'full' ? plans : plans.filter((p) => p.personal)
}

function inSmartList(t: Task, id: SmartListId): boolean {
  switch (id) {
    case 'myday':
      return t.myDay
    case 'mytasks':
      return t.source === 'planner' && t.assignedToMe
    case 'important':
      return t.important
    case 'planned':
      return !!t.dueDate
    case 'all':
      return t.source === 'planner'
    case 'completed':
      return t.completed
    case 'flagged':
      return t.source === 'email'
  }
}

export function inView(t: Task, view: ViewRef): boolean {
  switch (view.kind) {
    case 'smart':
      return inSmartList(t, view.id)
    case 'list':
      return t.source === 'planner' && t.planId === view.planId && t.listId === view.listId
    case 'plan':
      return t.source === 'planner' && t.planId === view.planId
  }
}

/** Open count shown next to each entry in the sidebar. */
export function openCount(tasks: Task[], view: ViewRef): number {
  if (view.kind === 'smart' && view.id === 'completed') return 0
  return tasks.filter((t) => !t.completed && inView(t, view)).length
}

export interface SearchQuery {
  text: string[]
  tags: string[]
}

export function parseSearch(input: string): SearchQuery {
  const text: string[] = []
  const tags: string[] = []
  for (const raw of input.trim().toLowerCase().split(/\s+/)) {
    if (!raw) continue
    if (raw.startsWith('#')) {
      if (raw.length > 1) tags.push(raw.slice(1))
    } else text.push(raw)
  }
  return { text, tags }
}

export function matchesSearch(t: Task, q: SearchQuery, plans: Map<string, Plan>): boolean {
  const title = t.title.toLowerCase()
  if (!q.text.every((w) => title.includes(w))) return false
  if (q.tags.length === 0) return true
  const names = t.labels.map((k) => labelInfo(plans.get(t.planId), k).name.toLowerCase().replace(/\s+/g, ''))
  return q.tags.every((tag) => names.some((n) => n.startsWith(tag)))
}

export function sortTasks(tasks: Task[], mode: SortMode): Task[] {
  const copy = [...tasks]
  const byOrder = (a: Task, b: Task) => cmp(a.orderHint ?? '', b.orderHint ?? '') || cmp(b.createdAt, a.createdAt)
  switch (mode) {
    case 'default':
      // Newest first, like To Do; Planner order hints break ties.
      return copy.sort((a, b) => cmp(b.createdAt, a.createdAt) || byOrder(a, b))
    case 'importance':
      return copy.sort((a, b) => Number(b.important) - Number(a.important) || cmp(b.createdAt, a.createdAt))
    case 'dueDate':
      return copy.sort((a, b) => {
        if (a.dueDate && b.dueDate) return cmp(a.dueDate, b.dueDate)
        if (a.dueDate) return -1
        if (b.dueDate) return 1
        return cmp(b.createdAt, a.createdAt)
      })
    case 'alphabetical':
      return copy.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    case 'created':
      return copy.sort((a, b) => cmp(a.createdAt, b.createdAt))
  }
}

function cmp(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}

export interface ViewResult {
  open: Task[]
  completed: Task[]
}

export function buildView(
  tasks: Task[],
  plans: Plan[],
  view: ViewRef,
  sort: SortMode,
  search: string,
): ViewResult {
  const planMap = new Map(plans.map((p) => [p.id, p]))
  const q = parseSearch(search)
  const searching = q.text.length > 0 || q.tags.length > 0
  // A search looks across everything in scope, like To Do's search box.
  const matching = tasks.filter((t) => (searching ? matchesSearch(t, q, planMap) : inView(t, view)))
  const sorted = sortTasks(matching, sort)
  if (view.kind === 'smart' && view.id === 'completed' && !searching) {
    return {
      open: [],
      completed: [...sorted].sort((a, b) => cmp(b.completedAt ?? '', a.completedAt ?? '')),
    }
  }
  return {
    open: sorted.filter((t) => !t.completed),
    completed: sorted.filter((t) => t.completed),
  }
}

export function viewTitle(view: ViewRef, plans: Plan[], lists: TaskList[]): string {
  if (view.kind === 'smart') return SMART_LISTS.find((s) => s.id === view.id)!.name
  if (view.kind === 'plan') return plans.find((p) => p.id === view.planId)?.title ?? 'Plan'
  return lists.find((l) => l.id === view.listId)?.name ?? 'List'
}

/** Where a task added from the current view goes, and what it starts with. */
export function addDefaults(view: ViewRef): { myDay?: boolean; important?: boolean; dueDate?: 'today' } {
  if (view.kind !== 'smart') return {}
  if (view.id === 'myday') return { myDay: true }
  if (view.id === 'important') return { important: true }
  if (view.id === 'planned') return { dueDate: 'today' }
  return {}
}

/** Completed today, for the progress ring ("0/1 done today"). */
export function dayProgress(tasks: Task[], today: string, toLocal: (iso: string) => string) {
  const doneToday = tasks.filter((t) => t.completed && t.completedAt && toLocal(t.completedAt) === today)
  const myDay = tasks.filter((t) => t.myDay)
  const open = myDay.filter((t) => !t.completed).length
  const done = new Set([...doneToday.map((t) => t.id), ...myDay.filter((t) => t.completed).map((t) => t.id)]).size
  return { done, total: done + open }
}
