import { logger } from "../utils/logger.js";

const REQUIRED_ENV = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID"] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

  if (missing.length === 0) return;

  logger.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}
