import { Client } from "discord.js";
import {
    readdirSync,
    existsSync
} from "node:fs";
import { join, dirname } from "node:path";
import {
    fileURLToPath,
    pathToFileURL
} from "node:url";
import { logger } from "../utils/logger.js";

interface EventModule {
    name: string;
    once?: boolean;
    execute: (...args: unknown[]) => Promise<unknown>;
    loadCache?: () => Promise<void>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadEvents(client: Client): Promise<void> {
    const start = Date.now();
    const eventsPath = join(__dirname, "../events");

    if (!existsSync(eventsPath)) {
        logger.warn("Events directory not found — skipping.");
        return;
    }

    const files = readdirSync(eventsPath).filter(
        (f) => f.endsWith(".js") || f.endsWith(".ts")
    );

    for (const file of files) {
        const filePath = pathToFileURL(join(eventsPath, file)).href;

        try {
            const event: EventModule = (await import(filePath)).default;

            if (!event?.name || !event?.execute) {
                logger.warn(`Invalid event module: ${file} — skipped.`);
                continue;
            }

            if (typeof event.loadCache === "function") {
                await event.loadCache();
                logger.info(`Cache loaded: ${event.name}`);
            }

            const handler = async (...args: unknown[]) => {
                try {
                    await event.execute(...args, client);
                } catch (error) {
                    logger.error(`Error in event ${event.name}`, error);
                }
            };

            event.once
                ? client.once(event.name, handler)
                : client.on(event.name, handler);

            logger.success(`Event registered: ${event.name}`);
        } catch (error) {
            logger.error(`Failed to load event ${file}`, error);
        }
    }

    logger.success(`Events loader — ${files.length} events in ${Date.now() - start}ms`);
}