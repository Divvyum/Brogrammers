import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isSignInWithEmailLink, onAuthStateChanged, sendSignInLinkToEmail, signInWithCustomToken, signInWithEmailLink, signOut as fbSignOut, type User } from 'firebase/auth'
import { useIsRestoring, useQuery, useQueryClient } from '@tanstack/react-query'
import { auth } from '../firebase'
import { api } from './api'
import { clearSavedData } from './persist'
import { tr } from '../i18n/strings'

// Who is signed in, which event, and their profile. The event is looked up by
// code before login (VITE_EVENT_CODE, default HACK26) because the WhatsApp
// code is per event.

export const EVENT_CODE = (import.meta.env.VITE_EVENT_CODE as string | undefined) ?? 'HACK26'

export interface PublicEvent {
  id: string
  name: string
  code: string
  mode: string
  startAt: string
  endAt: string
  tracks: string[]
}

export interface Me {
  uid: string
  profile: null | {
    name?: string
    college?: string
    year?: number
    city?: string
    skills?: string[]
    githubUsername?: string
    photoUrl?: string
    communityOptIn?: boolean
    notifications?: Record<string, boolean>
  }
  registration: null | {
    status: string
    track?: string
    teamId?: string
    slotId?: string
    roomId?: string
    seat?: string
    eligibility?: { result: 'eligible' | 'flagged' | 'rejected'; reason: string; override?: boolean }
    enrollment?: { status: 'invited' | 'enrolled' | 'revoked'; devicePubKey?: string }
    openToReplacement?: { on: boolean; skills: string[]; availability: string }
    registeredAt?: string
    checkedInAt?: string
    mergedInto?: string
    withdrawnAt?: string
  }
}

interface Session {
  user: User | null
  loading: boolean
  event: PublicEvent | undefined
  me: Me | undefined
  /** Signed in as a participant with a finished profile. */
  registered: boolean
  phone: string
  email: string
  requestOtp: (phone: string) => Promise<{ devCode?: string }>
  verifyOtp: (code: string) => Promise<void>
  sendEmailLink: (email: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<Session | null>(null)
const EMAIL_KEY = 'aura-email-for-signin'
const PHONE_KEY = 'aura-phone'
// Last known role, so a signed-in participant gets in offline when the token can't refresh.
const ROLE_KEY = 'aura-role'

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const restoring = useIsRestoring()
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [phone, setPhone] = useState(() => localStorage.getItem(PHONE_KEY) ?? '')
  const [email, setEmail] = useState(() => localStorage.getItem(EMAIL_KEY) ?? '')

  const eventQ = useQuery({ queryKey: ['public-event', EVENT_CODE], queryFn: () => api<PublicEvent>(`/public/event?code=${encodeURIComponent(EVENT_CODE)}`), staleTime: 3_600_000 })
  const meQ = useQuery({ queryKey: ['/me'], queryFn: () => api<Me>('/me'), enabled: Boolean(user) && role === 'participant' })

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        let r: string | null = null
        if (u) {
          try {
            r = ((await u.getIdTokenResult()).claims.role as string | undefined) ?? null
            if (r) localStorage.setItem(ROLE_KEY, r)
          } catch {
            // Offline with an expired token: use the role from the last sign-in.
            r = localStorage.getItem(ROLE_KEY)
          }
        }
        setUser(u)
        setRole(r)
        setAuthReady(true)
      }),
    [],
  )

  // Finish an email-link sign-in: swap the email session for the participant account.
  useEffect(() => {
    if (!eventQ.data || !isSignInWithEmailLink(auth, location.href)) return
    const saved = localStorage.getItem(EMAIL_KEY) || window.prompt('Confirm your email to finish signing in') || ''
    void (async () => {
      const cred = await signInWithEmailLink(auth, saved, location.href)
      const r = await api<{ token: string }>('/auth/email/claim', { body: { eventId: eventQ.data!.id }, token: await cred.user.getIdToken() })
      await signInWithCustomToken(auth, r.token)
      history.replaceState({}, '', '/')
      setRole('participant')
      await qc.invalidateQueries()
    })().catch((e) => alert(e instanceof Error ? e.message : String(e)))
  }, [eventQ.data, qc])

  const requestOtp = useCallback(
    async (p: string) => {
      if (!eventQ.data) throw new Error(tr("Event not found. Check VITE_EVENT_CODE."))
      setPhone(p)
      localStorage.setItem(PHONE_KEY, p)
      return api<{ sent: boolean; devCode?: string }>('/auth/otp/request', { body: { phone: p, eventId: eventQ.data.id } })
    },
    [eventQ.data],
  )

  const verifyOtp = useCallback(
    async (code: string) => {
      const r = await api<{ token: string }>('/auth/otp/verify', { body: { phone, eventId: eventQ.data!.id, code } })
      await signInWithCustomToken(auth, r.token)
      setRole('participant')
      await qc.invalidateQueries()
    },
    [phone, eventQ.data, qc],
  )

  const sendEmailLink = useCallback(async (e: string) => {
    setEmail(e)
    localStorage.setItem(EMAIL_KEY, e)
    await sendSignInLinkToEmail(auth, e, { url: `${location.origin}/`, handleCodeInApp: true })
  }, [])

  const signOut = useCallback(async () => {
    await fbSignOut(auth)
    localStorage.removeItem(ROLE_KEY)
    clearSavedData()
  }, [])

  const refresh = useCallback(async () => {
    await qc.invalidateQueries()
  }, [qc])

  const me = meQ.data
  const value = useMemo<Session>(
    () => ({
      user,
      // Saved data shows immediately; only wait for the network when nothing is saved.
      loading: restoring || !authReady || (!eventQ.data && eventQ.isLoading) || (Boolean(user) && role === 'participant' && !me && meQ.isLoading),
      event: eventQ.data,
      me,
      registered: Boolean(me?.registration?.status && me.profile?.name),
      phone,
      email,
      requestOtp,
      verifyOtp,
      sendEmailLink,
      signOut,
      refresh,
    }),
    [restoring, user, authReady, eventQ.isLoading, eventQ.data, role, meQ.isLoading, me, phone, email, requestOtp, verifyOtp, sendEmailLink, signOut, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession() {
  const s = useContext(Ctx)
  if (!s) throw new Error('useSession must be inside SessionProvider')
  return s
}
