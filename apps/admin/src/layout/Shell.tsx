import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useSession } from "../auth/Session";
import { useEvent } from "../lib/event";
import { label } from "../lib/format";
import { navFor } from "./nav";
import { Brand } from "../components/AuraLogo";
import { LogOut, Menu, Moon, Sun } from "lucide-react";

// App shell (plan A1): side nav grouped by area, event switcher for the super
// admin, theme toggle, account menu. Collapses to a top drawer on phones.

export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("admin-theme") || "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("admin-theme", theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "light" ? "dark" : "light")) };
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, role } = useSession();
  const { event, events, eventId, setEventId } = useEvent();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === location.pathname;
  const items = navFor(role);
  const groups = [...new Set(items.map((i) => i.group))];
  const current = items.find((i) => location.pathname.startsWith(i.path));
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);

  return (
    <div className={`shell ${open ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <a className="brand" href="/">
          <Brand sub="Admin" />
        </a>
        {role === "superadmin" ? (
          <div className="event-switch">
            <label htmlFor="event-switch">ACTIVE EVENT</label>
            <select id="event-switch" value={eventId ?? ""} onChange={(e) => setEventId(e.target.value)}>
              {events.length === 0 && <option value="">No events yet</option>}
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="event-switch">
            <label>EVENT</label>
            <div className="event-name">{event?.name ?? "—"}</div>
          </div>
        )}
        <nav aria-label="Main">
          {groups.map((g) => (
            <div key={g} className="nav-group">
              <span className="nav-group-label">{g}</span>
              {items
                .filter((i) => i.group === g)
                .map((i) => (
                  <NavLink key={i.path} to={i.path} className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
                    <i.icon size={19} strokeWidth={1.9} />
                    {i.label}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
        <div className="side-bottom">
          <span className={online ? "live-dot" : "live-dot off"} /> {online ? "Online" : "Offline: changes will sync later"}
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <button className="menu-button round-btn" aria-label="Open menu" onClick={() => setOpenAt(open ? null : location.pathname)}>
                <Menu size={20} />
              </button>
              <div>
                <span className="crumb">{current?.group ?? "Control room"}</span>
                <h1>{current?.label ?? "AURA Admin"}</h1>
              </div>
            </div>
          </div>
          <div className="account">
            <button className="round-btn" onClick={toggle} aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"} title={theme === "light" ? "Dark theme" : "Light theme"}>
              {theme === "light" ? <Moon size={20} strokeWidth={1.9} /> : <Sun size={20} strokeWidth={1.9} />}
            </button>
            <div className="account-chip">
              <div className="avatar">{(user?.displayName || user?.email || "A").slice(0, 1).toUpperCase()}</div>
              <div>
                <strong>{user?.displayName || user?.email || "Volunteer"}</strong>
                <small>{role ? label(role) : "no role"}</small>
              </div>
            </div>
            <button className="round-btn" onClick={() => signOut(auth)} aria-label="Sign out" title="Sign out">
              <LogOut size={19} strokeWidth={1.9} />
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

/** Shown when a role opens a screen that isn't theirs (plan A2). */
export function Unauthorized() {
  return (
    <div className="panel blank">
      <h2>Not available for your role</h2>
      <p>This screen belongs to another role. Use the menu to go to your own screens, or ask an organizer if you need access.</p>
    </div>
  );
}

export function NoRole() {
  return (
    <div className="login-wrap single">
      <div className="panel blank">
        <h2>Your account has no role yet</h2>
        <p>An organizer needs to add you as staff for this event. Once they have, sign out and back in.</p>
        <button className="primary" onClick={() => signOut(auth)}>
          Sign out
        </button>
      </div>
    </div>
  );
}
