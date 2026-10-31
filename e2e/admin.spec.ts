import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// Admin portal in a real browser against the seeded emulators.

const PASSWORD = "hackos-dev-123";

const ORGANIZER_PAGES: [string, string][] = [
  ["/dashboard", "Live dashboard"],
  ["/event", "Event setup"],
  ["/staff", "Staff"],
  ["/participants", "Participants"],
  ["/duplicates", "Duplicates"],
  ["/eligibility", "Eligibility"],
  ["/teams", "Teams"],
  ["/waitlist", "Waitlist & rescue"],
  ["/rooms", "Slots & rooms"],
  ["/ids", "Digital IDs"],
  ["/checkins", "Check-in monitor"],
  ["/schedule", "Schedule"],
  ["/problems", "Problem statements"],
  ["/announcements", "Announcements"],
  ["/whatsapp", "WhatsApp"],
  ["/mentors", "Mentors"],
  ["/operations", "Volunteer ops"],
  ["/judging", "Judging setup"],
  ["/judge", "Judge panel"],
  ["/results", "Results"],
  ["/rewards", "Rewards & feedback"],
  ["/exports", "Exports & analytics"],
  ["/audit", "Audit log"],
];

/** Collects uncaught errors and failed API calls while a test runs. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  return problems;
}

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByText("Development only").click();
  const dev = page.locator(".dev-login");
  await dev.getByLabel("Account email").fill(email);
  await dev.getByLabel("Password").fill(PASSWORD);
  await dev.getByRole("button", { name: "Sign in" }).click();
}

test("A2: each role lands on its own home screen and only sees its own menu", async ({ browser }) => {
  for (const [email, home, heading, notInMenu] of [
    ["organizer1@hackos.test", "/dashboard", "Live dashboard", null],
    ["mentor1@hackos.test", "/mentor", "My mentoring", "Live dashboard"],
    ["judge1@hackos.test", "/judge", "Judge panel", "Live dashboard"],
  ] as const) {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, email);
    await expect(page).toHaveURL(new RegExp(`${home}$`));
    await expect(page.locator(".topbar h1")).toHaveText(heading);
    if (notInMenu) {
      await expect(page.locator(".sidebar nav")).not.toContainText(notInMenu);
      await page.goto("/dashboard");
      await expect(page.getByText("Not available for your role")).toBeVisible();
    }
    await page.context().close();
  }
});

test("every organizer screen loads without errors", async ({ page }) => {
  const problems = watch(page);
  await signIn(page, "organizer1@hackos.test");
  await expect(page).toHaveURL(/\/dashboard$/);
  for (const [path, label] of ORGANIZER_PAGES) {
    await page.goto(path);
    await expect(page.locator(".topbar h1"), path).toHaveText(label);
    // Live Firestore listeners keep the network busy, so wait for the loading
    // placeholders to go instead of "network idle".
    await expect(page.locator(".skeleton-stack"), `${path} still loading`).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(400);
    await expect(page.locator(".ui-error"), `${path} shows an error`).toHaveCount(0);
  }
  expect(problems).toEqual([]);
});

test("organizer flows: rubric weights, AI-free announcement preview, judge scoring view", async ({ page }) => {
  const problems = watch(page);
  await signIn(page, "organizer1@hackos.test");
  await expect(page).toHaveURL(/\/dashboard$/);

  // Dashboard shows the seeded numbers from stats/live.
  await expect(page.locator(".stat-card").first()).toContainText("200");

  // Announcement audience preview counts a track.
  await page.goto("/announcements");
  await page.locator(".audience-picker select").selectOption("track");
  await page.locator(".audience-picker .chip", { hasText: "AI" }).click();
  await expect(page.getByText(/people will be notified/)).toBeVisible();

  // Rubric: weights must total 100 before saving.
  await page.goto("/judging");
  await expect(page.getByText("Total weight: 100 / 100")).toBeVisible();

  // Results: the harsh seeded judge is flagged.
  await page.goto("/results");
  await expect(page.getByText(/Outliers:/)).toBeVisible();
  expect(problems).toEqual([]);
});

// ---------- A13: offline scanner ----------

const sim = JSON.parse(readFileSync(fileURLToPath(new URL("../scripts/.sim/devices.json", import.meta.url)), "utf8")) as Record<
  string,
  { eventId: string; uid: string; name: string; privateJwk: JsonWebKey; credential: unknown }
>;

const b64u = (buf: ArrayBuffer) => Buffer.from(buf).toString("base64url");

/** What the participant app does after scanning a challenge. */
async function respond(uid: string, challengeText: string) {
  const device = sim[uid]!;
  const c = JSON.parse(challengeText) as { n: string; vid: string; ev: string };
  const key = await crypto.subtle.importKey("jwk", device.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // canonical({ n, vid, ev, pid }): keys sorted, no spaces
  const msg = JSON.stringify({ ev: c.ev, n: c.n, pid: uid, vid: c.vid });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(msg));
  return JSON.stringify({ t: "resp", cred: device.credential, sig: b64u(sig) });
}

