import { addDays, toLocalDate } from '../model/dates'
import type {
  DetailsPatch,
  Mode,
  NewTask,
  Plan,
  Snapshot,
  Step,
  Task,
  TaskDetails,
  TaskList,
  TaskPatch,
} from '../model/types'
import type { Backend } from './backend'

/** What is persisted per task. My Day is stored as the date it was added, so it clears overnight. */
interface StoredTask extends Omit<Task, 'myDay' | 'hasNotes' | 'stepCount' | 'stepsDone'> {
  myDayDate?: string
  notes: string
  steps: Step[]
}

interface State {
  version: 1
  plans: Plan[]
  lists: TaskList[]
  tasks: StoredTask[]
}

const KEY = 'todo2.local.v1'

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function demoState(now = new Date()): State {
  const today = toLocalDate(now)
  const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86400000).toISOString()
  const base = { assignedToMe: true, labels: [] as string[], completed: false, important: false }
  const t = (p: Partial<StoredTask> & Pick<StoredTask, 'id' | 'title' | 'planId' | 'listId'>): StoredTask => ({
    ...base,
    source: 'planner',
    createdAt: iso(1),
    notes: '',
    steps: [],
    ...p,
  })
  return {
    version: 1,
    plans: [
      { id: 'personal', title: 'Personal ToDo', personal: true, labels: { category2: '', category4: 'Home', category5: 'Work' } },
      { id: 'launch', title: 'Website relaunch', personal: false, labels: { category1: 'Design', category14: 'Blocked' } },
    ],
    lists: [
      { id: 'todo', planId: 'personal', name: 'To do' },
      { id: 'imported', planId: 'personal', name: 'Importiert' },
      { id: 'l-backlog', planId: 'launch', name: 'Backlog' },
      { id: 'l-doing', planId: 'launch', name: 'In progress' },
    ],
    tasks: [
      t({ id: 't1', title: 'Renew passport', planId: 'personal', listId: 'todo', important: true, myDayDate: today, labels: ['category2'], notes: 'Photo booth at the station takes card only.', createdAt: iso(0.2) }),
      t({ id: 't2', title: 'Book dentist appointment', planId: 'personal', listId: 'todo', dueDate: addDays(today, 1), labels: ['category4'], createdAt: iso(0.5) }),
      t({ id: 't3', title: 'Prepare quarterly review slides', planId: 'personal', listId: 'todo', dueDate: today, important: true, labels: ['category5'], steps: [
        { id: 's1', title: 'Pull numbers from finance', done: true },
        { id: 's2', title: 'Draft storyline', done: false },
        { id: 's3', title: 'Dry run with Sam', done: false },
      ], createdAt: iso(2) }),
      t({ id: 't4', title: 'Water the plants', planId: 'personal', listId: 'todo', completed: true, completedAt: iso(0.1), myDayDate: today, labels: ['category4'], createdAt: iso(3) }),
      t({ id: 't5', title: 'Old shopping list', planId: 'personal', listId: 'imported', notes: 'Imported from Microsoft To Do.', steps: [
        { id: 's4', title: 'Milk', done: false },
        { id: 's5', title: 'Coffee beans', done: true },
      ], createdAt: iso(20) }),
      t({ id: 't6', title: 'Review homepage mock-ups', planId: 'launch', listId: 'l-doing', dueDate: addDays(today, -1), labels: ['category1'], createdAt: iso(4) }),
      t({ id: 't7', title: 'Write launch announcement', planId: 'launch', listId: 'l-backlog', assignedToMe: false, createdAt: iso(5) }),
      t({ id: 'e1', source: 'email', title: 'Contract renewal – please sign by Friday', planId: '', listId: 'flagged', from: 'Legal team', webLink: 'https://outlook.office.com/mail/', createdAt: iso(1.5) }),
    ],
  }
}

export class LocalBackend implements Backend {
  readonly kind = 'local' as const
  private state: State

  constructor(
    private storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage(),
    private now: () => Date = () => new Date(),
  ) {
    this.state = this.read() ?? demoState(now())
    this.save()
  }

