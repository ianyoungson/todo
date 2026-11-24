import type { DetailsPatch, Mode, NewTask, Plan, Snapshot, Task, TaskDetails, TaskList, TaskPatch } from '../model/types'

export interface ImportProgress {
  done: number
  total: number
  current?: string
}

export interface Backend {
  readonly kind: 'graph' | 'local'
  /** Loads plans, lists and tasks. Full mode also loads every other plan the user can see. */
  load(mode: Mode): Promise<Snapshot>
  createTask(input: NewTask): Promise<Task>
  updateTask(task: Task, patch: TaskPatch): Promise<Task>
  deleteTask(task: Task): Promise<void>
  getDetails(task: Task): Promise<TaskDetails>
  updateDetails(task: Task, details: TaskDetails, patch: DetailsPatch): Promise<TaskDetails>
  createList(planId: string, name: string): Promise<TaskList>
  renameList(list: TaskList, name: string): Promise<TaskList>
  deleteList(list: TaskList): Promise<void>
  renameLabel(plan: Plan, key: string, name: string): Promise<Plan>
  /** Copies Microsoft To Do lists into the personal plan. Optional. */
  importFromToDo?(planId: string, onProgress: (p: ImportProgress) => void): Promise<number>
}

/** Thrown by the Graph backend when the user has not picked or created their private plan yet. */
export class SetupRequiredError extends Error {
  constructor() {
    super('No personal plan is set up yet.')
  }
}
