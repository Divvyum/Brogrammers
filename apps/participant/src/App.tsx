import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { Toaster } from './components/ui/Toaster'
import { EmptyState } from './components/ui/Misc'
import { UIProvider } from './context/UIContext'
import Login from './pages/auth/Login'
import Verify, { EmailSent } from './pages/auth/Verify'
import Onboarding from './pages/auth/Onboarding'
import Home from './pages/Home'
import EventPage from './pages/Event'
import Team from './pages/Team'
import Journey from './pages/Journey'
import MyId from './pages/MyId'
import Schedule from './pages/Schedule'
import Announcements from './pages/Announcements'
import Problems from './pages/Problems'
import Mentors from './pages/Mentors'
import EventDay from './pages/EventDay'
import Submission from './pages/Submission'
import Results from './pages/Results'
import Rewards from './pages/Rewards'
import Rating from './pages/Rating'
import Community from './pages/Community'
import Profile from './pages/Profile'
import { useSession } from './lib/session'
import { AuraLogo } from './components/ui/Misc'

function NotFound() {
  return <div className="card"><EmptyState title="Page not found" description="That page doesn’t exist in the student app." action={<Link to="/" className="btn-primary">Go home</Link>} /></div>
}

function Splash() {
  return <div className="grid min-h-screen place-items-center"><div className="animate-pulse"><AuraLogo size={56} /></div></div>
}

/** Signed in as a participant with a finished profile, else to /login or /onboarding. */
function RequireRegistered() {
  const { user, loading, registered, me } = useSession()
  const { pathname } = useLocation()
  if (loading) return <Splash />
  if (!user || !me) return <Navigate to="/login" replace state={{ from: pathname }} />
  if (!registered) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

/** Login screens: a signed-in participant goes straight in. */
function GuestOnly() {
  const { user, loading, registered, me } = useSession()
  if (loading) return <Splash />
  if (user && me) return <Navigate to={registered ? '/' : '/onboarding'} replace />
  return <Outlet />
}

function SignedIn() {
  const { user, loading, me } = useSession()
  if (loading) return <Splash />
  if (!user || !me) return <Navigate to="/login" replace />
  return <Outlet />
}

export default function App() {
  return (
    <UIProvider>
      <Routes>
        <Route element={<GuestOnly />}>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Login mode="signup" />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/email-sent" element={<EmailSent />} />
        </Route>
        <Route element={<SignedIn />}>
          <Route path="/onboarding" element={<Onboarding />} />
        </Route>
        <Route element={<RequireRegistered />}>
        <Route element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route path="/event" element={<EventPage />} />
          <Route path="/team" element={<Team />} />
          <Route path="/journey" element={<Journey />} />
          <Route path="/my-id" element={<MyId />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/announcements" element={<Announcements />} />
          <Route path="/problems" element={<Problems />} />
          <Route path="/mentors" element={<Mentors />} />
          <Route path="/event-day" element={<EventDay />} />
          <Route path="/submission" element={<Submission />} />
          <Route path="/results" element={<Results />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/rating" element={<Rating />} />
          <Route path="/community" element={<Community />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        </Route>
      </Routes>
      <Toaster />
    </UIProvider>
  )
}
