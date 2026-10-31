import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useSession } from "../auth/Session";
import { useEvent } from "../lib/event";
import { label } from "../lib/format";
import { navFor } from "./nav";

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
          <span className="brand-mark">H</span>
          <span>
            HACKOS<small>EVENT CONTROL</small>
          </span>
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
            <button className="menu-button" aria-label="Open menu" onClick={() => setOpenAt(open ? null : location.pathname)}>
              ☰
            </button>
            <span className="crumb">HACKOS / {current?.group.toUpperCase() ?? "CONTROL ROOM"}</span>
            <h1>{current?.label ?? "HACKOS"}</h1>
          </div>
          <div className="account">
            <div className="avatar">{(user?.displayName || user?.email || "H").slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{user?.displayName || user?.email || "Volunteer"}</strong>
              <small>{role ? label(role) : "no role"}</small>
            </div>
            <button className="text-button" onClick={toggle} aria-label="Toggle colour theme">
              {theme === "light" ? "Dark mode" : "Light mode"}
            </button>
            <button className="text-button" onClick={() => signOut(auth)}>
              Sign out
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
