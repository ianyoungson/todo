import {
  type AccountInfo,
  InteractionRequiredAuthError,
  PublicClientApplication,
} from '@azure/msal-browser'

/**
 * Delegated permissions the app asks for.
 * - Tasks.ReadWrite: Planner plans, buckets and tasks (and Microsoft To Do, for the one-off import).
 * - Mail.ReadWrite: read flagged emails and mark them complete.
 */
export const SCOPES = ['User.Read', 'Tasks.ReadWrite', 'Mail.ReadWrite']

const CONFIG_KEY = 'todo2.msal'

export interface AuthConfig {
  clientId: string
  tenant: string
}

export function loadAuthConfig(): AuthConfig | null {
  const envId = import.meta.env.VITE_MSAL_CLIENT_ID as string | undefined
  const envTenant = (import.meta.env.VITE_MSAL_TENANT as string | undefined) || 'organizations'
  if (envId) return { clientId: envId, tenant: envTenant }
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    return raw ? (JSON.parse(raw) as AuthConfig) : null
  } catch {
    return null
  }
}

export function saveAuthConfig(cfg: AuthConfig | null) {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
    else localStorage.removeItem(CONFIG_KEY)
  } catch {
    /* ignore */
  }
}

export class Auth {
  private app: PublicClientApplication
  private ready: Promise<void>

  constructor(cfg: AuthConfig) {
    this.app = new PublicClientApplication({
      auth: {
        clientId: cfg.clientId,
        authority: `https://login.microsoftonline.com/${cfg.tenant}`,
        redirectUri: window.location.origin + window.location.pathname,
      },
      cache: { cacheLocation: 'localStorage' },
    })
    this.ready = this.app.initialize().then(async () => {
      const result = await this.app.handleRedirectPromise()
      if (result?.account) this.app.setActiveAccount(result.account)
      const active = this.app.getActiveAccount() ?? this.app.getAllAccounts()[0]
      if (active) this.app.setActiveAccount(active)
    })
  }

  async account(): Promise<AccountInfo | null> {
    await this.ready
    return this.app.getActiveAccount()
  }

  async signIn() {
    await this.ready
    await this.app.loginRedirect({ scopes: SCOPES })
  }

  async signOut() {
    await this.ready
    await this.app.logoutRedirect({ account: this.app.getActiveAccount() ?? undefined })
  }

  async token(): Promise<string> {
    await this.ready
    const account = this.app.getActiveAccount()
    if (!account) throw new Error('Not signed in')
    try {
      const r = await this.app.acquireTokenSilent({ scopes: SCOPES, account })
      return r.accessToken
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) {
        await this.app.acquireTokenRedirect({ scopes: SCOPES, account })
      }
      throw e
    }
  }
}
