import { Events, Message, EmbedBuilder, GuildMember } from "discord.js";
import { Modality } from "../database/models/Modality.js";
import { Season } from "../database/models/Season.js";
import { Competition } from "../database/models/Competition.js";
import { Player } from "../database/models/Player.js";
import { isModalityAdmin } from "../utils/permissions.js";
import { parseStats, applyStats, sendStatsLog } from "../utils/statsHelper.js";

function shouldIgnore(message: Message): boolean {
  return message.author.bot || !!message.webhookId || !message.guild;
}

function isBotMentioned(message: Message, botId: string): boolean {
  if (message.mentions.everyone) return false;
  if (message.mentions.roles.size > 0 && !message.mentions.users.has(botId))
    return false;
  return (
    message.mentions.users.has(botId) ||
    message.content.includes(`<@${botId}>`) ||
    message.content.includes(`<@!${botId}>`)
  );
}

async function findCompetitionByChannel(channelId: string): Promise<{
  competition: Competition;
  season: Season;
  modality: Modality;
} | null> {
  const competition = await Competition.findOne({
    where: {
      canalEstadisticas: channelId,
      isActive: true,
    },
    include: [
      {
        model: Season,
        as: "season",
        where: { isActive: true },
        required: true,
        include: [
          {
            model: Modality,
            as: "modality",
            where: { isActive: true },
            required: true,
          },
        ],
      },
    ],
  });

  if (!competition) return null;

  const season = (
    competition as unknown as { season: Season & { modality: Modality } }
  ).season;
  const modality = season.modality;

  return { competition, season, modality };
}

function parseChannelMessage(message: Message): {
  targetUser: import("discord.js").User;
  rawStats: string;
} | null {
  const mentionedUser = message.mentions.users.first();
  if (!mentionedUser || mentionedUser.bot) return null;

  const withoutMention = message.content.replace(/<@!?\d+>/g, "").trim();

  if (!withoutMention) return null;

  return { targetUser: mentionedUser, rawStats: withoutMention };
}

async function handleStatsChannel(message: Message): Promise<boolean> {
  const match = await findCompetitionByChannel(message.channelId);
  if (!match) return false;

  const { competition, season, modality } = match;
  const member = message.member as GuildMember;
  const settings = modality.settings;

  const hasEstadistiquero = settings.rol_estadistiquero
    ? member.roles.cache.has(settings.rol_estadistiquero)
    : false;
  const hasAdmin = isModalityAdmin(member, message.client, settings);

  if (!hasEstadistiquero && !hasAdmin) {
    await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(
              "No tienes permisos para registrar estadísticas en esta modalidad.",
            ),
        ],
      })
      .catch(() => null);
    return true;
  }

  const parsed = parseChannelMessage(message);
  if (!parsed) return true;

  const { targetUser, rawStats } = parsed;

  const { deltas, errors } = parseStats(rawStats);

  if (errors.length) {
    await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("Formato incorrecto")
            .setDescription(errors.join("\n"))
            .setFooter({ text: "Ejemplo: @Jugador g2 a1 cs1 | @Jugador g-1" }),
        ],
      })
      .catch(() => null);
    return true;
  }

  if (!Object.keys(deltas).length) {
    await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe67e22)
            .setDescription("No se detectaron stats válidas en el mensaje."),
        ],
      })
      .catch(() => null);
    return true;
  }

  const targetPlayer = await Player.findOne({
    where: { discordId: targetUser.id },
  });
  if (!targetPlayer) {
    await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(
              `**${targetUser.username}** no está registrado en iDinox.`,
            ),
        ],
      })
      .catch(() => null);
    return true;
  }

  const result = await applyStats(
    modality,
    competition,
    targetPlayer,
    season,
    deltas,
  );

  if (!result.success) {
    await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(
              result.errorMessage ?? "No se pudieron aplicar las estadísticas.",
            ),
        ],
      })
      .catch(() => null);
    return true;
  }

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Estadísticas actualizadas")
    .addFields(
      { name: "Jugador", value: `\`${targetPlayer.username}\``, inline: true },
      { name: "Competicion", value: `\`${competition.name}\``, inline: true },
      { name: "Cambios", value: result.appliedChanges.join("\n") },
    )
    .setTimestamp();

  if (result.clampedKeys.length)
    embed.setFooter({
      text: `Clamp aplicado en: ${result.clampedKeys.join(", ")}`,
    });

  await message.reply({ embeds: [embed] }).catch(() => null);

  await sendStatsLog(
    message.client,
    modality,
    competition,
    targetPlayer,
    member,
    result.appliedChanges,
    result.clampedKeys,
  );

  return true;
}

export default {
  name: Events.MessageCreate,

  async execute(message: Message): Promise<void> {
    if (shouldIgnore(message)) return;

    const handledAsStats = await handleStatsChannel(message);
    if (handledAsStats) return;

    const botId = message.client.user?.id;
    if (!botId || !isBotMentioned(message, botId)) return;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("👋 ¡Hola!")
      .setDescription(
        "Soy **iDinox v3**, el sistema de gestión de ligas.\n" +
          "Usa `/ayuda` para ver todos los comandos disponibles.",
      )
      .addFields(
        { name: "Comandos", value: "`/ayuda`", inline: true },
        { name: "Registro", value: "`/start`", inline: true },
        { name: "Perfil", value: "`/perfil`", inline: true },
      )
      .setFooter({ text: "iDinox v3" })
      .setTimestamp();

    await message.reply({ embeds: [embed] }).catch(() => null);
  },
};
