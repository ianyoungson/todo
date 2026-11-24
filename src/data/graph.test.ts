import { describe, expect, it } from 'vitest'
import type { Task } from '../model/types'
import { GraphBackend } from './graphBackend'
import { GraphClient, GraphError } from './graphClient'
import {
  checklistPatch,
  emailPatch,
  isMyDay,
  mapDetails,
  mapEmail,
  mapPlannerTask,
  plannerTaskPatch,
  todoToPlanner,
} from './graphMapping'
import { LocalBackend } from './localBackend'

const ctx = { meId: 'me', today: '2026-11-22', todayUtc: '2026-11-22' }

describe('Planner task mapping', () => {
  const raw = {
    id: 't1',
    planId: 'p',
    bucketId: 'b',
    title: 'Test123',
    percentComplete: 0,
    priority: 3,
    createdDateTime: '2026-11-20T10:00:00Z',
    dueDateTime: '2026-11-24T12:00:00Z',
    appliedCategories: { category2: true, category10: true, category4: false },
    assignments: { me: {} },
    hasDescription: true,
    checklistItemCount: 3,
    activeChecklistItemCount: 1,
    isOnMyDay: true,
    isOnMyDayLastModifiedDate: '2026-11-22',
    '@odata.etag': 'W/"1"',
  }

  it('maps the fields the UI needs', () => {
    expect(mapPlannerTask(raw, ctx)).toMatchObject({
      id: 't1',
      listId: 'b',
      completed: false,
      important: true,
      myDay: true,
      dueDate: '2026-11-24',
      labels: ['category2', 'category10'],
      hasNotes: true,
      stepCount: 3,
      stepsDone: 2,
      assignedToMe: true,
      etag: 'W/"1"',
    })
  })

  it('treats priority 0–4 as important and 5+ as not', () => {
    expect(mapPlannerTask({ ...raw, priority: 1 }, ctx).important).toBe(true)
    expect(mapPlannerTask({ ...raw, priority: 5 }, ctx).important).toBe(false)
    expect(mapPlannerTask({ ...raw, priority: undefined }, ctx).important).toBe(false)
  })

  it('empties My Day overnight like To Do', () => {
    expect(isMyDay({ isOnMyDay: true, isOnMyDayLastModifiedDate: '2026-11-21' }, ctx)).toBe(false)
    expect(isMyDay({ isOnMyDay: true, isOnMyDayLastModifiedDate: '2026-11-22' }, ctx)).toBe(true)
    expect(isMyDay({ isOnMyDay: false, isOnMyDayLastModifiedDate: '2026-11-22' }, ctx)).toBe(false)
  })
})

describe('Planner patches', () => {
  const current = { labels: ['category2'] } as Task

  it('translates the app patch to Planner fields', () => {
    expect(
      plannerTaskPatch(current, {
        completed: true,
        important: true,
        myDay: false,
        dueDate: '2026-12-01',
        listId: 'b2',
        labels: ['category5'],
      }),
    ).toEqual({
      percentComplete: 100,
      priority: 3,
      isOnMyDay: false,
      dueDateTime: '2026-12-01T12:00:00Z',
      bucketId: 'b2',
      appliedCategories: { category2: false, category5: true },
    })
  })

  it('clears the due date with null', () => {
    expect(plannerTaskPatch(current, { dueDate: undefined })).toEqual({ dueDateTime: null })
  })

  it('diffs checklist items', () => {
    const before = [
      { id: 'a', title: 'One', done: false, orderHint: '8585' },
      { id: 'b', title: 'Two', done: false, orderHint: '8586' },
    ]
    const after = [
      { id: 'a', title: 'One', done: true },
      { id: '', title: 'Three', done: false },
    ]
    expect(checklistPatch(before, after, () => 'new-guid')).toEqual({
      a: { '@odata.type': 'microsoft.graph.plannerChecklistItem', isChecked: true },
      'new-guid': {
        '@odata.type': 'microsoft.graph.plannerChecklistItem',
        title: 'Three',
        isChecked: false,
        orderHint: '8585 !',
      },
      b: null,
    })
  })

  it('maps details sorted by order hint', () => {
    const d = mapDetails({
      id: 't',
      description: 'hi',
      checklist: {
        x: { title: 'second', isChecked: false, orderHint: '2' },
        y: { title: 'first', isChecked: true, orderHint: '1' },
      },
    })
    expect(d.steps.map((s) => s.title)).toEqual(['first', 'second'])
    expect(d.notes).toBe('hi')
  })
})

