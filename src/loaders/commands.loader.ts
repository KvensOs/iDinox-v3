import { REST, Routes, RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { logger } from "../utils/logger.js";
import { BotClient, Command } from "../core/client.js";
import { startExpireSignOffersTask } from "../tasks/expireSignOffers.js";

const GLOBAL = false;
const CLEAR = false;

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadCommands(client: BotClient): Promise<void> {
    const start = Date.now();

    const commandsPath = join(__dirname, "../commands");
    const commandsPayload: RESTPostAPIApplicationCommandsJSONBody[] = [];

    const files = readdirSync(commandsPath).filter(
        (f) => f.endsWith(".js") || f.endsWith(".ts")
    );

    for (const file of files) {
        const filePath = pathToFileURL(join(commandsPath, file)).href;

        try {
            const mod: Command = (await import(filePath)).default;

            if (!mod?.data || !mod?.execute) {
                logger.warn(`Command ${file} is missing required structure — skipped.`);
                continue;
            }

            client.commands.set(mod.data.name, mod);
            commandsPayload.push(mod.data.toJSON());
        } catch (error) {
            logger.error(`Failed to load command ${file}`, error);
        }
    }

    client.once("clientReady", async () => {
        if (!client.user) return;
        startExpireSignOffersTask(client);
        await registerCommands(client.user.id, commandsPayload);
    });

    logger.success(`Commands loader — ${Date.now() - start}ms`);
}

async function registerCommands(clientId: string, payload: RESTPostAPIApplicationCommandsJSONBody[]): Promise<void> {
    if (!GLOBAL && !process.env.GUILD_ID) {
        logger.error("GUILD_ID is not set — cannot register guild commands.");
        return;
    }

    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);
    const body = CLEAR ? [] : payload;
    const mode = GLOBAL ? "GLOBAL" : "GUILD";
    const route = GLOBAL
        ? Routes.applicationCommands(clientId)
        : Routes.applicationGuildCommands(clientId, process.env.GUILD_ID!);

    try {
        await rest.put(route, { body });
        logger.success(
            CLEAR
                ? `Commands cleared (${mode})`
                : `${payload.length} commands registered (${mode})`
        );
    } catch (error) {
        logger.error("Failed to register commands with Discord API", error);
    }
}