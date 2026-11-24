/**
 * Pure conversions between Microsoft Graph (Planner, Outlook, To Do) payloads and the app model.
 * Kept free of network code so it can be unit-tested.
 */
import { dueDateFromGraph, dueDateToGraph } from '../model/dates'
import type { Plan, Step, Task, TaskDetails, TaskList, TaskPatch } from '../model/types'

/* ---------- Graph payload shapes (only the fields we use) ---------- */

export interface GraphPlannerTask {
  id: string
  planId: string
  bucketId: string
  title: string
  percentComplete: number
  completedDateTime?: string | null
  dueDateTime?: string | null
  priority?: number
  createdDateTime: string
  orderHint?: string
  appliedCategories?: Record<string, boolean>
  assignments?: Record<string, unknown>
  hasDescription?: boolean
  checklistItemCount?: number
  activeChecklistItemCount?: number
  isOnMyDay?: boolean | null
  isOnMyDayLastModifiedDate?: string | null
  '@odata.etag'?: string
}

export interface GraphPlan {
  id: string
  title: string
  '@odata.etag'?: string
}

export interface GraphPlanDetails {
  categoryDescriptions?: Record<string, string | null>
  '@odata.etag'?: string
}

export interface GraphBucket {
  id: string
  planId: string
  name: string
  orderHint?: string
  '@odata.etag'?: string
}

export interface GraphChecklistItem {
  title: string
  isChecked: boolean
  orderHint?: string
}

export interface GraphTaskDetails {
  id: string
  description?: string | null
  checklist?: Record<string, GraphChecklistItem>
  '@odata.etag'?: string
}

export interface GraphMessage {
  id: string
  subject?: string | null
  webLink?: string
  receivedDateTime?: string
  importance?: 'low' | 'normal' | 'high'
  from?: { emailAddress?: { name?: string; address?: string } }
  flag?: {
    flagStatus?: 'notFlagged' | 'complete' | 'flagged'
    dueDateTime?: { dateTime: string; timeZone: string } | null
    completedDateTime?: { dateTime: string; timeZone: string } | null
  }
}

export interface GraphTodoTask {
  id: string
  title: string
  status: 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred'
  importance: 'low' | 'normal' | 'high'
  createdDateTime?: string
  dueDateTime?: { dateTime: string; timeZone: string } | null
  body?: { content?: string; contentType?: 'text' | 'html' } | null
  checklistItems?: { displayName: string; isChecked: boolean }[]
}

/* ---------- Constants ---------- */

/** Planner: 0–1 urgent, 2–4 important, 5–7 medium, 8–10 low. */
export const PRIORITY_IMPORTANT = 3
export const PRIORITY_MEDIUM = 5
/** Planner allows at most 20 checklist items per task. */
export const MAX_CHECKLIST = 20

/* ---------- Mapping in ---------- */

export interface MapContext {
  meId: string
  /** Local and UTC calendar dates for "today"; Planner records the My Day date in UTC. */
  today: string
  todayUtc: string
}

export function isImportantPriority(priority: number | undefined) {
  return priority !== undefined && priority <= 4
}

/**
 * To Do semantics: My Day empties overnight. Planner keeps isOnMyDay set until someone clears it,
 * so a task only counts as "in My Day" if it was put there today.
 */
export function isMyDay(raw: Pick<GraphPlannerTask, 'isOnMyDay' | 'isOnMyDayLastModifiedDate'>, ctx: MapContext) {
  if (!raw.isOnMyDay) return false
  const d = raw.isOnMyDayLastModifiedDate?.slice(0, 10)
  return !d || d === ctx.today || d === ctx.todayUtc
}

export function mapPlannerTask(raw: GraphPlannerTask, ctx: MapContext): Task {
  const total = raw.checklistItemCount ?? 0
  return {
    id: raw.id,
    source: 'planner',
    planId: raw.planId,
    listId: raw.bucketId,
    title: raw.title,
    completed: raw.percentComplete === 100,
    completedAt: raw.completedDateTime ?? undefined,
    dueDate: dueDateFromGraph(raw.dueDateTime),
    important: isImportantPriority(raw.priority),
    myDay: isMyDay(raw, ctx),
    labels: Object.entries(raw.appliedCategories ?? {})
      .filter(([, on]) => on)
      .map(([k]) => k)
      .sort((a, b) => Number(a.slice(8)) - Number(b.slice(8))),
    hasNotes: !!raw.hasDescription,
    stepCount: total,
    stepsDone: total - (raw.activeChecklistItemCount ?? 0),
    assignedToMe: !!raw.assignments && ctx.meId in raw.assignments,
    createdAt: raw.createdDateTime,
    orderHint: raw.orderHint,
    etag: raw['@odata.etag'],
  }
}

export function mapPlan(raw: GraphPlan, details: GraphPlanDetails | undefined, personal: boolean): Plan {
  const labels: Record<string, string> = {}
  for (const [k, v] of Object.entries(details?.categoryDescriptions ?? {})) {
    if (k.startsWith('category') && typeof v === 'string') labels[k] = v
  }
  return {
    id: raw.id,
    title: raw.title,
    personal,
    labels,
    etag: raw['@odata.etag'],
    detailsEtag: details?.['@odata.etag'],
  }
}

export function mapBucket(raw: GraphBucket): TaskList {
  return { id: raw.id, planId: raw.planId, name: raw.name, orderHint: raw.orderHint, etag: raw['@odata.etag'] }
}

