import { toLocalDate } from '../model/dates'
import type { DetailsPatch, Mode, NewTask, Plan, Snapshot, Task, TaskDetails, TaskList, TaskPatch } from '../model/types'
import type { Backend, ImportProgress } from './backend'
import { SetupRequiredError } from './backend'
import { GRAPH_BETA, GRAPH_V1, GraphClient, GraphError } from './graphClient'
import {
  checklistPatch,
  emailPatch,
  type GraphBucket,
  type GraphMessage,
  type GraphPlan,
  type GraphPlanDetails,
  type GraphPlannerTask,
  type GraphTaskDetails,
  type GraphTodoTask,
  type MapContext,
  mapBucket,
  mapDetails,
  mapEmail,
  mapPlan,
  mapPlannerTask,
  plannerTaskPatch,
  PRIORITY_IMPORTANT,
  PRIORITY_MEDIUM,
  sortByOrderHint,
  todoToPlanner,
} from './graphMapping'

const PLAN_KEY = 'todo2.personalPlanId'
export const DEFAULT_PLAN_TITLE = 'Personal ToDo'
export const DEFAULT_LIST_NAME = 'To do'

export interface PlanChoice {
  id: string
  title: string
  kind: 'personal' | 'group'
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return out
}

export class GraphBackend implements Backend {
  readonly kind = 'graph' as const
  private me: { id: string; name: string } | null = null

  constructor(
    private client: GraphClient,
    private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage,
    private now: () => Date = () => new Date(),
  ) {}

  /* ---------- personal plan setup ---------- */

  get personalPlanId(): string | null {
    return this.storage.getItem(PLAN_KEY)
  }

  usePlan(planId: string) {
    this.storage.setItem(PLAN_KEY, planId)
  }

  forgetPlan() {
    this.storage.removeItem(PLAN_KEY)
  }

  private async whoAmI() {
    if (!this.me) {
      const u = await this.client.get<{ id: string; displayName: string }>(`${GRAPH_V1}/me?$select=id,displayName`)
      this.me = { id: u.id, name: u.displayName }
    }
    return this.me
  }

  /** Plans the user could use as their personal plan: private (roster) plans first, then group plans. */
  async listPlanChoices(): Promise<PlanChoice[]> {
    const [roster, group] = await Promise.all([
      this.client.getAll<GraphPlan>(`${GRAPH_BETA}/me/planner/rosterPlans`).catch(() => [] as GraphPlan[]),
      this.client.getAll<GraphPlan>(`${GRAPH_V1}/me/planner/plans`).catch(() => [] as GraphPlan[]),
    ])
    const seen = new Set<string>()
    const out: PlanChoice[] = []
    for (const p of roster) if (!seen.has(p.id)) seen.add(p.id), out.push({ id: p.id, title: p.title, kind: 'personal' })
    for (const p of group) if (!seen.has(p.id)) seen.add(p.id), out.push({ id: p.id, title: p.title, kind: 'group' })
    return out
  }

  /**
   * Creates a private plan: a Planner roster with only you in it, a plan inside it and a first list.
   * Nobody else can see a roster plan unless you add them.
   */
  async createPersonalPlan(title = DEFAULT_PLAN_TITLE): Promise<string> {
    const me = await this.whoAmI()
    const roster = await this.client.request<{ id: string }>(`${GRAPH_BETA}/planner/rosters`, {
      method: 'POST',
      body: { '@odata.type': '#microsoft.graph.plannerRoster' },
    })
    try {
      await this.client.request(`${GRAPH_BETA}/planner/rosters/${roster.id}/members`, {
        method: 'POST',
        body: { '@odata.type': '#microsoft.graph.plannerRosterMember', userId: me.id },
      })
    } catch (e) {
      // The creator can already be a member; anything other than a conflict is a real failure.
      if (!(e instanceof GraphError && (e.status === 409 || e.status === 400))) throw e
    }
    const plan = await this.client.request<GraphPlan>(`${GRAPH_BETA}/planner/plans`, {
      method: 'POST',
      body: {
        title,
        container: { url: `${GRAPH_BETA}/planner/rosters/${roster.id}` },
      },
    })
    await this.client.request(`${GRAPH_BETA}/planner/buckets`, {
      method: 'POST',
      body: { name: DEFAULT_LIST_NAME, planId: plan.id, orderHint: ' !' },
    })
    this.usePlan(plan.id)
    return plan.id
  }

