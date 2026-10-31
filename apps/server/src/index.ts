import { createApp } from "./app.js";
import { env } from "./core/env.js";
import { stats } from "./core/stats.js";
import { startJobs } from "./jobs/index.js";

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(
    `hackos-server listening on :${env.port} (${env.usingEmulators ? "emulators" : env.projectId})`,
  );
});

const stopJobs = env.jobsDisabled ? () => {} : startJobs();

async function shutdown() {
  stopJobs();
  await stats.flushAll().catch(() => {});
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
