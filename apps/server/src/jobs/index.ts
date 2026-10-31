import cron from "node-cron";
import { rebalanceDueSlots } from "../admin/allotment/allotment.service.js";
import { updateSeenCounts } from "../admin/announcements/announcements.js";
import { remindDueTasks } from "../admin/ops/routes.js";
import { releaseDueProblems } from "../admin/problems/problems.js";
import { escalateOverdueComplaints, markOverdueRewards } from "../admin/rewards/rewards.js";
import { startCheckinListener } from "../admin/checkins/processor.js";
import { expireInvites } from "../admin/replacement/replacement.service.js";
import { expireWaitlistOffers } from "../admin/replacement/waitlist.js";
import { lockTeamsIfDue } from "../admin/teams/lock.js";
import { listEventIds } from "../core/events.js";
import { stats } from "../core/stats.js";

// Cron jobs and Firestore listeners (replace scheduled and triggered Cloud Functions).

function forEachEvent(name: string, fn: (eventId: string) => Promise<unknown>) {
  return async () => {
    for (const eventId of await listEventIds()) {
      try {
        await fn(eventId);
      } catch (err) {
        console.error(`[job:${name}] ${eventId} failed`, err);
      }
    }
  };
}

export function startJobs(): () => void {
  const tasks = [
    cron.schedule("* * * * *", forEachEvent("teamLock", lockTeamsIfDue), { name: "teamLock", noOverlap: true }),
    cron.schedule("* * * * *", forEachEvent("replacementExpiry", expireInvites), {
      name: "replacementExpiry",
      noOverlap: true,
    }),
    cron.schedule("* * * * *", forEachEvent("waitlistExpiry", expireWaitlistOffers), {
      name: "waitlistExpiry",
      noOverlap: true,
    }),
    cron.schedule("* * * * *", forEachEvent("problemRelease", releaseDueProblems), { name: "problemRelease", noOverlap: true }),
    cron.schedule("* * * * *", forEachEvent("taskReminders", remindDueTasks), { name: "taskReminders", noOverlap: true }),
    cron.schedule("* * * * *", forEachEvent("seenCounts", updateSeenCounts), { name: "seenCounts", noOverlap: true }),
    cron.schedule("*/10 * * * *", forEachEvent("rewardOverdue", markOverdueRewards), { name: "rewardOverdue", noOverlap: true }),
    cron.schedule("*/10 * * * *", forEachEvent("complaintEscalation", escalateOverdueComplaints), {
      name: "complaintEscalation",
      noOverlap: true,
    }),
    cron.schedule("*/5 * * * *", forEachEvent("rebalance", rebalanceDueSlots), { name: "rebalance", noOverlap: true }),
    // Nightly full recount corrects any drift in the live counters.
    cron.schedule("0 3 * * *", forEachEvent("statsRecompute", stats.recompute), {
      name: "statsRecompute",
      timezone: "Asia/Kolkata",
    }),
  ];
  stats.start();
  const stopListener = startCheckinListener();
  console.log("[jobs] cron jobs and check-in listener started");

  return () => {
    for (const t of tasks) void t.stop();
    stats.stop();
    stopListener();
  };
}
