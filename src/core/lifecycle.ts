import { Client } from "discord.js";
import { logger } from "../utils/logger.js";

// ─────────────────────────────────────────────
//  Lifecycle
// ─────────────────────────────────────────────

export function registerLifecycle(client: Client): void {
    process.on("unhandledRejection", (reason) => {
        void logger.error("Unhandled rejection", reason);
    });

    process.on("uncaughtException", (error) => {
        void logger.fatal("Uncaught exception", error);
        process.exit(1);
    });

    process.on("SIGINT", () => shutdown(client, "SIGINT"));
    process.on("SIGTERM", () => shutdown(client, "SIGTERM"));
}

// ─────────────────────────────────────────────
//  Shutdown
// ─────────────────────────────────────────────

function shutdown(client: Client, signal: string): void {
    logger.warn(`Shutting down (${signal})…`);
    try {
        void client.destroy();
        process.exit(0);
    } catch {
        process.exit(1);
    }
}