import chalk from "chalk";
import { WebhookClient, EmbedBuilder } from "discord.js";

type LogLevel = "info" | "success" | "warn" | "error" | "fatal";

const SEPARATOR = chalk.gray("─".repeat(60));

const LEVELS: Record<
  LogLevel,
  {
    color: (s: string) => string;
    embedColor: number;
    emoji: string;
  }
> = {
  info: { color: chalk.blueBright, embedColor: 0x3b9eff, emoji: "ℹ️" },
  success: { color: chalk.greenBright, embedColor: 0x57f287, emoji: "✅" },
  warn: { color: chalk.yellowBright, embedColor: 0xfee75c, emoji: "⚠️" },
  error: { color: chalk.redBright, embedColor: 0xed4245, emoji: "❌" },
  fatal: { color: chalk.bgRed.white.bold, embedColor: 0xed4245, emoji: "💀" },
};

function resolveWebhook(): WebhookClient | null {
  const url = process.env.LOGS_WEBHOOK_URL;
  if (!url) return null;

  try {
    new URL(url);
    return new WebhookClient({ url });
  } catch {
    return null;
  }
}

const webhook = resolveWebhook();

function write(level: LogLevel, message: string, error?: unknown): void {
  const { color, embedColor, emoji } = LEVELS[level];
  const ts = new Date().toISOString();

  console.log(color(`[${ts}] [${level.toUpperCase()}] ${message}`));

  if (error) {
    const detail =
      error instanceof Error
        ? error.stack
        : typeof error === "object"
          ? JSON.stringify(error, null, 2)
          : String(error);

    console.log(SEPARATOR);
    console.error(chalk.red(detail));
    console.log(SEPARATOR);
  }

  if (webhook) {
    const description = error
      ? `${emoji} **${message}**\n\`\`\`\n${
          error instanceof Error
            ? error.stack
            : typeof error === "object"
              ? JSON.stringify(error, null, 2)
              : String(error)
        }\n\`\`\``
      : `${emoji} **${message}**`;

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setDescription(description.slice(0, 4096))
      .setFooter({ text: `iDinox v3 · ${level.toUpperCase()}` })
      .setTimestamp();

    void webhook.send({ embeds: [embed] }).catch(() => null);
  }
}

export const logger = {
  info: (msg: string) => write("info", msg),
  success: (msg: string) => write("success", msg),
  warn: (msg: string) => write("warn", msg),
  error: (msg: string, err?: unknown) => write("error", msg, err),
  fatal: (msg: string, err?: unknown) => write("fatal", msg, err),
};
