import { useState } from 'react'
import type { Backend, ImportProgress } from '../data/backend'
import { LABEL_COLORS, labelInfo, type Plan, type TaskList } from '../model/types'
import type { Store } from '../useStore'
import * as I from './Icons'

export type Look = 'fresh' | 'classic'
export type Scheme = 'system' | 'light' | 'dark'

export function ThemeMenu({
  look,
  scheme,
  onLook,
  onScheme,
  onClose,
}: {
  look: Look
  scheme: Scheme
  onLook: (l: Look) => void
  onScheme: (s: Scheme) => void
  onClose: () => void
}) {
  return (
    <div className="popover glass theme-menu" role="dialog" aria-label="Appearance">
      <div className="popover-head">
        <strong>Appearance</strong>
        <button className="icon-btn tiny" onClick={onClose} aria-label="Close">
          <I.Close size={14} />
        </button>
      </div>
      <div className="look-grid">
        {(['fresh', 'classic'] as Look[]).map((l) => (
          <button key={l} className={'look' + (look === l ? ' on' : '')} onClick={() => onLook(l)} aria-pressed={look === l}>
            <span className={'look-swatch ' + l} />
            {l === 'fresh' ? 'Fresh' : 'Classic To Do'}
          </button>
        ))}
      </div>
      <div className="segmented small">
        {(['system', 'light', 'dark'] as Scheme[]).map((s) => (
          <button key={s} className={scheme === s ? 'on' : ''} onClick={() => onScheme(s)} aria-pressed={scheme === s}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function SettingsDialog({
  backend,
  store,
  personal,
  lists,
  userName,
  onClose,
  onSwitchPlan,
  onSignOut,
  onResetDemo,
}: {
  backend: Backend
  store: Store
  personal?: Plan
  lists: TaskList[]
  userName: string
  onClose: () => void
  onSwitchPlan?: () => void
  onSignOut: () => void
  onResetDemo?: () => void
}) {
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [importResult, setImportResult] = useState<string | null>(null)
  const myLists = lists.filter((l) => l.planId === personal?.id)

  const runImport = async () => {
    if (!backend.importFromToDo || !personal) return
    setImportResult(null)
    try {
      const n = await backend.importFromToDo(personal.id, setProgress)
      setImportResult(`Imported ${n} task${n === 1 ? '' : 's'}.`)
      await store.reload()
    } catch (e) {
      setImportResult(`Import stopped: ${(e as Error).message}`)
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal glass" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="popover-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <I.Close />
          </button>
        </div>

        <section>
          <h3>Account</h3>
          <p className="muted">
            {backend.kind === 'graph'
              ? `Signed in as ${userName}. Tasks are stored in the Planner plan "${personal?.title ?? '…'}".`
              : 'Demo mode. Tasks are stored in this browser only.'}
          </p>
          <div className="row-btns">
            {onSwitchPlan && <button className="btn" onClick={onSwitchPlan}>Use a different plan</button>}
            {onResetDemo && <button className="btn" onClick={onResetDemo}>Reset demo data</button>}
            <button className="btn" onClick={onSignOut}>{backend.kind === 'graph' ? 'Sign out' : 'Leave demo'}</button>
          </div>
        </section>

        {myLists.length > 0 && (
          <section>
            <h3>Lists</h3>
            {myLists.map((l) => (
              <div key={l.id} className="setting-row">
                <I.Lines size={16} />
                <input
                  defaultValue={l.name}
                  aria-label={`Rename ${l.name}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v && v !== l.name) void store.renameList(l, v)
                  }}
                />
                <button
                  className="icon-btn danger"
                  disabled={myLists.length === 1}
                  title={myLists.length === 1 ? 'You need at least one list' : 'Delete list'}
                  aria-label={`Delete ${l.name}`}
                  onClick={() => {
                    if (confirm(`Delete "${l.name}" and all its tasks? This can't be undone.`)) void store.deleteList(l)
                  }}
                >
                  <I.Trash size={16} />
                </button>
              </div>
            ))}
          </section>
        )}

        {personal && (
          <section>
            <h3>Label names</h3>
            <p className="muted small">Search for a label with #name. Labels without a name show their colour.</p>
            <div className="label-grid">
              {LABEL_COLORS.slice(0, 12).map((_, i) => {
                const key = `category${i + 1}`
                const info = labelInfo(personal, key)
                return (
                  <label key={key} className="setting-row">
                    <span className="dot" style={{ background: info.color }} />
                    <input
                      defaultValue={personal.labels[key] ?? ''}
                      placeholder={LABEL_COLORS[i].name}
                      aria-label={`Name for ${LABEL_COLORS[i].name} label`}
                      onBlur={(e) => {
                        if (e.target.value !== (personal.labels[key] ?? '')) void store.renameLabel(personal, key, e.target.value.trim())
                      }}
                    />
                  </label>
                )
              })}
            </div>
          </section>
        )}

        {backend.importFromToDo && personal && (
          <section>
            <h3>Import from Microsoft To Do</h3>
            <p className="muted small">
              Copies each of your To Do lists into a new list here, with steps, notes, due dates and importance. Your To
              Do data is left as it is. Running it twice creates duplicates.
            </p>
            {progress ? (
              <div className="progress">
                <div className="bar" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
                <span className="small">
                  {progress.done} / {progress.total} {progress.current ? `· ${progress.current}` : ''}
                </span>
              </div>
            ) : (
              <button className="btn" onClick={runImport}>Import my To Do lists</button>
            )}
            {importResult && <p className="small">{importResult}</p>}
          </section>
        )}
      </div>
    </div>
  )
}
