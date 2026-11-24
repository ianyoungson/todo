import { describe, expect, it } from 'vitest'
import { buildOverview, suggestions } from './overview'
import type { Plan, Task } from './types'
import { addDefaults, buildView, inScope, openCount, parseSearch } from './views'

const TODAY = '2026-11-22'

function task(p: Partial<Task> & { id: string }): Task {
  return {
    source: 'planner',
    planId: 'personal',
    listId: 'todo',
    title: p.id,
    completed: false,
    important: false,
    myDay: false,
    labels: [],
    hasNotes: false,
    stepCount: 0,
    stepsDone: 0,
    assignedToMe: true,
    createdAt: '2026-11-01T00:00:00Z',
    ...p,
  }
}

const plans: Plan[] = [
  { id: 'personal', title: 'Personal ToDo', personal: true, labels: { category5: 'Work' } },
  { id: 'team', title: 'Team', personal: false, labels: {} },
]

describe('scope and views', () => {
  const tasks = [
    task({ id: 'a', myDay: true, important: true }),
    task({ id: 'b', dueDate: TODAY }),
    task({ id: 'c', completed: true, completedAt: '2026-11-22T08:00:00Z' }),
    task({ id: 'd', planId: 'team', listId: 'x', assignedToMe: false }),
    task({ id: 'e', source: 'email', planId: '', listId: 'flagged' }),
  ]

  it('Simple mode hides other plans but keeps flagged email', () => {
    expect(inScope(tasks, plans, 'simple').map((t) => t.id)).toEqual(['a', 'b', 'c', 'e'])
    expect(inScope(tasks, plans, 'full')).toHaveLength(5)
  })

  it('smart lists select the right tasks', () => {
    const ids = (id: Parameters<typeof openCount>[1]) =>
      buildView(tasks, plans, id, 'default', '').open.map((t) => t.id).sort()
    expect(ids({ kind: 'smart', id: 'myday' })).toEqual(['a'])
    expect(ids({ kind: 'smart', id: 'important' })).toEqual(['a'])
    expect(ids({ kind: 'smart', id: 'planned' })).toEqual(['b'])
    expect(ids({ kind: 'smart', id: 'mytasks' })).toEqual(['a', 'b'])
    expect(ids({ kind: 'smart', id: 'all' })).toEqual(['a', 'b', 'd'])
    expect(ids({ kind: 'smart', id: 'flagged' })).toEqual(['e'])
    expect(buildView(tasks, plans, { kind: 'smart', id: 'completed' }, 'default', '').completed.map((t) => t.id)).toEqual(['c'])
  })

  it('counts only open tasks and never counts the Completed list', () => {
    expect(openCount(tasks, { kind: 'list', planId: 'personal', listId: 'todo' })).toBe(2)
    expect(openCount(tasks, { kind: 'smart', id: 'completed' })).toBe(0)
  })

  it('new tasks inherit the smart list they were added from', () => {
    expect(addDefaults({ kind: 'smart', id: 'myday' })).toEqual({ myDay: true })
    expect(addDefaults({ kind: 'smart', id: 'important' })).toEqual({ important: true })
    expect(addDefaults({ kind: 'smart', id: 'planned' })).toEqual({ dueDate: 'today' })
    expect(addDefaults({ kind: 'list', planId: 'p', listId: 'l' })).toEqual({})
  })
})

describe('search', () => {
  const tasks = [
    task({ id: 'slides', title: 'Quarterly slides', labels: ['category5'] }),
    task({ id: 'red', title: 'Pay bill', labels: ['category2'] }),
    task({ id: 'plain', title: 'Quarterly taxes' }),
  ]
  const search = (q: string) => buildView(tasks, plans, { kind: 'smart', id: 'myday' }, 'default', q).open.map((t) => t.id).sort()

  it('parses words and #tags', () => {
    expect(parseSearch('  #Work  slides ')).toEqual({ text: ['slides'], tags: ['work'] })
  })
  it('searches across everything, not just the current view', () => {
    expect(search('quarterly')).toEqual(['plain', 'slides'])
  })
  it('matches custom label names and colour names by prefix', () => {
    expect(search('#work')).toEqual(['slides'])
    expect(search('#re')).toEqual(['red'])
    expect(search('#work taxes')).toEqual([])
  })
})

describe('sorting', () => {
  const tasks = [
    task({ id: 'b', title: 'banana', createdAt: '2026-11-02T00:00:00Z', dueDate: '2026-11-30' }),
    task({ id: 'a', title: 'Apple', createdAt: '2026-11-03T00:00:00Z', important: true }),
    task({ id: 'c', title: 'cherry', createdAt: '2026-11-01T00:00:00Z', dueDate: '2026-11-23' }),
  ]
  const order = (s: Parameters<typeof buildView>[3]) =>
    buildView(tasks, plans, { kind: 'smart', id: 'all' }, s, '').open.map((t) => t.id)
  it('supports each sort mode', () => {
    expect(order('default')).toEqual(['a', 'b', 'c'])
    expect(order('alphabetical')).toEqual(['a', 'b', 'c'])
    expect(order('dueDate')).toEqual(['c', 'b', 'a'])
    expect(order('importance')[0]).toBe('a')
    expect(order('created')).toEqual(['c', 'b', 'a'])
  })
})

describe('overview', () => {
  it('describes a single important My Day task like the mock-up', () => {
    const o = buildOverview([task({ id: 'Test123', title: 'Test123', important: true, myDay: true })], TODAY)
    expect(o.summary).toBe(
      'You have 1 open task, which is marked important and is in My Day. There are no flagged emails, and nothing is overdue or due today.',
    )
    expect(o.picks).toHaveLength(1)
    expect(o.picks[0].reason).toBe(
      'Tackle this first today because it is your only open item, is marked important and is in My Day.',
    )
  })

  it('ranks overdue above due today above important', () => {
    const o = buildOverview(
      [
        task({ id: 'imp', important: true }),
        task({ id: 'today', dueDate: TODAY }),
        task({ id: 'late', dueDate: '2026-11-20' }),
        task({ id: 'meh' }),
        task({ id: 'mail', source: 'email', from: 'Legal' }),
      ],
      TODAY,
    )
    expect(o.picks.map((p) => p.task.id)).toEqual(['late', 'today', 'imp'])
    expect(o.summary).toContain('1 flagged email')
    expect(o.summary).toContain('1 overdue and 1 due today need attention')
  })

  it('handles an empty day', () => {
    expect(buildOverview([], TODAY).picks).toEqual([])
  })

  it('suggests tasks for My Day that are not already in it', () => {
    const s = suggestions(
      [task({ id: 'in', myDay: true, important: true }), task({ id: 'soon', dueDate: '2026-11-23' }), task({ id: 'no' })],
      TODAY,
    )
    expect(s.map((x) => [x.task.id, x.why])).toEqual([['soon', 'Due soon']])
  })
})
