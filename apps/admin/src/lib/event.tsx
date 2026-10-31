import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "../auth/Session";
import { useApi } from "./hooks";

// The event every screen works on. Staff belong to one event (from their
// claims); the super admin picks one.

export interface EventDoc {
  id: string;
  name: string;
  code: string;
  mode: string;
  startAt: string;
  endAt: string;
  teamMin: number;
  teamMax: number;
  tracks: string[];
  rounds?: { id: string; name: string; startAt: string; endAt: string }[];
  eligibilityRules?: { allowedYears?: number[]; allowedColleges?: string[]; requiredFields?: string[] };
  deadlines: { teamLock: string; submission: string };
  leaderboardVisible: boolean;
  rosterVersion: number;
  teamsLockedAt?: string;
  submissionsLocked?: boolean;
  resultsPublishedAt?: string;
  meals?: { id: string; name: string; startAt: string; endAt: string }[];
  counters?: string[];
}

interface EventState {
  eventId: string | null;
  event: EventDoc | undefined;
  events: EventDoc[];
  setEventId: (id: string) => void;
  /** Base path for per-event API routes. */
  base: string;
}

const Ctx = createContext<EventState>({ eventId: null, event: undefined, events: [], setEventId: () => {}, base: "" });

export function EventProvider({ children }: { children: ReactNode }) {
  const { role, eventId: claimEvent, user } = useSession();
  const isSuper = role === "superadmin";
  const list = useApi<{ items: EventDoc[] }>(user && role ? "/events" : null);
  const [chosen, setChosen] = useState<string | null>(() => localStorage.getItem("hackos-event"));

  const events = useMemo(() => list.data?.items ?? [], [list.data]);
  const eventId = isSuper ? (chosen && events.some((e) => e.id === chosen) ? chosen : events[0]?.id ?? null) : claimEvent;
  const detail = useApi<EventDoc>(eventId && eventId !== "*" ? `/events/${eventId}` : null);

  useEffect(() => {
    if (isSuper && eventId) localStorage.setItem("hackos-event", eventId);
  }, [isSuper, eventId]);

  const value = useMemo<EventState>(
    () => ({
      eventId,
      event: detail.data,
      events,
      setEventId: setChosen,
      base: eventId ? `/events/${eventId}` : "",
    }),
    [eventId, detail.data, events],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useEvent = () => useContext(Ctx);