export function sortByOrderHint<T extends { orderHint?: string }>(items: T[]): T[] {
  // Planner order hints sort by ordinal (code point) comparison, not locale.
  return [...items].sort((a, b) => {
    const x = a.orderHint ?? ''
    const y = b.orderHint ?? ''
    return x < y ? -1 : x > y ? 1 : 0
  })
}

export function mapDetails(raw: GraphTaskDetails): TaskDetails {
  const steps: Step[] = Object.entries(raw.checklist ?? {}).map(([id, c]) => ({
    id,
    title: c.title,
    done: c.isChecked,
    orderHint: c.orderHint,
  }))
  return {
    taskId: raw.id,
    notes: raw.description ?? '',
    steps: sortByOrderHint(steps),
    etag: raw['@odata.etag'],
  }
}

export function mapEmail(raw: GraphMessage): Task {
  const due = raw.flag?.dueDateTime?.dateTime
  return {
    id: raw.id,
    source: 'email',
    planId: '',
    listId: 'flagged',
    title: raw.subject?.trim() || '(No subject)',
    completed: raw.flag?.flagStatus === 'complete',
    completedAt: raw.flag?.completedDateTime?.dateTime ? raw.flag.completedDateTime.dateTime + 'Z' : undefined,
    dueDate: due ? due.slice(0, 10) : undefined,
    important: raw.importance === 'high',
    myDay: false,
    labels: [],
    hasNotes: false,
    stepCount: 0,
    stepsDone: 0,
    assignedToMe: true,
    createdAt: raw.receivedDateTime ?? new Date(0).toISOString(),
    webLink: raw.webLink,
    from: raw.from?.emailAddress?.name || raw.from?.emailAddress?.address,
  }
}

/* ---------- Mapping out ---------- */

/** Builds the PATCH body for a Planner task. Needs the current task to diff labels. */
export function plannerTaskPatch(current: Task, patch: TaskPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (patch.title !== undefined) body.title = patch.title
  if (patch.completed !== undefined) body.percentComplete = patch.completed ? 100 : 0
  if ('dueDate' in patch) body.dueDateTime = dueDateToGraph(patch.dueDate)
  if (patch.important !== undefined) body.priority = patch.important ? PRIORITY_IMPORTANT : PRIORITY_MEDIUM
  if (patch.myDay !== undefined) body.isOnMyDay = patch.myDay
  if (patch.listId !== undefined) body.bucketId = patch.listId
  if (patch.labels) {
    const applied: Record<string, boolean> = {}
    for (const k of current.labels) applied[k] = false
    for (const k of patch.labels) applied[k] = true
    body.appliedCategories = applied
  }
  return body
}

export function newGuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * Turns the desired step list into a Planner checklist PATCH: new items get a fresh GUID key,
 * removed items are set to null, changed items send only what changed.
 */
export function checklistPatch(
  before: Step[],
  after: Step[],
  makeId: () => string = newGuid,
): Record<string, Record<string, unknown> | null> {
  const out: Record<string, Record<string, unknown> | null> = {}
  const prev = new Map(before.map((s) => [s.id, s]))
  const keep = new Set<string>()
  let lastHint: string | undefined
  for (const step of after) {
    const old = step.id ? prev.get(step.id) : undefined
    if (!old) {
      out[makeId()] = {
        '@odata.type': 'microsoft.graph.plannerChecklistItem',
        title: step.title,
        isChecked: step.done,
        // "<previous> !" asks Planner for a hint that sorts right after the previous item.
        orderHint: `${lastHint ?? ''} !`,
      }
      continue
    }
    keep.add(old.id)
    lastHint = old.orderHint ?? lastHint
    const change: Record<string, unknown> = {}
    if (old.title !== step.title) change.title = step.title
    if (old.done !== step.done) change.isChecked = step.done
    if (Object.keys(change).length) out[old.id] = { '@odata.type': 'microsoft.graph.plannerChecklistItem', ...change }
  }
  for (const s of before) if (!keep.has(s.id)) out[s.id] = null
  return out
}

export function emailPatch(patch: TaskPatch): Record<string, unknown> | null {
  const body: Record<string, unknown> = {}
  if (patch.completed !== undefined) body.flag = { flagStatus: patch.completed ? 'complete' : 'flagged' }
  if (patch.important !== undefined) body.importance = patch.important ? 'high' : 'normal'
  return Object.keys(body).length ? body : null
}

/** A To Do task as the body of a new Planner task, plus the details to write afterwards. */
export function todoToPlanner(
  t: GraphTodoTask,
  planId: string,
  bucketId: string,
  meId: string,
): { task: Record<string, unknown>; description: string; steps: Step[]; completed: boolean } {
  const due = t.dueDateTime?.dateTime?.slice(0, 10)
  return {
    task: {
      planId,
      bucketId,
      title: t.title.slice(0, 255) || '(Untitled)',
      priority: t.importance === 'high' ? PRIORITY_IMPORTANT : PRIORITY_MEDIUM,
      ...(due ? { dueDateTime: dueDateToGraph(due) } : {}),
      assignments: { [meId]: { '@odata.type': '#microsoft.graph.plannerAssignment', orderHint: ' !' } },
    },
    description: (t.body?.content ?? '').trim(),
    steps: (t.checklistItems ?? []).slice(0, MAX_CHECKLIST).map((c) => ({ id: '', title: c.displayName, done: c.isChecked })),
    completed: t.status === 'completed',
  }
}
