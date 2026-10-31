import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useToast } from "../ui/ToastContext";

// Data access for every screen: queries are keyed by API path; any change
// refreshes the open screens.

/** The current time, refreshed every `ms` milliseconds (keeps renders pure). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export interface Page<T> {
  items: T[];
  next: string | null;
}

export function useApi<T>(path: string | null, options: { refetchInterval?: number } = {}) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: () => api<T>(path!),
    enabled: Boolean(path),
    refetchInterval: options.refetchInterval,
  });
}

/** Every page of a paginated list, fetched in sequence (for boards that need the whole set). */
export function useAllPages<T>(basePath: string | null, limit = 50) {
  return useQuery<T[]>({
    queryKey: [basePath, "all"],
    enabled: Boolean(basePath),
    queryFn: async () => {
      const out: T[] = [];
      const sep = basePath!.includes("?") ? "&" : "?";
      let after: string | null = null;
      do {
        const page: Page<T> = await api<Page<T>>(`${basePath}${sep}limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`);
        out.push(...page.items);
        after = page.next;
      } while (after);
      return out;
    },
  });
}

/** Cursor pagination: keeps the cursors seen so "Previous" works. */
export function usePaged<T>(basePath: string | null, limit = 25) {
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors.at(-1);
  const sep = basePath?.includes("?") ? "&" : "?";
  const path = basePath ? `${basePath}${sep}limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}` : null;
  const query = useApi<Page<T>>(path);
  return {
    ...query,
    page: cursors.length + 1,
    hasNext: Boolean(query.data?.next),
    next: () => query.data?.next && setCursors((c) => [...c, query.data!.next!]),
    previous: () => setCursors((c) => c.slice(0, -1)),
    reset: () => setCursors([]),
  };
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const details = e.details as { fieldErrors?: unknown } | undefined;
    return details && e.code === "VALIDATION" ? `${e.message}: ${JSON.stringify(details).slice(0, 200)}` : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Runs a change against the API, shows the result as a toast, and refreshes
 * every open query. Returns the response, or undefined if it failed.
 */
export function useAction() {
  const qc = useQueryClient();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T = unknown>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, success?: string | ((r: T) => string)) => {
      setBusy(true);
      try {
        const result = await api<T>(path, { method, body: body ?? (method === "DELETE" ? undefined : {}) });
        if (success) show(typeof success === "function" ? success(result) : success, "success");
        await qc.invalidateQueries();
        return result;
      } catch (e) {
        show(errorMessage(e), "error");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [qc, show],
  );
  return { run, busy };
}