  private read(): State | null {
    try {
      const raw = this.storage?.getItem(KEY)
      const parsed = raw ? (JSON.parse(raw) as State) : null
      return parsed?.version === 1 ? parsed : null
    } catch {
      return null
    }
  }

  private save() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.state))
    } catch {
      /* storage full or blocked: keep working in memory */
    }
  }

  private today() {
    return toLocalDate(this.now())
  }

  private view(s: StoredTask): Task {
    const { myDayDate, notes, steps, ...rest } = s
    return {
      ...rest,
      myDay: myDayDate === this.today(),
      hasNotes: notes.trim().length > 0,
      stepCount: steps.length,
      stepsDone: steps.filter((x) => x.done).length,
    }
  }

  private find(id: string): StoredTask {
    const t = this.state.tasks.find((x) => x.id === id)
    if (!t) throw new Error('Task not found')
    return t
  }

  async load(_mode: Mode): Promise<Snapshot> {
    return {
      me: { id: 'me', name: 'Demo user' },
      plans: structuredClone(this.state.plans),
      lists: structuredClone(this.state.lists),
      tasks: this.state.tasks.map((t) => this.view(t)),
    }
  }

  async createTask(input: NewTask): Promise<Task> {
    const t: StoredTask = {
      id: uid(),
      source: 'planner',
      planId: input.planId,
      listId: input.listId,
      title: input.title,
      completed: false,
      important: !!input.important,
      dueDate: input.dueDate,
      myDayDate: input.myDay ? this.today() : undefined,
      labels: [],
      assignedToMe: true,
      createdAt: this.now().toISOString(),
      notes: '',
      steps: [],
    }
    this.state.tasks.push(t)
    this.save()
    return this.view(t)
  }

  async updateTask(task: Task, patch: TaskPatch): Promise<Task> {
    const t = this.find(task.id)
    if (patch.title !== undefined) t.title = patch.title
    if (patch.important !== undefined) t.important = patch.important
    if ('dueDate' in patch) t.dueDate = patch.dueDate
    if (patch.labels) t.labels = [...patch.labels]
    if (patch.listId) t.listId = patch.listId
    if (patch.myDay !== undefined) t.myDayDate = patch.myDay ? this.today() : undefined
    if (patch.completed !== undefined) {
      t.completed = patch.completed
      t.completedAt = patch.completed ? this.now().toISOString() : undefined
    }
    this.save()
    return this.view(t)
  }

  async deleteTask(task: Task): Promise<void> {
    this.state.tasks = this.state.tasks.filter((t) => t.id !== task.id)
    this.save()
  }

  async getDetails(task: Task): Promise<TaskDetails> {
    if (task.source === 'email') return { taskId: task.id, notes: '', steps: [] }
    const t = this.find(task.id)
    return { taskId: t.id, notes: t.notes, steps: structuredClone(t.steps) }
  }

  async updateDetails(task: Task, _details: TaskDetails, patch: DetailsPatch): Promise<TaskDetails> {
    const t = this.find(task.id)
    if (patch.notes !== undefined) t.notes = patch.notes
    if (patch.steps) t.steps = patch.steps.map((s) => ({ ...s, id: s.id || uid() }))
    this.save()
    return this.getDetails(task)
  }

  async createList(planId: string, name: string): Promise<TaskList> {
    const list = { id: uid(), planId, name }
    this.state.lists.push(list)
    this.save()
    return list
  }

  async renameList(list: TaskList, name: string): Promise<TaskList> {
    const l = this.state.lists.find((x) => x.id === list.id)!
    l.name = name
    this.save()
    return { ...l }
  }

  async deleteList(list: TaskList): Promise<void> {
    this.state.lists = this.state.lists.filter((l) => l.id !== list.id)
    this.state.tasks = this.state.tasks.filter((t) => t.listId !== list.id)
    this.save()
  }

  async renameLabel(plan: Plan, key: string, name: string): Promise<Plan> {
    const p = this.state.plans.find((x) => x.id === plan.id)!
    p.labels = { ...p.labels, [key]: name }
    this.save()
    return structuredClone(p)
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function resetLocalData() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
