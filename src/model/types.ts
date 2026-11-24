/** Simple mode = only your private plan. Full mode = every plan you can see. */
export type Mode = 'simple' | 'full'

export type SmartListId =
  | 'myday'
  | 'mytasks'
  | 'important'
  | 'planned'
  | 'all'
  | 'completed'
  | 'flagged'

/** What the main pane is showing: a smart list, a bucket ("list") or a whole plan. */
export type ViewRef =
  | { kind: 'smart'; id: SmartListId }
  | { kind: 'list'; planId: string; listId: string }
  | { kind: 'plan'; planId: string }

export type SortMode = 'default' | 'importance' | 'dueDate' | 'alphabetical' | 'created'

export interface Plan {
  id: string
  title: string
  /** The private plan the app was set up with. */
  personal: boolean
  /** Planner label names keyed by category ("category1" … "category25"). */
  labels: Record<string, string>
  etag?: string
  detailsEtag?: string
}

/** A list in the sidebar maps to a Planner bucket. */
export interface TaskList {
  id: string
  planId: string
  name: string
  orderHint?: string
  etag?: string
}

export interface Task {
  id: string
  source: 'planner' | 'email'
  planId: string
  listId: string
  title: string
  completed: boolean
  completedAt?: string
  /** Local calendar date, yyyy-mm-dd. */
  dueDate?: string
  important: boolean
  myDay: boolean
  /** Planner category keys, e.g. ["category2"]. */
  labels: string[]
  hasNotes: boolean
  stepCount: number
  stepsDone: number
  assignedToMe: boolean
  createdAt: string
  orderHint?: string
  etag?: string
  /** Flagged emails: link to open the message in Outlook. */
  webLink?: string
  /** Flagged emails: sender name. */
  from?: string
}

export interface Step {
  id: string
  title: string
  done: boolean
  orderHint?: string
}

export interface TaskDetails {
  taskId: string
  notes: string
  steps: Step[]
  etag?: string
}

export interface Snapshot {
  me: { id: string; name: string }
  plans: Plan[]
  lists: TaskList[]
  tasks: Task[]
  /** Set when the flagged-email feed could not be loaded (e.g. missing consent). */
  emailError?: string
}

export interface NewTask {
  title: string
  planId: string
  listId: string
  myDay?: boolean
  important?: boolean
  dueDate?: string
}

export type TaskPatch = Partial<
  Pick<Task, 'title' | 'completed' | 'dueDate' | 'important' | 'myDay' | 'labels' | 'listId'>
>

export interface DetailsPatch {
  notes?: string
  /** Full desired list of steps; the backend works out the diff. */
  steps?: Step[]
}

/** Planner's fixed label colours, category1 … category25. */
export const LABEL_COLORS: { name: string; color: string }[] = [
  { name: 'Pink', color: '#e8609e' },
  { name: 'Red', color: '#d13438' },
  { name: 'Yellow', color: '#d6a400' },
  { name: 'Green', color: '#3b9c3b' },
  { name: 'Blue', color: '#2f7fd8' },
  { name: 'Purple', color: '#8b59c4' },
  { name: 'Bronze', color: '#a8673a' },
  { name: 'Lime', color: '#7fb800' },
  { name: 'Aqua', color: '#1fa8b8' },
  { name: 'Gray', color: '#7a7a7a' },
  { name: 'Silver', color: '#a6adb4' },
  { name: 'Brown', color: '#7a4b2a' },
  { name: 'Cranberry', color: '#b0154a' },
  { name: 'Orange', color: '#e8711a' },
  { name: 'Peach', color: '#f29a7a' },
  { name: 'Marigold', color: '#f0b400' },
  { name: 'Light green', color: '#8ccf6b' },
  { name: 'Dark green', color: '#1e6b2e' },
  { name: 'Teal', color: '#00837b' },
  { name: 'Light blue', color: '#6cb4ee' },
  { name: 'Dark blue', color: '#1b3f8c' },
  { name: 'Lavender', color: '#a99ad8' },
  { name: 'Plum', color: '#6e2a6a' },
  { name: 'Light gray', color: '#c2c2c2' },
  { name: 'Dark gray', color: '#4a4a4a' },
]

export function labelInfo(plan: Plan | undefined, key: string) {
  const index = Number(key.replace('category', '')) - 1
  const base = LABEL_COLORS[index] ?? { name: key, color: '#888' }
  const custom = plan?.labels[key]?.trim()
  return { key, name: custom || base.name, color: base.color }
}