  /* ---------- loading ---------- */

  private ctx(meId: string): MapContext {
    const now = this.now()
    return { meId, today: toLocalDate(now), todayUtc: now.toISOString().slice(0, 10) }
  }

  private async loadPlan(planId: string, personal: boolean, ctx: MapContext) {
    const [plan, details, buckets, tasks] = await Promise.all([
      this.client.get<GraphPlan>(`${GRAPH_BETA}/planner/plans/${planId}`),
      this.client.get<GraphPlanDetails>(`${GRAPH_BETA}/planner/plans/${planId}/details`),
      this.client.getAll<GraphBucket>(`${GRAPH_BETA}/planner/plans/${planId}/buckets`),
      this.client.getAll<GraphPlannerTask>(`${GRAPH_BETA}/planner/plans/${planId}/tasks`),
    ])
    return {
      plan: mapPlan(plan, details, personal),
      lists: sortByOrderHint(buckets).map(mapBucket),
      tasks: tasks.map((t) => mapPlannerTask(t, ctx)),
    }
  }

  private async loadFlaggedEmails(): Promise<Task[]> {
    const select = 'id,subject,from,webLink,receivedDateTime,importance,flag'
    const filter = encodeURIComponent("flag/flagStatus eq 'flagged'")
    const msgs = await this.client.get<{ value: GraphMessage[] }>(
      `${GRAPH_V1}/me/messages?$filter=${filter}&$select=${select}&$top=100`,
    )
    return msgs.value.map(mapEmail)
  }

  async load(mode: Mode): Promise<Snapshot> {
    const personalId = this.personalPlanId
    if (!personalId) throw new SetupRequiredError()
    const me = await this.whoAmI()
    const ctx = this.ctx(me.id)

    let others: string[] = []
    if (mode === 'full') {
      const choices = await this.listPlanChoices()
      others = choices.map((c) => c.id).filter((id) => id !== personalId)
    }

    let emailError: string | undefined
    const [personal, rest, emails] = await Promise.all([
      this.loadPlan(personalId, true, ctx).catch((e) => {
        if (e instanceof GraphError && (e.status === 404 || e.status === 403)) {
          // The plan was deleted or access was lost: go back to setup.
          this.forgetPlan()
          throw new SetupRequiredError()
        }
        throw e
      }),
      mapLimit(others, 4, (id) => this.loadPlan(id, false, ctx).catch(() => null)),
      this.loadFlaggedEmails().catch((e: Error) => {
        emailError = e.message
        return [] as Task[]
      }),
    ])

    const loaded = [personal, ...rest.filter((x) => x !== null)]
    return {
      me,
      plans: loaded.map((l) => l.plan),
      lists: loaded.flatMap((l) => l.lists),
      tasks: [...loaded.flatMap((l) => l.tasks), ...emails],
      emailError,
    }
  }

  /* ---------- tasks ---------- */

  private async refetchTask(id: string): Promise<GraphPlannerTask> {
    return this.client.get<GraphPlannerTask>(`${GRAPH_BETA}/planner/tasks/${id}`)
  }

