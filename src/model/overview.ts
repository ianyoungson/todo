import { addDays } from './dates'
import type { Task } from './types'

export interface OverviewPick {
  task: Task
  reason: string
}

export interface Overview {
  taskCount: number
  emailCount: number
  summary: string
  picks: OverviewPick[]
}

function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]
}

function score(t: Task, today: string): number {
  let s = 0
  if (t.dueDate && t.dueDate < today) s += 60
  if (t.dueDate === today) s += 45
  if (t.dueDate === addDays(today, 1)) s += 12
  if (t.important) s += 30
  if (t.myDay) s += 20
  if (t.source === 'email') s += 15
  if (t.stepCount > 0 && t.stepsDone > 0) s += 5
  return s
}

function reasonsFor(t: Task, today: string): string[] {
  const r: string[] = []
  if (t.dueDate && t.dueDate < today) r.push('is overdue')
  else if (t.dueDate === today) r.push('is due today')
  else if (t.dueDate === addDays(today, 1)) r.push('is due tomorrow')
  if (t.important) r.push('is marked important')
  if (t.myDay) r.push('is in My Day')
  if (t.source === 'email') r.push(t.from ? `is a flagged email from ${t.from}` : 'is a flagged email')
  if (t.stepCount > 0 && t.stepsDone > 0 && t.stepsDone < t.stepCount)
    r.push(`is already ${t.stepsDone} of ${t.stepCount} steps in`)
  return r
}

/**
 * A short, deterministic summary of the day built from the task data alone.
 * Nothing leaves the browser to produce it.
 */
export function buildOverview(openTasks: Task[], today: string): Overview {
  const tasks = openTasks.filter((t) => !t.completed && t.source === 'planner')
  const emails = openTasks.filter((t) => !t.completed && t.source === 'email')
  const all = [...tasks, ...emails]

  const overdue = all.filter((t) => t.dueDate && t.dueDate < today).length
  const dueToday = all.filter((t) => t.dueDate === today).length
  const important = tasks.filter((t) => t.important).length
  const myDay = tasks.filter((t) => t.myDay).length

  let summary: string
  if (all.length === 0) {
    summary = 'Nothing is open. Add a task below or pick something from Suggestions.'
  } else {
    const facts: string[] = []
    if (tasks.length === 1) {
      const t = tasks[0]
      const traits = [t.important && 'marked important', t.myDay && 'in My Day'].filter(Boolean) as string[]
      facts.push(
        `You have 1 open task` + (traits.length ? `, which is ${traits.join(' and is ')}` : '') + '.',
      )
    } else {
      const parts = [
        important && `${important} marked important`,
        myDay && `${myDay} in My Day`,
      ].filter(Boolean) as string[]
      facts.push(`You have ${plural(tasks.length, 'open task')}` + (parts.length ? `: ${joinList(parts)}.` : '.'))
    }
    const mail = emails.length ? plural(emails.length, 'flagged email') : 'no flagged emails'
    const verb = emails.length === 1 ? 'is' : 'are'
    if (overdue || dueToday) {
      facts.push(`There ${verb} ${mail}.`)
      const d = [overdue && `${overdue} overdue`, dueToday && `${dueToday} due today`].filter(Boolean) as string[]
      facts.push(`${joinList(d).replace(/^./, (c) => c.toUpperCase())} need${overdue + dueToday === 1 ? 's' : ''} attention.`)
    } else {
      facts.push(`There ${verb} ${mail}, and nothing is overdue or due today.`)
    }
    summary = facts.join(' ')
  }

  const ranked = [...all]
    .map((t) => ({ t, s: score(t, today) }))
    .filter((x) => x.s > 0 || all.length === 1)
    .sort((a, b) => b.s - a.s || a.t.title.localeCompare(b.t.title))
    .slice(0, 3)

  const picks = ranked.map(({ t }, i) => {
    const r = reasonsFor(t, today)
    if (all.length === 1) r.unshift('is your only open item')
    const lead = i === 0 ? 'Tackle this first today' : i === 1 ? 'Next up' : 'Then'
    return { task: t, reason: r.length ? `${lead} because it ${joinList(r)}.` : `${lead}.` }
  })

  return { taskCount: tasks.length, emailCount: emails.length, summary, picks }
}

/** Open tasks worth adding to My Day: overdue, due soon, or important. */
export function suggestions(tasks: Task[], today: string): { task: Task; why: string }[] {
  const soon = addDays(today, 2)
  return tasks
    .filter((t) => !t.completed && !t.myDay && t.source === 'planner')
    .map((t) => {
      let why = ''
      if (t.dueDate && t.dueDate < today) why = 'Overdue'
      else if (t.dueDate === today) why = 'Due today'
      else if (t.dueDate && t.dueDate <= soon) why = 'Due soon'
      else if (t.important) why = 'Important'
      return { task: t, why, s: score(t, today) }
    })
    .filter((x) => x.why)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map(({ task, why }) => ({ task, why }))
}
