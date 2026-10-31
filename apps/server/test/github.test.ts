import { afterAll, describe, expect, it } from "vitest";
import { fetchInsights, parseRepo, setGithubFetch } from "../src/admin/submissions/github.js";
import { csvCell, csvLine } from "../src/core/csv.js";
import { balanceAssignments } from "../src/admin/judging/assign.js";
import { weightedTotal } from "../src/admin/judging/scoring.js";

// D23 GitHub insights (fixture data instead of the network), plus small pure helpers.

const commit = (sha: string, date: string, login: string | null, name = login ?? "someone") => ({
  sha,
  commit: { message: `${sha} work\n\nlong body`, author: { name, date }, committer: { date } },
  author: login ? { login } : null,
});

afterAll(() => setGithubFetch(null));

describe("D23: GitHub insights", () => {
  it("parses repo URLs", () => {
    expect(parseRepo("https://github.com/Divvyum/Brogrammers")).toBe("Divvyum/Brogrammers");
    expect(parseRepo("https://github.com/a/b.git")).toBe("a/b");
    expect(parseRepo("https://github.com/a/b/tree/main/src")).toBe("a/b");
    expect(() => parseRepo("https://gitlab.com/a/b")).toThrow();
  });

  it("builds the timeline, flags commits outside the event window and maps authors to members", async () => {
    setGithubFetch(async (path) => {
      if (path.includes("/commits")) {
        return {
          status: 200,
          body: [
            commit("c4", "2026-11-09T02:00:00Z", "Asha"), // after the deadline
            commit("c3", "2026-11-08T12:00:00Z", "bilal"),
            commit("c2", "2026-11-08T10:00:00Z", "asha"),
            commit("c1", "2026-11-01T10:00:00Z", null, "Old Friend"), // before the start, unlinked author
          ],
        };
      }
      if (path.includes("/stats/contributors")) {
        return { status: 200, body: [{ author: { login: "asha" }, weeks: [{ a: 120, d: 10 }, { a: 30, d: 5 }] }] };
      }
      if (path.endsWith("/readme")) return { status: 200, body: "# Ctrl Alt Elite\nA thing." };
      return { status: 404, body: null };
    });

    const out = await fetchInsights({
      repoUrl: "https://github.com/team/project",
      eventStart: new Date("2026-11-08T09:00:00Z"),
      deadline: new Date("2026-11-08T23:59:00Z"),
      members: new Map([["asha", "p1"], ["bilal", "p2"]]),
    });

    expect(out.repo).toBe("team/project");
    expect(out.commits).toBe(4);
    expect(out.flags).toEqual([
      { sha: "c4", reason: "after_deadline" },
      { sha: "c1", reason: "before_start" },
    ]);
    expect(out.timeline[0]).toMatchObject({ sha: "c4", author: "Asha", uid: "p1", message: "c4 work" });
    expect(out.timeline.find((c) => c.sha === "c3")?.flag).toBeUndefined();
    expect(out.outsiders).toEqual(["Old Friend"]);
    expect(out.contributors.find((c) => c.login === "asha")).toMatchObject({ commits: 1, additions: 150, deletions: 15, uid: "p1" });
    expect(out.readme).toContain("Ctrl Alt Elite");
  });

  it("reports a missing or private repo clearly", async () => {
    setGithubFetch(async () => ({ status: 404, body: null }));
    await expect(
      fetchInsights({ repoUrl: "https://github.com/x/y", eventStart: new Date(), deadline: new Date(), members: new Map() }),
    ).rejects.toMatchObject({ code: "REPO_NOT_FOUND" });
  });
});

describe("D22: balanced judge assignment", () => {
  it("gives every team N different judges and keeps loads within one", () => {
    const teams = Array.from({ length: 50 }, (_, i) => `t${i}`);
    const plan = balanceAssignments(teams, ["j1", "j2", "j3", "j4", "j5"], 2);
    const loads = [...plan.values()].map((t) => t.length);
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
    expect(loads.reduce((a, b) => a + b, 0)).toBe(100);
    for (const t of teams) {
      const judges = [...plan.entries()].filter(([, ts]) => ts.includes(t)).map(([j]) => j);
      expect(new Set(judges).size).toBe(2);
    }
  });
});

describe("D24: weighted totals", () => {
  it("scales each criterion by its weight", () => {
    const rubric = [
      { id: "a", name: "A", weight: 60, max: 10 },
      { id: "b", name: "B", weight: 40, max: 5 },
    ];
    expect(weightedTotal(rubric, { a: 10, b: 5 })).toBe(100);
    expect(weightedTotal(rubric, { a: 5, b: 0 })).toBe(30);
  });
});

describe("D27: CSV cells", () => {
  it("quotes, escapes, and defuses formulas", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell(null)).toBe("");
    expect(csvLine(["a", 1, true])).toBe("a,1,true\r\n");
  });
});
