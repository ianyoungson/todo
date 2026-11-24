import { useCallback, useEffect, useRef, useState } from 'react'
import { SetupRequiredError, type Backend } from './data/backend'
import { toLocalDate } from './model/dates'
import type { DetailsPatch, Mode, NewTask, Plan, Snapshot, Task, TaskDetails, TaskList, TaskPatch } from './model/types'

export type LoadState = 'loading' | 'ready' | 'setup' | 'error'

export function useStore(backend: Backend | null, mode: Mode) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const snapRef = useRef(snap)
  snapRef.current = snap

  const reload = useCallback(async () => {
    if (!backend) return
    try {
      const s = await backend.load(mode)
      setSnap(s)
      setState('ready')
      setError(null)
    } catch (e) {
      if (e instanceof SetupRequiredError) setState('setup')
      else {
        setError((e as Error).message)
        setState('error')
      }
    }
  }, [backend, mode])

  useEffect(() => {
    setState('loading')
    void reload()
  }, [reload])

  // Refresh when the tab comes back into focus, and at midnight so My Day starts empty.
  useEffect(() => {
    let day = toLocalDate(new Date())
    const onFocus = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    const tick = setInterval(() => {
      const now = toLocalDate(new Date())
      if (now !== day) {
        day = now
        void reload()
      }
    }, 60_000)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [reload])

  const fail = useCallback((e: unknown) => {
    setToast((e as Error).message || 'Something went wrong')
  }, [])

  const replaceTask = (id: string, t: Task | null) =>
    setSnap((s) =>
      s ? { ...s, tasks: t ? s.tasks.map((x) => (x.id === id ? t : x)) : s.tasks.filter((x) => x.id !== id) } : s,
    )

  const updateTask = useCallback(
    async (task: Task, patch: TaskPatch) => {
      if (!backend) return
      const optimistic: Task = {
        ...task,
        ...patch,
        ...(patch.completed !== undefined
          ? { completedAt: patch.completed ? new Date().toISOString() : undefined }
          : {}),
      }
      replaceTask(task.id, optimistic)
      try {
        replaceTask(task.id, await backend.updateTask(task, patch))
      } catch (e) {
        replaceTask(task.id, task)
        fail(e)
      }
    },
    [backend, fail],
  )

  const createTask = useCallback(
    async (input: NewTask) => {
      if (!backend) return
      const tempId = 'tmp-' + Math.random().toString(36).slice(2)
      const temp: Task = {
        id: tempId,
        source: 'planner',
        planId: input.planId,
        listId: input.listId,
        title: input.title,
        completed: false,
        important: !!input.important,
        myDay: !!input.myDay,
        dueDate: input.dueDate,
        labels: [],
        hasNotes: false,
        stepCount: 0,
        stepsDone: 0,
        assignedToMe: true,
        createdAt: new Date().toISOString(),
      }
      setSnap((s) => (s ? { ...s, tasks: [temp, ...s.tasks] } : s))
      try {
        replaceTask(tempId, await backend.createTask(input))
      } catch (e) {
        replaceTask(tempId, null)
        fail(e)
      }
    },
    [backend, fail],
  )

  const deleteTask = useCallback(
    async (task: Task) => {
      if (!backend) return
      replaceTask(task.id, null)
      try {
        await backend.deleteTask(task)
      } catch (e) {
        setSnap((s) => (s ? { ...s, tasks: [...s.tasks, task] } : s))
        fail(e)
      }
    },
    [backend, fail],
  )

  /** Saves notes/steps and mirrors the counts onto the task row. */
  const updateDetails = useCallback(
    async (task: Task, details: TaskDetails, patch: DetailsPatch): Promise<TaskDetails | null> => {
      if (!backend) return null
      try {
        const next = await backend.updateDetails(task, details, patch)
        const current = snapRef.current?.tasks.find((t) => t.id === task.id) ?? task
        replaceTask(task.id, {
          ...current,
          hasNotes: next.notes.trim().length > 0,
          stepCount: next.steps.length,
          stepsDone: next.steps.filter((s) => s.done).length,
          // Writing details changes the task's etag in Planner.
          etag: backend.kind === 'graph' ? undefined : current.etag,
        })
        return next
      } catch (e) {
        fail(e)
        return null
      }
    },
    [backend, fail],
  )

  const createList = useCallback(
    async (planId: string, name: string): Promise<TaskList | null> => {
      if (!backend) return null
      try {
        const l = await backend.createList(planId, name)
        setSnap((s) => (s ? { ...s, lists: [...s.lists, l] } : s))
        return l
      } catch (e) {
        fail(e)
        return null
      }
    },
    [backend, fail],
  )

  const renameList = useCallback(
    async (list: TaskList, name: string) => {
      if (!backend) return
      try {
        const l = await backend.renameList(list, name)
        setSnap((s) => (s ? { ...s, lists: s.lists.map((x) => (x.id === l.id ? l : x)) } : s))
      } catch (e) {
        fail(e)
      }
    },
    [backend, fail],
  )

  const deleteList = useCallback(
    async (list: TaskList) => {
      if (!backend) return
      try {
        await backend.deleteList(list)
        setSnap((s) =>
          s ? { ...s, lists: s.lists.filter((x) => x.id !== list.id), tasks: s.tasks.filter((t) => t.listId !== list.id) } : s,
        )
      } catch (e) {
        fail(e)
      }
    },
    [backend, fail],
  )

  const renameLabel = useCallback(
    async (plan: Plan, key: string, name: string) => {
      if (!backend) return
      try {
        const p = await backend.renameLabel(plan, key, name)
        setSnap((s) => (s ? { ...s, plans: s.plans.map((x) => (x.id === p.id ? p : x)) } : s))
      } catch (e) {
        fail(e)
      }
    },
    [backend, fail],
  )

  return {
    snap,
    state,
    error,
    toast,
    clearToast: () => setToast(null),
    reload,
    updateTask,
    createTask,
    deleteTask,
    updateDetails,
    createList,
    renameList,
    deleteList,
    renameLabel,
  }
}

export type Store = ReturnType<typeof useStore>
