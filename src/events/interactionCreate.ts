import {
  Interaction,
  ButtonInteraction,
  MessageFlags,
  EmbedBuilder,
  AttachmentBuilder,
  GuildMember,
  InteractionReplyOptions,
} from "discord.js";
import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { logger } from "../utils/logger.js";
import { BotClient } from "../core/client.js";
import { Participant, Position } from "../database/models/Participant.js";
import { Player } from "../database/models/Player.js";
import { Team } from "../database/models/Team.js";
import { Season } from "../database/models/Season.js";
import {
  Modality,
  DEFAULT_SETTINGS,
  ModalitySettings,
} from "../database/models/Modality.js";
import { SignOffer } from "../database/models/SignOffer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGOS_DIR = path.join(__dirname, "../../logos");
const FONDO_PATH = path.join(LOGOS_DIR, "fondo_fichajes.png");

const fileExists = (p: string): Promise<boolean> =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false);

interface SignPayload {
  action: "accept" | "reject" | "cancel";
  modalityId: number;
  teamId: number;
  targetId: string;
  dtId: string;
  dtIsMainDT: boolean;
  position: string;
}

function resolveSettings(
  raw: Partial<ModalitySettings> | null,
): ModalitySettings {
  return { ...DEFAULT_SETTINGS, ...raw };
}

function parseSignCustomId(customId: string): SignPayload | null {
  const parts = customId.split("_");
  if (parts.length < 8 || parts[0] !== "sign") return null;

  const action = parts[1] as SignPayload["action"];
  if (!["accept", "reject", "cancel"].includes(action)) return null;

  return {
    action,
    modalityId: Number(parts[2]),
    teamId: Number(parts[3]),
    targetId: parts[4],
    dtId: parts[5],
    dtIsMainDT: parts[6] === "1",
    position: parts.slice(7).join("_"),
  };
}

function errorEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(0xe74c3c).setDescription(description);
}

function ephemeral(embeds: EmbedBuilder[]): InteractionReplyOptions {
  return { embeds, flags: MessageFlags.Ephemeral };
}