describe('flagged email and To Do import', () => {
  it('maps a flagged message to a task', () => {
    const t = mapEmail({
      id: 'm1',
      subject: 'Sign contract',
      from: { emailAddress: { name: 'Legal' } },
      flag: { flagStatus: 'flagged', dueDateTime: { dateTime: '2026-11-25T00:00:00.0000000', timeZone: 'UTC' } },
      receivedDateTime: '2026-11-20T09:00:00Z',
    })
    expect(t).toMatchObject({ source: 'email', title: 'Sign contract', from: 'Legal', dueDate: '2026-11-25', completed: false })
    expect(emailPatch({ completed: true })).toEqual({ flag: { flagStatus: 'complete' } })
    expect(emailPatch({ title: 'x' })).toBeNull()
  })

  it('converts a To Do task, capping steps at 20', () => {
    const conv = todoToPlanner(
      {
        id: 'x',
        title: 'Old task',
        status: 'completed',
        importance: 'high',
        dueDateTime: { dateTime: '2026-11-30T00:00:00.0000000', timeZone: 'UTC' },
        body: { content: '  note  ' },
        checklistItems: Array.from({ length: 25 }, (_, i) => ({ displayName: `s${i}`, isChecked: false })),
      },
      'plan',
      'bucket',
      'me',
    )
    expect(conv.task).toMatchObject({ planId: 'plan', bucketId: 'bucket', priority: 3, dueDateTime: '2026-11-30T12:00:00Z' })
    expect(conv.description).toBe('note')
    expect(conv.steps).toHaveLength(20)
    expect(conv.completed).toBe(true)
  })
})

/* ---------- network layer with a fake fetch ---------- */

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown }

function fakeFetch(handler: (c: Call) => { status?: number; json?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = []
  const fn = async (url: string, init?: RequestInit) => {
    const c: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    }
    calls.push(c)
    const r = handler(c)
    const status = r.status ?? 200
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status, headers: r.headers })
  }
  return { fn, calls }
}

describe('GraphClient', () => {
  it('follows nextLink paging', async () => {
    const { fn } = fakeFetch((c) =>
      c.url.endsWith('page2') ? { json: { value: [2] } } : { json: { value: [1], '@odata.nextLink': 'https://x/page2' } },
    )
    const client = new GraphClient(async () => 'tok', fn)
    expect(await client.getAll('https://x/page1')).toEqual([1, 2])
  })

  it('retries throttled requests and sends If-Match', async () => {
    let n = 0
    const { fn, calls } = fakeFetch(() => (n++ === 0 ? { status: 429, headers: { 'Retry-After': '1' } } : { json: { ok: true } }))
    const waits: number[] = []
    const client = new GraphClient(async () => 'tok', fn, async (ms) => void waits.push(ms))
    expect(await client.request('https://x', { method: 'PATCH', body: {}, etag: 'W/"e"' })).toEqual({ ok: true })
    expect(waits).toEqual([1000])
    expect(calls[1].headers['If-Match']).toBe('W/"e"')
    expect(calls[1].headers.Authorization).toBe('Bearer tok')
  })

  it('surfaces Graph error messages', async () => {
    const { fn } = fakeFetch(() => ({ status: 403, json: { error: { code: 'Forbidden', message: 'Nope' } } }))
    const client = new GraphClient(async () => 'tok', fn)
    await expect(client.get('https://x')).rejects.toMatchObject({ status: 403, message: 'Nope' } satisfies Partial<GraphError>)
  })
})

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

