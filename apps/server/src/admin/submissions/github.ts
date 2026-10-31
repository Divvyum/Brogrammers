import { env } from "../../core/env.js";
import { badRequest, HttpError } from "../../core/http.js";

// GitHub insights (plan D23): commit timeline, contributors, README, and flags
// for commits made before the event started or after the submission deadline.
// Uses the REST API with our token (5,000 requests/hour).

export type GithubFetch = (path: string, accept?: string) => Promise<{ status: number; body: unknown }>;

const MAX_COMMITS = 300;
const README_MAX = 20_000;

const realFetch: GithubFetch = async (path, accept = "application/vnd.github+json") => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "hackos-server",
      ...(env.githubToken ? { Authorization: `Bearer ${env.githubToken}` } : {}),
    },
  });
  const body = accept.includes("raw") ? await res.text() : await res.json().catch(() => null);
  return { status: res.status, body };
};

let gh: GithubFetch = realFetch;
/** Tests replace the network with fixtures. */
export function setGithubFetch(f: GithubFetch | null) {
  gh = f ?? realFetch;
}

/** "https://github.com/owner/name(.git)(/...)" → "owner/name". */
export function parseRepo(url: string): string {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/i.exec(url.trim());
  if (!m) throw badRequest("Not a GitHub repository URL");
  return `${m[1]}/${m[2]}`;
}

interface RawCommit {
  sha: string;
  commit: { message: string; author: { name: string; date: string } | null; committer: { date: string } | null };
  author: { login: string } | null;
}

export interface InsightsInput {
  repoUrl: string;
  eventStart: Date;
  deadline: Date;
  /** Lowercase GitHub username → team member uid. */
  members: Map<string, string>;
}

export async function fetchInsights(input: InsightsInput) {
  const repo = parseRepo(input.repoUrl);

  const commits: RawCommit[] = [];
  for (let page = 1; commits.length < MAX_COMMITS; page++) {
    const res = await gh(`/repos/${repo}/commits?per_page=100&page=${page}`);
    if (res.status === 404) throw new HttpError(404, "REPO_NOT_FOUND", `${repo} doesn't exist or is private`);
    if (res.status === 409) break; // empty repository
    if (res.status !== 200) throw new HttpError(502, "GITHUB_FAILED", `GitHub returned ${res.status}`);
    const batch = res.body as RawCommit[];
    commits.push(...batch);
    if (batch.length < 100) break;
  }

  const timeline = commits.slice(0, MAX_COMMITS).map((c) => {
    const date = c.commit.author?.date ?? c.commit.committer?.date ?? new Date(0).toISOString();
    const t = new Date(date).getTime();
    const login = c.author?.login;
    const flag = t < input.eventStart.getTime() ? "before_start" : t > input.deadline.getTime() ? "after_deadline" : undefined;
    return {
      sha: c.sha,
      date,
      author: login ?? c.commit.author?.name ?? "unknown",
      message: c.commit.message.split("\n")[0]!.slice(0, 200),
      uid: login ? input.members.get(login.toLowerCase()) : undefined,
      flag: flag as "before_start" | "after_deadline" | undefined,
    };
  });

  // Line counts come from GitHub's stats endpoint, which answers 202 while it computes.
  let lineStats = new Map<string, { additions: number; deletions: number }>();
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await gh(`/repos/${repo}/stats/contributors`);
    if (res.status === 200 && Array.isArray(res.body)) {
      lineStats = new Map(
        (res.body as { author: { login: string } | null; weeks: { a: number; d: number }[] }[])
          .filter((s) => s.author)
          .map((s) => [
            s.author!.login,
            { additions: s.weeks.reduce((t, w) => t + w.a, 0), deletions: s.weeks.reduce((t, w) => t + w.d, 0) },
          ]),
      );
      break;
    }
    if (res.status !== 202) break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  const counts = new Map<string, number>();
  for (const c of timeline) counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
  const contributors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([login, n]) => ({
      login,
      commits: n,
      additions: lineStats.get(login)?.additions,
      deletions: lineStats.get(login)?.deletions,
      uid: input.members.get(login.toLowerCase()),
    }));

  const readmeRes = await gh(`/repos/${repo}/readme`, "application/vnd.github.raw+json");
  const readme = readmeRes.status === 200 ? String(readmeRes.body).slice(0, README_MAX) : undefined;

  return {
    repo,
    commits: timeline.length,
    timeline,
    contributors,
    flags: timeline.filter((c) => c.flag).map((c) => ({ sha: c.sha, reason: c.flag! })),
    outsiders: contributors.filter((c) => !c.uid).map((c) => c.login),
    readme,
  };
}
