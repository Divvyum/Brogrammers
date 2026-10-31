import { createApp } from "./app.js";
import { env } from "./core/env.js";
import { stats } from "./core/stats.js";
import { ensureDefaultTemplates } from "./core/templates.js";
import { startJobs } from "./jobs/index.js";

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(
    `hackos-server listening on :${env.port} (${env.usingEmulators ? "emulators" : env.projectId})`,
  );
});

const stopJobs = env.jobsDisabled ? () => {} : startJobs();
ensureDefaultTemplates()
  .then((n) => n && console.log(`[templates] created ${n} default message templates`))
  .catch((e) => console.error("[templates] could not create defaults", e));

async function shutdown() {
  stopJobs();
  await stats.flushAll().catch(() => {});
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
