import { auth } from "../firebase";
import { validateRequestBody } from "./validation";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiOptions = Omit<RequestInit, "body"> & { body?: unknown };

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const requestBody = options.body === undefined ? undefined : validateRequestBody(path, options.body);
  const response = await fetch(`/api/admin${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(requestBody === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
  });

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const error = contentType.includes("json") ? await response.json() as { message?: string; error?: string; details?: unknown } : null;
    throw new ApiError(error?.message || `Request failed (${response.status})`, response.status, error?.error, error?.details);
  }
  if (!contentType.includes("json")) return await response.blob() as T;
  return await response.json() as T;
}

export const eventPath = (eventId: string, path: string) => `/events/${encodeURIComponent(eventId)}/${path.replace(/^\//, "")}`;

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
