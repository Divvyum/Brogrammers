import { auth } from '../firebase'

// Calls the participant API (/api/p, proxied by Vite in dev) with the signed-in
// user's Firebase ID token. Errors carry the server's message for the toast.

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

export const OFFLINE_MESSAGE = 'You’re offline. Try again when you’re connected.'

export async function api<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  if (!navigator.onLine) throw new ApiError(OFFLINE_MESSAGE, 0, 'OFFLINE')
  const token = options.token ?? (await auth.currentUser?.getIdToken())
  const res = await send(`/api/p${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined)
  if (!res.ok) {
    const e = data as { message?: string; error?: string; details?: unknown } | undefined
    throw new ApiError(e?.message ?? `Request failed (${res.status})`, res.status, e?.error, e?.details)
  }
  return data as T
}

/** fetch, with a network failure reported as being offline. */
async function send(url: string, init: RequestInit) {
  try {
    return await fetch(url, init)
  } catch {
    throw new ApiError(OFFLINE_MESSAGE, 0, 'OFFLINE')
  }
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Signed upload to Cloudinary (photos, decks, complaint evidence). Returns the file's URL. */
export async function uploadFile(folder: 'photos' | 'submissions' | 'complaint-evidence', file: Blob, onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<string> {
  const sig = await api<Record<string, string | number> & { uploadUrl: string; apiKey: string; maxBytes: number }>('/upload-signature', { body: { folder } })
  if (file.size > sig.maxBytes) throw new Error(`File is over ${Math.round(sig.maxBytes / 1_048_576)} MB`)
  const form = new FormData()
  form.append('file', file)
  form.append('api_key', String(sig.apiKey))
  for (const k of ['timestamp', 'signature', 'folder', 'allowed_formats']) form.append(k, String(sig[k]))
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', sig.uploadUrl)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      const json = JSON.parse(xhr.responseText || '{}') as { secure_url?: string; error?: { message: string } }
      if (json.secure_url) resolve(json.secure_url)
      else reject(new Error(json.error?.message ?? 'Upload failed'))
    }
    xhr.onerror = () => reject(new Error('Upload failed: check your connection'))
    signal?.addEventListener('abort', () => {
      xhr.abort()
      reject(new Error('Upload cancelled'))
    })
    xhr.send(form)
  })
}
