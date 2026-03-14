import {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  Options,
  ActivityType,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
} from "discord.js";
import { SlashCommandBuilder } from "discord.js";

export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export type BotClient = Client & {
  commands: Collection<string, Command>;
};

export function createClient(): BotClient {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],

    partials: [
      Partials.GuildMember,
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
    ],

    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 50,
      PresenceManager: 0,
    }),

    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: {
        interval: 3600,
        lifetime: 1800,
      },
    },

    presence: {
      activities: [{ name: "iDinox v3", type: ActivityType.Playing }],
    },
  }) as BotClient;

  client.commands = new Collection();

  return client;
}
