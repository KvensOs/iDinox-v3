import {
  Client,
  EmbedBuilder,
  TextChannel,
  Message,
  AttachmentBuilder,
} from "discord.js";
import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Op } from "sequelize";
import { SignOffer } from "../database/models/SignOffer.js";
import { Team } from "../database/models/Team.js";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGOS_DIR = path.join(__dirname, "../../logos");
const FONDO_PATH = path.join(LOGOS_DIR, "fondo_fichajes.png");

const fileExists = (p: string): Promise<boolean> =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false);

const INTERVAL_MS = 5 * 60 * 1_000;

async function processExpiredOffers(client: Client): Promise<void> {
  const expired = await SignOffer.findAll({
    where: { status: "pending", expiresAt: { [Op.lte]: new Date() } },
  });

  if (expired.length === 0) return;

  logger.info(`Expiring ${expired.length} offer(s)…`);
  await Promise.allSettled(expired.map((offer) => expireOne(client, offer)));
}

async function expireOne(client: Client, offer: SignOffer): Promise<void> {
  try {
    const channel = (await client.channels
      .fetch(offer.channelId)
      .catch(() => null)) as TextChannel | null;

    if (channel?.isTextBased()) {
      const msg: Message | null = await channel.messages
        .fetch(offer.messageId)
        .catch(() => null);

      if (msg?.editable && msg.embeds[0]) {
        const team = await Team.findByPk(offer.teamId);
        const resolvedLogoFilename = team?.logoPath
          ? path.basename(team.logoPath)
          : null;
        const logoFullPath = resolvedLogoFilename
          ? path.join(LOGOS_DIR, resolvedLogoFilename)
          : null;

        const [logoExists, fondoExists] = await Promise.all([
          logoFullPath ? fileExists(logoFullPath) : Promise.resolve(false),
          fileExists(FONDO_PATH),
        ]);

        const files: AttachmentBuilder[] = [];
        if (logoExists && logoFullPath && resolvedLogoFilename)
          files.push(
            new AttachmentBuilder(logoFullPath, { name: resolvedLogoFilename }),
          );
        if (fondoExists)
          files.push(
            new AttachmentBuilder(FONDO_PATH, { name: "fondo_fichajes.png" }),
          );

        const updated = EmbedBuilder.from(msg.embeds[0])
          .setColor(0x95a5a6)
          .spliceFields(5, 1, {
            name: "📋 Estado",
            value: "⌛ Vencida",
            inline: true,
          })
          .setFooter({ text: "Oferta vencida · iDinox v3" });

        if (logoExists && resolvedLogoFilename)
          updated.setThumbnail(`attachment://${resolvedLogoFilename}`);
        if (fondoExists) updated.setImage("attachment://fondo_fichajes.png");

        await msg.edit({ embeds: [updated], components: [], files });
      }
    }

    await offer.destroy();
    logger.info(
      `Offer #${offer.id} expired (target: ${offer.targetDiscordId}, modality: ${offer.modalityId})`,
    );
  } catch (err) {
    logger.error(`Failed to expire offer #${offer.id}`, err);
  }
}

export function startExpireSignOffersTask(client: Client): void {
  const run = () =>
    processExpiredOffers(client).catch((err) =>
      logger.error("expireSignOffers task error", err),
    );

  void run();
  setInterval(run, INTERVAL_MS);
  logger.info(
    `expireSignOffers task started — interval: ${INTERVAL_MS / 1000}s`,
  );
}
