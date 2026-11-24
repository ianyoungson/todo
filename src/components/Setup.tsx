import { useEffect, useState } from 'react'
import type { AuthConfig } from '../data/auth'
import { DEFAULT_PLAN_TITLE, type GraphBackend, type PlanChoice } from '../data/graphBackend'
import * as I from './Icons'

export function Welcome({
  config,
  onSignIn,
  onSaveConfig,
  onDemo,
}: {
  config: AuthConfig | null
  onSignIn: () => void
  onSaveConfig: (c: AuthConfig) => void
  onDemo: () => void
}) {
  const [clientId, setClientId] = useState(config?.clientId ?? '')
  const [tenant, setTenant] = useState(config?.tenant ?? 'organizations')
  const [editing, setEditing] = useState(!config)
  const valid = /^[0-9a-f-]{36}$/i.test(clientId.trim())

  return (
    <div className="center-screen">
      <div className="setup-card glass">
        <span className="brand-logo big">
          <I.Logo size={44} />
        </span>
        <h1>ToDo 2.0</h1>
        <p className="lead">
          Works the way To Do did: My Day, Important, Planned, your own lists, steps and notes, and flagged emails as
          tasks. Your tasks live in a private Planner plan.
        </p>

        {editing ? (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault()
              if (valid) {
                onSaveConfig({ clientId: clientId.trim(), tenant: tenant.trim() || 'organizations' })
                setEditing(false)
              }
            }}
          >
            <label>
              App registration (client) ID
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
            </label>
            <label>
              Tenant
              <input value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="organizations or your tenant ID" />
            </label>
            <p className="muted small">
              Register a single-page app in Microsoft Entra ID with this page's address as the redirect URI and the
              delegated permissions User.Read, Tasks.ReadWrite and Mail.ReadWrite. See the README for the steps.
            </p>
            <button className="btn primary" disabled={!valid}>Save</button>
          </form>
        ) : (
          <>
            <button className="btn primary wide" onClick={onSignIn}>
              Sign in with Microsoft
            </button>
            <button className="link-btn" onClick={() => setEditing(true)}>
              Change app registration
            </button>
          </>
        )}

        <div className="or">or</div>
        <button className="btn wide" onClick={onDemo}>
          Try it with demo data
        </button>
        <p className="muted small">Demo data stays in this browser and never leaves the device.</p>
      </div>
    </div>
  )
}

export function PlanSetup({
  backend,
  onDone,
  onSignOut,
}: {
  backend: GraphBackend
  onDone: (created: boolean) => void
  onSignOut: () => void
}) {
  const [choices, setChoices] = useState<PlanChoice[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState(DEFAULT_PLAN_TITLE)

  useEffect(() => {
    backend.listPlanChoices().then(setChoices).catch((e: Error) => {
      setChoices([])
      setError(e.message)
    })
  }, [backend])

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      await backend.createPersonalPlan(title.trim() || DEFAULT_PLAN_TITLE)
      onDone(true)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const existing = choices?.filter((c) => c.kind === 'personal') ?? []
  const group = choices?.filter((c) => c.kind === 'group') ?? []

  return (
    <div className="center-screen">
      <div className="setup-card glass">
        <h1>Set up your plan</h1>
        <p className="lead">
          Your tasks are stored in a private Planner plan that only you are a member of. You do this once; every device
          you sign in on uses the same plan.
        </p>

        <div className="form">
          <label>
            Plan name
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <button className="btn primary wide" onClick={create} disabled={busy}>
            {busy ? 'Creating…' : 'Create my private plan'}
          </button>
        </div>

        {choices === null && <p className="muted small">Looking for plans you already have…</p>}
        {existing.length > 0 && (
          <div className="choice-group">
            <div className="nav-section">Or use one of your private plans</div>
            {existing.map((c) => (
              <button key={c.id} className="choice" onClick={() => (backend.usePlan(c.id), onDone(false))}>
                <I.Board size={16} /> {c.title}
              </button>
            ))}
          </div>
        )}
        {group.length > 0 && (
          <details className="choice-group">
            <summary className="nav-section">Use a shared group plan instead</summary>
            <p className="muted small">Everyone in the group can see tasks in these plans.</p>
            {group.map((c) => (
              <button key={c.id} className="choice" onClick={() => (backend.usePlan(c.id), onDone(false))}>
                <I.Board size={16} /> {c.title}
              </button>
            ))}
          </details>
        )}
        {error && <p className="error">{error}</p>}
        <button className="link-btn" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  )
}
