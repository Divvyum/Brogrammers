import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from './api'
import { toast } from './toast'
import type { EventContent } from '@hackos/shared'

// Reads (keyed by API path) and actions (toast + refresh) for every screen.

export function useP<T>(path: string | null, opts: { refetchInterval?: number; retry?: boolean } = {}) {
  return useQuery<T>({ queryKey: [path], queryFn: () => api<T>(path!), enabled: Boolean(path), refetchInterval: opts.refetchInterval, retry: opts.retry ?? 1 })
}

/** Runs an API change, shows a toast, and refreshes every open query. */
export function useAct() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async <T = unknown>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, success?: string | ((r: T) => string)) => {
      setBusy(true)
      try {
        const r = await api<T>(path, { method, body: body ?? (method === 'DELETE' ? undefined : {}) })
        if (success) toast(typeof success === 'function' ? success(r) : success, { kind: 'success' })
        await qc.invalidateQueries()
        return r
      } catch (e) {
        toast(errorText(e), { kind: 'error' })
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [qc],
  )
  return { run, busy }
}

/** The current time, refreshed every `ms` (for countdowns). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

// ---------- shapes returned by /api/p (docs/PARTICIPANT-API.md) ----------

export interface EventInfo {
  id: string
  name: string
  code: string
  mode: string
  startAt: string
  endAt: string
  teamMin: number
  teamMax: number
  tracks: string[]
  rounds: { id: string; name: string; startAt: string; endAt: string }[]
  deadlines: { teamLock: string; submission: string }
  teamsLocked: boolean
  submissionsLocked: boolean
  leaderboardVisible: boolean
  resultsPublishedAt: string | null
  meals: { id: string; name: string; startAt: string; endAt: string }[]
  eligibilityRules: { allowedYears?: number[]; allowedColleges?: string[]; requiredFields?: string[] }
  content?: EventContent
}

export interface TeamMember {
  uid: string
  name?: string
  college?: string
  skills?: string[]
  photoUrl?: string
  githubUsername?: string
  isLeader: boolean
  isMe: boolean
  enrollment: 'invited' | 'enrolled' | 'revoked' | null
}
export interface TeamView {
  team: null | { id: string; name: string; inviteCode: string; status: 'forming' | 'locked'; track?: string; leaderUid: string; repoUrl?: string; members: TeamMember[] }
  requests: { id: string; type: string; uid: string; status: string; reason?: string; createdAt?: string }[]
  invitations: { id: string; type: string; teamId: string; invitedBy?: string; createdAt?: string }[]
  openToReplacement: { on: boolean; skills: string[]; availability: string } | null
}

export const useEventInfo = () => useP<EventInfo>('/event')
