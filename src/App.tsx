// SEED shell: proves profile -> engine -> store works. The shell work package replaces this.
import { useEffect } from "react";
import { BUNDLED_PROFILES, useStore } from "./state/store";

export default function App() {
  const { results, profile, error, loadProfile } = useStore();
  useEffect(() => { if (!profile) loadProfile(BUNDLED_PROFILES[0]); }, [profile, loadProfile]);
  if (error) return <pre>{error}</pre>;
  if (!results) return <p>Loading…</p>;
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Crossover Studio</h1>
      <p>{profile?.name}</p>
      <ul>{results.checks.map(c => <li key={c.id}>{c.state}: {c.title} ({c.detail})</li>)}</ul>
    </main>
  );
}