describe('GraphBackend', () => {
  it('creates a private roster plan with a first list', async () => {
    const { fn, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/me?$select=id,displayName')) return { json: { id: 'me', displayName: 'Me' } }
      if (c.url.endsWith('/planner/rosters')) return { status: 201, json: { id: 'r1' } }
      if (c.url.endsWith('/rosters/r1/members')) return { status: 409, json: { error: { code: 'Conflict', message: 'exists' } } }
      if (c.url.endsWith('/planner/plans')) return { status: 201, json: { id: 'plan1', title: 'Personal ToDo' } }
      if (c.url.endsWith('/planner/buckets')) return { status: 201, json: { id: 'b1', planId: 'plan1', name: 'To do' } }
      throw new Error('unexpected ' + c.url)
    })
    const storage = memoryStorage()
    const backend = new GraphBackend(new GraphClient(async () => 't', fn), storage)
    expect(await backend.createPersonalPlan()).toBe('plan1')
    expect(backend.personalPlanId).toBe('plan1')
    const planCall = calls.find((c) => c.url.endsWith('/planner/plans'))!
    expect(planCall.body).toEqual({
      title: 'Personal ToDo',
      container: { url: 'https://graph.microsoft.com/beta/planner/rosters/r1' },
    })
  })

  it('retries a PATCH once with a fresh etag after a 412', async () => {
    let patches = 0
    const { fn, calls } = fakeFetch((c) => {
      if (c.url.includes('/me?')) return { json: { id: 'me', displayName: 'Me' } }
      if (c.method === 'PATCH') {
        patches++
        if (patches === 1) return { status: 412, json: { error: { code: 'PreconditionFailed', message: 'etag' } } }
        return { json: { id: 't1', planId: 'p', bucketId: 'b', title: 'x', percentComplete: 100, createdDateTime: 'z', '@odata.etag': 'W/"3"' } }
      }
      return { json: { id: 't1', '@odata.etag': 'W/"2"' } }
    })
    const backend = new GraphBackend(new GraphClient(async () => 't', fn), memoryStorage())
    const task = { id: 't1', source: 'planner', etag: 'W/"1"', labels: [] } as unknown as Task
    const updated = await backend.updateTask(task, { completed: true })
    expect(updated.completed).toBe(true)
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.headers['If-Match'])).toEqual(['W/"1"', 'W/"2"'])
  })

  it('loads the personal plan plus other plans in Full mode, tolerating a mail failure', async () => {
    const plan = (id: string) => ({
      [`/planner/plans/${id}`]: { id, title: id.toUpperCase() },
      [`/planner/plans/${id}/details`]: { categoryDescriptions: { category1: 'Urgent', category2: null } },
      [`/planner/plans/${id}/buckets`]: { value: [{ id: `${id}-b`, planId: id, name: 'To do', orderHint: '1' }] },
      [`/planner/plans/${id}/tasks`]: {
        value: [{ id: `${id}-t`, planId: id, bucketId: `${id}-b`, title: 't', percentComplete: 0, createdDateTime: 'x', assignments: { me: {} } }],
      },
    })
    const routes: Record<string, unknown> = {
      '/me?$select=id,displayName': { id: 'me', displayName: 'Me' },
      '/me/planner/rosterPlans': { value: [{ id: 'mine', title: 'Personal ToDo' }] },
      '/me/planner/plans': { value: [{ id: 'team', title: 'Team' }] },
      ...plan('mine'),
      ...plan('team'),
    }
    const { fn } = fakeFetch((c) => {
      const path = c.url.replace(/^https:\/\/graph\.microsoft\.com\/(v1\.0|beta)/, '')
      if (path.startsWith('/me/messages')) return { status: 403, json: { error: { code: 'Forbidden', message: 'No mail consent' } } }
      if (path in routes) return { json: routes[path] }
      throw new Error('unexpected ' + path)
    })
    const storage = memoryStorage()
    storage.setItem('todo2.personalPlanId', 'mine')
    const backend = new GraphBackend(new GraphClient(async () => 't', fn), storage)

    const simple = await backend.load('simple')
    expect(simple.plans.map((p) => [p.id, p.personal])).toEqual([['mine', true]])
    expect(simple.plans[0].labels).toEqual({ category1: 'Urgent' })
    expect(simple.emailError).toBe('No mail consent')

    const full = await backend.load('full')
    expect(full.plans.map((p) => p.id)).toEqual(['mine', 'team'])
    expect(full.tasks.map((t) => t.id)).toEqual(['mine-t', 'team-t'])
    expect(full.lists).toHaveLength(2)
  })

  it('asks for setup when no personal plan is chosen', async () => {
    const backend = new GraphBackend(new GraphClient(async () => 't', fakeFetch(() => ({})).fn), memoryStorage())
    await expect(backend.load('simple')).rejects.toThrow('No personal plan')
  })
})

describe('LocalBackend', () => {
  it('clears My Day when the date changes', async () => {
    let now = new Date(2026, 10, 22, 9)
    const b = new LocalBackend(memoryStorage(), () => now)
    const t = await b.createTask({ title: 'x', planId: 'personal', listId: 'todo', myDay: true })
    expect(t.myDay).toBe(true)
    now = new Date(2026, 10, 23, 9)
    const snap = await b.load('simple')
    expect(snap.tasks.find((x) => x.id === t.id)!.myDay).toBe(false)
  })

  it('persists steps and reflects counts on the task', async () => {
    const storage = memoryStorage()
    const b = new LocalBackend(storage)
    const t = await b.createTask({ title: 'x', planId: 'personal', listId: 'todo' })
    const d = await b.getDetails(t)
    await b.updateDetails(t, d, { steps: [{ id: '', title: 'a', done: true }, { id: '', title: 'b', done: false }] })
    const again = new LocalBackend(storage)
    const loaded = (await again.load('simple')).tasks.find((x) => x.id === t.id)!
    expect([loaded.stepCount, loaded.stepsDone]).toEqual([2, 1])
  })
})
