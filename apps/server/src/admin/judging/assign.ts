// Automatic judge assignment (plan D22): every team gets N different judges,
// and no judge has more than one team more than any other.

export function balanceAssignments(teamIds: string[], judgeUids: string[], perTeam: number): Map<string, string[]> {
  if (perTeam > judgeUids.length) throw new Error(`Need at least ${perTeam} judges, have ${judgeUids.length}`);
  const load = new Map(judgeUids.map((j) => [j, [] as string[]]));
  const judges = [...judgeUids].sort();
  for (const team of [...teamIds].sort()) {
    // The least-loaded judges take the next team (ties broken by uid for stable output).
    const picked = [...judges].sort((a, b) => load.get(a)!.length - load.get(b)!.length || a.localeCompare(b)).slice(0, perTeam);
    for (const j of picked) load.get(j)!.push(team);
  }
  return load;
}
