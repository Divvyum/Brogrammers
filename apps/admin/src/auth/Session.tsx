import { onAuthStateChanged, type User } from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Role } from "@hackos/shared";
import { auth } from "../firebase";

export type Session = { user: User | null; role: Role | null; eventId: string | null; loading: boolean };
const SessionContext = createContext<Session>({ user: null, role: null, eventId: null, loading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ user: null, role: null, eventId: null, loading: true });
  useEffect(() => onAuthStateChanged(auth, async (user) => {
    if (!user) {
      setSession({ user: null, role: null, eventId: null, loading: false });
      return;
    }
    try {
      const claims = (await user.getIdTokenResult()).claims;
      const role = claims.role;
      const allowed: Role[] = ["superadmin", "organizer", "volunteer", "mentor", "judge"];
      setSession({
        user,
        role: typeof role === "string" && allowed.includes(role as Role) ? role as Role : null,
        eventId: typeof claims.eventId === "string" ? claims.eventId : null,
        loading: false,
      });
    } catch {
      setSession({ user, role: null, eventId: null, loading: false });
    }
  }), []);
  const value = useMemo(() => session, [session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