  /** PATCH with If-Match; on a 412 (someone else changed it) fetch the new etag and try once more. */
  private async patchTask(task: Task, body: Record<string, unknown>): Promise<GraphPlannerTask> {
    const url = `${GRAPH_BETA}/planner/tasks/${task.id}`
    try {
      return await this.client.request<GraphPlannerTask>(url, { method: 'PATCH', body, etag: task.etag ?? '*' })
    } catch (e) {
      if (!(e instanceof GraphError && e.status === 412)) throw e
      const fresh = await this.refetchTask(task.id)
      return this.client.request<GraphPlannerTask>(url, { method: 'PATCH', body, etag: fresh['@odata.etag'] })
    }
  }

  async createTask(input: NewTask): Promise<Task> {
    const me = await this.whoAmI()
    const created = await this.client.request<GraphPlannerTask>(`${GRAPH_BETA}/planner/tasks`, {
      method: 'POST',
      body: {
        planId: input.planId,
        bucketId: input.listId,
        title: input.title,
        priority: input.important ? PRIORITY_IMPORTANT : PRIORITY_MEDIUM,
        ...(input.dueDate ? { dueDateTime: `${input.dueDate}T12:00:00Z` } : {}),
        assignments: { [me.id]: { '@odata.type': '#microsoft.graph.plannerAssignment', orderHint: ' !' } },
      },
    })
    let task = mapPlannerTask(created, this.ctx(me.id))
    if (input.myDay) task = await this.updateTask(task, { myDay: true })
    return task
  }

  async updateTask(task: Task, patch: TaskPatch): Promise<Task> {
    const me = await this.whoAmI()
    if (task.source === 'email') {
      const body = emailPatch(patch)
      if (body) await this.client.request(`${GRAPH_V1}/me/messages/${task.id}`, { method: 'PATCH', body })
      return {
        ...task,
        ...(patch.completed !== undefined
          ? { completed: patch.completed, completedAt: patch.completed ? this.now().toISOString() : undefined }
          : {}),
        ...(patch.important !== undefined ? { important: patch.important } : {}),
      }
    }
    const body = plannerTaskPatch(task, patch)
    let updated = await this.patchTask(task, body)
    // Some tenants answer 204 even when asked for the representation.
    if (!updated) updated = await this.refetchTask(task.id)
    const mapped = mapPlannerTask(updated, this.ctx(me.id))
    // isOnMyDayLastModifiedDate can lag a moment behind; trust what was just set.
    if (patch.myDay !== undefined) mapped.myDay = patch.myDay
    return mapped
  }

  async deleteTask(task: Task): Promise<void> {
    if (task.source === 'email') {
      await this.client.request(`${GRAPH_V1}/me/messages/${task.id}`, {
        method: 'PATCH',
        body: { flag: { flagStatus: 'notFlagged' } },
      })
      return
    }
    const fresh = await this.refetchTask(task.id)
    await this.client.request(`${GRAPH_BETA}/planner/tasks/${task.id}`, {
      method: 'DELETE',
      etag: fresh['@odata.etag'],
    })
  }

  async getDetails(task: Task): Promise<TaskDetails> {
    if (task.source === 'email') return { taskId: task.id, notes: '', steps: [] }
    const raw = await this.client.get<GraphTaskDetails>(`${GRAPH_BETA}/planner/tasks/${task.id}/details`)
    return mapDetails(raw)
  }

  async updateDetails(task: Task, details: TaskDetails, patch: DetailsPatch): Promise<TaskDetails> {
    const url = `${GRAPH_BETA}/planner/tasks/${task.id}/details`
    const send = async (base: TaskDetails) => {
      const body: Record<string, unknown> = {}
      if (patch.notes !== undefined) body.description = patch.notes
      if (patch.steps) body.checklist = checklistPatch(base.steps, patch.steps)
      return this.client.request<GraphTaskDetails>(url, { method: 'PATCH', body, etag: base.etag ?? '*' })
    }
    let raw: GraphTaskDetails | undefined
    try {
      raw = await send(details)
    } catch (e) {
      if (!(e instanceof GraphError && e.status === 412)) throw e
      raw = await send(await this.getDetails(task))
    }
    return raw ? mapDetails(raw) : this.getDetails(task)
  }

