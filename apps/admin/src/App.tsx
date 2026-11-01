import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { useSession } from "./auth/Session";
import { Login } from "./auth/Login";
import { EventProvider } from "./lib/event";
import { canSee, homeFor } from "./layout/nav";
import { NoRole, Shell, Unauthorized, useTheme } from "./layout/Shell";
import { Announcements } from "./pages/Announcements";
import { AuditLog } from "./pages/AuditLog";
import { CheckinMonitor } from "./pages/CheckinMonitor";
import { Content } from "./pages/Content";
import { Dashboard } from "./pages/Dashboard";
import { DigitalIds } from "./pages/DigitalIds";
import { Duplicates } from "./pages/Duplicates";
import { Eligibility } from "./pages/Eligibility";
import { EventSetup } from "./pages/EventSetup";
import { Exports } from "./pages/Exports";
import { JudgePanel } from "./pages/JudgePanel";
import { JudgingSetup } from "./pages/JudgingSetup";
import { Mentors, MyMentoring } from "./pages/Mentors";
import { FoodCounter, MyWork, Operations } from "./pages/Operations";
import { Participants } from "./pages/Participants";
import { Problems } from "./pages/Problems";
import { Results } from "./pages/Results";
import { Rewards } from "./pages/Rewards";
import { Schedule } from "./pages/Schedule";
import { SlotsRooms } from "./pages/SlotsRooms";
import { Staff } from "./pages/Staff";
import { Teams } from "./pages/Teams";
import { Waitlist } from "./pages/Waitlist";
import { WhatsApp } from "./pages/WhatsApp";
import { ScanApp } from "./scanner/ScanApp";
import "@fontsource-variable/plus-jakarta-sans";
import "./style.css";
import "./app.css";

// Routes (plan A2): each role lands on its own home screen and can only open
// its own screens; anything else shows the "not available" page.

const PAGES: [string, () => ReactNode][] = [
  ["/dashboard", Dashboard],
  ["/event", EventSetup],
  ["/content", Content],
  ["/staff", Staff],
  ["/participants", Participants],
  ["/duplicates", Duplicates],
  ["/eligibility", Eligibility],
  ["/teams", Teams],
  ["/waitlist", Waitlist],
  ["/rooms", SlotsRooms],
  ["/ids", DigitalIds],
  ["/checkins", CheckinMonitor],
  ["/schedule", Schedule],
  ["/problems", Problems],
  ["/announcements", Announcements],
  ["/whatsapp", WhatsApp],
  ["/mentors", Mentors],
  ["/mentor", MyMentoring],
  ["/operations", Operations],
  ["/my-work", MyWork],
  ["/food", FoodCounter],
  ["/judging", JudgingSetup],
  ["/judge", JudgePanel],
  ["/results", Results],
  ["/rewards", Rewards],
  ["/exports", Exports],
  ["/audit", AuditLog],
];

function Guard({ path, children }: { path: string; children: ReactNode }) {
  const { role } = useSession();
  return canSee(role, path) ? <>{children}</> : <Unauthorized />;
}

function Routed() {
  const { user, role, loading } = useSession();
  const location = useLocation();
  useTheme();

  if (loading) return <div className="boot">Loading AURA…</div>;
  if (!user) return <Login />;
  if (!role) return <NoRole />;

  // The scanner is full-screen and phone-first, outside the shell.
  if (location.pathname.startsWith("/scan")) {
    return canSee(role, "/scan") ? <ScanApp /> : <Shell><Unauthorized /></Shell>;
  }

  return (
    <Shell>
      <Routes>
        {PAGES.map(([path, Page]) => (
          <Route key={path} path={path} element={<Guard path={path}><Page /></Guard>} />
        ))}
        <Route path="*" element={<Navigate to={homeFor(role)} replace />} />
      </Routes>
    </Shell>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <EventProvider>
        <Routed />
      </EventProvider>
    </BrowserRouter>
  );
}
