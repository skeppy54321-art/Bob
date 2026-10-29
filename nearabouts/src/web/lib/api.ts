/** Fetch wrapper for the JSON API. Cookies carry the session; errors become ApiError. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string, public data?: any) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check your connection.', 0, 'network');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.code ?? 'error', data);
  return data as T;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
