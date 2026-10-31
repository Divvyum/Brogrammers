import { useEffect, useState } from "react";
import { app } from "./firebase";

export function App() {
  const [health, setHealth] = useState("checking…");

  useEffect(() => {
    fetch("/api/public/health")
      .then((r) => r.json())
      .then((h) => setHealth(`server ok, firestore ${h.firestore}`))
      .catch(() => setHealth("server unreachable"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>HACKOS</h1>
      <p>Firebase project: {app.options.projectId}</p>
      <p>API: {health}</p>
    </main>
  );
}