async function submitCode(page: Page, text: string) {
  const box = page.locator(".type-code");
  if (!(await box.getAttribute("open"))) await box.locator("summary").click();
  await box.locator("textarea").fill(text);
  await box.getByRole("button", { name: "Use this code" }).click();
}

test("A13: offline check-in works, a reused screenshot is rejected, and it syncs after reconnecting", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const page = await ctx.newPage();
  const problems = watch(page);

  // Volunteer PIN login → lands on the scanner.
  await page.goto("/scan");
  await page.getByLabel("Event code").fill("HACK26");
  await page.getByLabel("6-digit PIN").fill("100001");
  await page.getByRole("button", { name: "Sign in to scanner" }).click();
  await expect(page.getByRole("button", { name: "Start check-in" })).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator(".scan-stats")).toContainText("200");

  // Airplane mode.
  await ctx.setOffline(true);
  await expect(page.locator(".scan-top")).toContainText("Offline");
  await page.getByRole("button", { name: "Start check-in" }).click();
  const challenge = (await page.locator("canvas.qr-canvas").getAttribute("data-text"))!;
  const { t, ev } = JSON.parse(challenge) as { t: string; ev: string };
  expect(t).toBe("chal");
  // A simulated phone enrolled in this event (pnpm simulate enroll).
  const uid = Object.keys(sim).find((k) => sim[k]!.eventId === ev);
  expect(uid, "run pnpm simulate enroll after seeding").toBeTruthy();
  const response = await respond(uid!, challenge);

  await page.getByRole("button", { name: /Scan their response/ }).click();
  await submitCode(page, response);
  await expect(page.locator(".scan-result-screen.valid")).toBeVisible();
  await expect(page.locator(".scan-result-screen")).toContainText(sim[uid!]!.name);
  await expect(page.locator(".scan-result-screen .seat")).toContainText(/-\d+/);
  await page.getByRole("button", { name: "Next person" }).click();

  // The same response again (a screenshot) is rejected.
  await page.getByRole("button", { name: /Scan their response/ }).click();
  await submitCode(page, response);
  await expect(page.locator(".scan-result-screen.rejected")).toBeVisible();
  await expect(page.locator(".scan-result-screen")).toContainText(/screenshot|reused|cloned/i);
  await page.getByRole("button", { name: "Next person" }).click();

  // Still offline: both attempts are waiting to sync.
  await page.getByRole("button", { name: "← Scanner" }).click();
  await expect(page.locator(".scan-top")).toContainText("2 to sync");

  // Back online: the queue uploads and the server confirms.
  await ctx.setOffline(false);
  await expect(page.locator(".scan-top")).toContainText("All synced", { timeout: 45_000 });
  expect(problems.filter((p) => !p.startsWith("pageerror: Failed to fetch"))).toEqual([]);
  await ctx.close();
});