async function handleSignButton(interaction: ButtonInteraction): Promise<void> {
  const payload = parseSignCustomId(interaction.customId);
  if (!payload) return;

  const { action, modalityId, teamId, targetId, dtId, position } = payload;
  const who = interaction.user.id;

  if ((action === "accept" || action === "reject") && who !== targetId) {
    await interaction.reply(
      ephemeral([
        errorEmbed(
          "Solo el jugador al que se le envió la oferta puede responderla.",
        ),
      ]),
    );
    return;
  }

  if (action === "cancel" && who !== dtId) {
    const modality = await Modality.findByPk(modalityId);
    const settings = resolveSettings(modality?.settings ?? null);
    const member = interaction.member as GuildMember | null;
    const isMainDT = !!(
      settings.rol_dt && member?.roles.cache.has(settings.rol_dt)
    );

    if (!isMainDT) {
      await interaction.reply(
        ephemeral([
          errorEmbed(
            "Solo quien envió la oferta o el DT principal puede retirarla.",
          ),
        ]),
      );
      return;
    }
  }

  await interaction.deferUpdate();

  const [modality, team, season] = await Promise.all([
    Modality.findByPk(modalityId),
    Team.findByPk(teamId),
    Season.findOne({ where: { modalityId, isActive: true } }),
  ]);

  if (!modality || !team || !season) {
    await interaction.followUp(
      ephemeral([
        errorEmbed(
          "Esta oferta ya no es válida (modalidad, equipo o temporada no encontrados).",
        ),
      ]),
    );
    return;
  }

  const settings = resolveSettings(modality.settings);
  const messageId = interaction.message.id;
  const [targetUser, dtUser] = await Promise.all([
    interaction.client.users.fetch(targetId).catch(() => null),
    interaction.client.users.fetch(dtId).catch(() => null),
  ]);

  const displayTarget =
    targetUser?.globalName ?? targetUser?.username ?? targetId;

  const resolvedLogoFilename = team.logoPath
    ? path.basename(team.logoPath)
    : null;
  const logoFullPath = resolvedLogoFilename
    ? path.join(LOGOS_DIR, resolvedLogoFilename)
    : null;
  const [logoExists, fondoExists] = await Promise.all([
    logoFullPath ? fileExists(logoFullPath) : Promise.resolve(false),
    fileExists(FONDO_PATH),
  ]);

  const buildFiles = (): AttachmentBuilder[] => {
    const files: AttachmentBuilder[] = [];
    if (logoExists && logoFullPath && resolvedLogoFilename)
      files.push(
        new AttachmentBuilder(logoFullPath, { name: resolvedLogoFilename }),
      );
    if (fondoExists)
      files.push(
        new AttachmentBuilder(FONDO_PATH, { name: "fondo_fichajes.png" }),
      );
    return files;
  };

  const buildUpdated = (color: number, estadoLabel: string, footer: string) => {
    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(color)
      .spliceFields(5, 1, {
        name: "📋 Estado",
        value: estadoLabel,
        inline: true,
      })
      .setFooter({ text: footer })
      .setTimestamp();

    if (logoExists && resolvedLogoFilename)
      embed.setThumbnail(`attachment://${resolvedLogoFilename}`);
    if (fondoExists) embed.setImage("attachment://fondo_fichajes.png");

    return embed;
  };

  if (action === "cancel") {
    const updated = buildUpdated(
      0xe67e22,
      "🚫 Oferta retirada",
      `Retirada por <@${who}> · iDinox v3 · ${modality.displayName}`,
    );
    await Promise.all([
      interaction.editReply({
        embeds: [updated],
        components: [],
        files: buildFiles(),
      }),
      SignOffer.destroy({ where: { messageId } }),
    ]);
    await targetUser
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe67e22)
            .setTitle("Oferta retirada")
            .setDescription(
              `La oferta de **${team.name}** en **iDinox ${modality.displayName}** ha sido retirada.`,
            ),
        ],
      })
      .catch(() => null);
    logger.info(
      `/market sign | RETIRADA | ${team.name} → ${displayTarget} en ${modality.displayName} | por <@${who}>`,
    );
    return;
  }

  if (action === "reject") {
    const updated = buildUpdated(
      0xed4245,
      "❌ Oferta rechazada",
      `Rechazada · iDinox v3 · ${modality.displayName}`,
    );
    await Promise.all([
      interaction.editReply({
        embeds: [updated],
        components: [],
        files: buildFiles(),
      }),
      SignOffer.destroy({ where: { messageId } }),
    ]);
    await dtUser
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("Oferta rechazada")
            .setDescription(
              `**${displayTarget}** ha rechazado tu oferta para **${team.name}** en **iDinox ${modality.displayName}**.`,
            ),
        ],
      })
      .catch(() => null);
    logger.info(
      `/market sign | RECHAZADA | ${team.name} → ${displayTarget} en ${modality.displayName}`,
    );
    return;
  }

  if (!settings.marketOpen) {
    await interaction.followUp(
      ephemeral([
        errorEmbed(
          "El mercado ya está cerrado. No se puede completar el fichaje.",
        ),
      ]),
    );
    return;
  }

  const [targetPlayer] = await Player.findOrCreate({
    where: { discordId: targetId },
    defaults: {
      discordId: targetId,
      username: targetUser?.username ?? targetId,
      globalName: targetUser?.globalName ?? null,
    },
  });

  const existingParticipant = await Participant.findOne({
    where: { playerId: targetPlayer.id, seasonId: season.id, modalityId },
  });

  if (existingParticipant?.teamId) {
    await interaction.followUp(
      ephemeral([
        errorEmbed(
          "Ya perteneces a un equipo en esta temporada. El fichaje no puede completarse.",
        ),
      ]),
    );
    return;
  }

  const roster = await Participant.count({
    where: { teamId, seasonId: season.id, isActive: true },
  });
  if (roster >= modality.playersPerTeam) {
    await interaction.followUp(
      ephemeral([
        errorEmbed(
          `**${team.name}** ya tiene la plantilla completa (${roster}/${modality.playersPerTeam}).`,
        ),
      ]),
    );
    return;
  }

  const positionFinal = (
    position && position !== "N/A"
      ? position
      : (existingParticipant?.position ?? "N/A")
  ) as Position;

  await Promise.all([
    existingParticipant
      ? ((existingParticipant.teamId = teamId),
        (existingParticipant.isActive = true),
        position &&
          position !== "N/A" &&
          (existingParticipant.position = position as Position),
        existingParticipant.save())
      : Participant.create({
          playerId: targetPlayer.id,
          seasonId: season.id,
          modalityId,
          teamId,
          position: positionFinal,
          isActive: true,
        }),
    SignOffer.destroy({ where: { messageId } }),
  ]);

  const targetMember = await interaction.guild?.members
    .fetch(targetId)
    .catch(() => null);
  if (targetMember) {
    const displayName =
      targetUser?.globalName ?? targetUser?.username ?? targetId;
    await targetMember
      .setNickname(`#${team.abbreviation} ${displayName}`.slice(0, 32))
      .catch(() => null);
    const teamRole = interaction.guild?.roles.cache.get(team.roleId);
    if (teamRole) await targetMember.roles.add(teamRole).catch(() => null);
  }

  const updated = buildUpdated(
    0x57f287,
    "✅ Fichaje completado",
    `Aceptado · iDinox v3 · ${modality.displayName}`,
  );
  await interaction.editReply({
    embeds: [updated],
    components: [],
    files: buildFiles(),
  });

  await dtUser
    ?.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("✅ Fichaje aceptado")
          .setDescription(
            `**${displayTarget}** ha aceptado tu oferta y se une a **${team.name}** en **iDinox ${modality.displayName}**.`,
          )
          .addFields({
            name: "📍 Posición",
            value: `\`${positionFinal}\``,
            inline: true,
          }),
      ],
    })
    .catch(() => null);

  logger.success(
    `/market sign | ACEPTADO | ${displayTarget} → **${team.name}** en ${modality.displayName} · pos: ${positionFinal}`,
  );
}

export default {
  name: "interactionCreate",

  async execute(interaction: Interaction): Promise<void> {
    const client = interaction.client as BotClient;

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      await command?.autocomplete?.(interaction).catch((err) => {
        logger.error(`Autocomplete error /${interaction.commandName}`, err);
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("sign_")) {
      await handleSignButton(interaction).catch(async (err) => {
        logger.error("Sign button error", err);
        logger.error("interactionCreate | handleSignButton", err);
        await interaction
          .followUp(
            ephemeral([
              new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle("Algo salió mal")
                .setDescription(
                  "No se pudo procesar la respuesta. El equipo técnico fue notificado.",
                ),
            ]),
          )
          .catch(() => null);
      });
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`Command not found: ${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      const context = `/${interaction.commandName} | ${interaction.user.id} (${interaction.user.username}) | guild: ${interaction.guildId}`;
      logger.error(`Command error ${context}`, error);
      logger.error(context, error);

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("Algo salió mal")
        .setDescription(
          "Ocurrió un error al ejecutar este comando.\nEl equipo técnico ha sido notificado automáticamente.",
        )
        .setTimestamp();

      interaction.replied || interaction.deferred
        ? await interaction.followUp(ephemeral([embed]))
        : await interaction.reply(ephemeral([embed]));
    }
  },
};