  /* ---------- lists (buckets) and labels ---------- */

  async createList(planId: string, name: string): Promise<TaskList> {
    const b = await this.client.request<GraphBucket>(`${GRAPH_BETA}/planner/buckets`, {
      method: 'POST',
      // Append after the existing buckets.
      body: { name, planId, orderHint: ' !' },
    })
    return mapBucket(b)
  }

  async renameList(list: TaskList, name: string): Promise<TaskList> {
    const b = await this.client.request<GraphBucket>(`${GRAPH_BETA}/planner/buckets/${list.id}`, {
      method: 'PATCH',
      body: { name },
      etag: list.etag ?? '*',
    })
    return b ? mapBucket(b) : { ...list, name }
  }

  async deleteList(list: TaskList): Promise<void> {
    const fresh = await this.client.get<GraphBucket>(`${GRAPH_BETA}/planner/buckets/${list.id}`)
    await this.client.request(`${GRAPH_BETA}/planner/buckets/${list.id}`, {
      method: 'DELETE',
      etag: fresh['@odata.etag'],
    })
  }

  async renameLabel(plan: Plan, key: string, name: string): Promise<Plan> {
    const url = `${GRAPH_BETA}/planner/plans/${plan.id}/details`
    const fresh = await this.client.get<GraphPlanDetails>(url)
    const updated = await this.client.request<GraphPlanDetails>(url, {
      method: 'PATCH',
      body: { categoryDescriptions: { [key]: name } },
      etag: fresh['@odata.etag'],
    })
    return { ...plan, labels: { ...plan.labels, [key]: name }, detailsEtag: updated?.['@odata.etag'] }
  }

  /* ---------- one-off import from Microsoft To Do ---------- */

  async importFromToDo(planId: string, onProgress: (p: ImportProgress) => void): Promise<number> {
    const me = await this.whoAmI()
    const lists = (
      await this.client.getAll<{ id: string; displayName: string; wellknownListName?: string }>(`${GRAPH_V1}/me/todo/lists`)
    ).filter((l) => l.wellknownListName !== 'flaggedEmails')

    const perList = await mapLimit(lists, 2, async (l) => ({
      list: l,
      tasks: await this.client.getAll<GraphTodoTask>(
        `${GRAPH_V1}/me/todo/lists/${l.id}/tasks?$expand=checklistItems`,
        { Prefer: 'outlook.body-content-type="text"' },
      ),
    }))
    const total = perList.reduce((n, x) => n + x.tasks.length, 0)
    let done = 0
    onProgress({ done, total })

    for (const { list, tasks } of perList) {
      if (tasks.length === 0) continue
      const name = list.wellknownListName === 'defaultList' ? 'Tasks (imported)' : list.displayName
      const bucket = await this.createList(planId, name.slice(0, 255))
      for (const t of tasks) {
        onProgress({ done, total, current: t.title })
        const conv = todoToPlanner(t, planId, bucket.id, me.id)
        let created = await this.client.request<GraphPlannerTask>(`${GRAPH_BETA}/planner/tasks`, {
          method: 'POST',
          body: conv.task,
        })
        if (conv.description || conv.steps.length) {
          const mapped = mapPlannerTask(created, this.ctx(me.id))
          const details = await this.getDetails(mapped)
          await this.updateDetails(mapped, details, {
            ...(conv.description ? { notes: conv.description } : {}),
            ...(conv.steps.length ? { steps: conv.steps } : {}),
          })
          created = await this.refetchTask(created.id)
        }
        if (conv.completed) {
          await this.client.request(`${GRAPH_BETA}/planner/tasks/${created.id}`, {
            method: 'PATCH',
            body: { percentComplete: 100 },
            etag: created['@odata.etag'],
          })
        }
        done++
      }
    }
    onProgress({ done, total })
    return done
  }
}
