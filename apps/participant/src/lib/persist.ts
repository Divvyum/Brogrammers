import { QueryClient } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'

// The app's data is saved on this phone, so it opens and shows the last known
// state (ID card, room, schedule, team) with no internet. Cleared on sign-out.

const WEEK = 7 * 24 * 3_600_000
export const CACHE_KEY = 'aura-cache'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: WEEK,
      refetchOnWindowFocus: true,
      // Show saved data and don't wait for the network when offline.
      networkMode: 'offlineFirst',
    },
    mutations: { networkMode: 'always' },
  },
})

const storage = (() => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
})()

export const persister = createSyncStoragePersister({ storage, key: CACHE_KEY, throttleTime: 2000 })

/** Bump when a cached response shape changes, so old saved data is dropped. */
export const CACHE_BUSTER = 'v1'

export const persistOptions = {
  persister,
  maxAge: WEEK,
  buster: CACHE_BUSTER,
  dehydrateOptions: {
    // Keep successful API reads only: not the device key (not serializable) or
    // the food pass (expires in 15 minutes).
    shouldDehydrateQuery: (q: { state: { status: string }; queryKey: readonly unknown[] }) =>
      q.state.status === 'success' && !['device-id', '/food-pass'].includes(String(q.queryKey[0])),
  },
}

export function clearSavedData() {
  queryClient.clear()
  try {
    storage?.removeItem(CACHE_KEY)
  } catch {
    /* storage unavailable */
  }
}
