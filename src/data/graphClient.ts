export const GRAPH_V1 = 'https://graph.microsoft.com/v1.0'
/** Personal (roster) plans and My Day are only on the beta endpoint today. */
export const GRAPH_BETA = 'https://graph.microsoft.com/beta'

export class GraphError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  etag?: string
  headers?: Record<string, string>
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class GraphClient {
  constructor(
    private getToken: () => Promise<string>,
    private fetchImpl: FetchLike = (...a) => fetch(...a),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async request<T>(url: string, opts: RequestOptions = {}, attempt = 0): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.getToken()}`,
      ...opts.headers,
    }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.etag) headers['If-Match'] = opts.etag
    // Planner returns the updated object (with its new etag) instead of 204 when asked.
    if (opts.method === 'PATCH' || opts.method === 'POST') headers.Prefer = headers.Prefer ?? 'return=representation'

    const res = await this.fetchImpl(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })

    if ((res.status === 429 || res.status === 503) && attempt < 4) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 2 ** attempt
      await this.sleep(Math.min(retryAfter, 30) * 1000)
      return this.request<T>(url, opts, attempt + 1)
    }

    if (!res.ok) {
      let code = String(res.status)
      let message = res.statusText
      try {
        const err = (await res.json()) as { error?: { code?: string; message?: string } }
        code = err.error?.code ?? code
        message = err.error?.message ?? message
      } catch {
        /* no JSON body */
      }
      throw new GraphError(res.status, code, message)
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  get<T>(url: string, headers?: Record<string, string>) {
    return this.request<T>(url, { headers })
  }

  /** Follows @odata.nextLink until the collection is exhausted. */
  async getAll<T>(url: string, headers?: Record<string, string>): Promise<T[]> {
    const out: T[] = []
    let next: string | undefined = url
    while (next) {
      const page: { value: T[]; '@odata.nextLink'?: string } = await this.get(next, headers)
      out.push(...page.value)
      next = page['@odata.nextLink']
    }
    return out
  }
}
