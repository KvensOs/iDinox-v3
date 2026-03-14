import "dotenv/config";
import { performance } from "node:perf_hooks";

import { validateEnv } from "./core/env.js";
import { connectDatabase } from "./core/database.js";
import { syncModels } from "./database/associations.js";
import { createClient } from "./core/client.js";
import { registerLifecycle } from "./core/lifecycle.js";
import { loadEvents } from "./loaders/events.loader.js";
import { loadCommands } from "./loaders/commands.loader.js";
import { logger } from "./utils/logger.js";

async function bootstrap(): Promise<void> {
  const start = performance.now();

  validateEnv();
  logger.info("iDinox v3 — starting up…");

  await connectDatabase();
  await syncModels({});

  const client = createClient();
  registerLifecycle(client);

  await loadEvents(client);
  await loadCommands(client);

  await client.login(process.env.DISCORD_TOKEN);

  const elapsed = (performance.now() - start).toFixed(2);
  logger.success(`iDinox v3 online  •  ${elapsed} ms`);
}

bootstrap().catch((error) => {
  logger.fatal("Fatal error during startup", error);
  process.exit(1);
});
