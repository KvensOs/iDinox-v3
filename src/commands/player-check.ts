import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  GuildMember,
  AutocompleteInteraction,
} from "discord.js";

import { Player } from "../database/models/Player.js";
import { Participant } from "../database/models/Participant.js";
import { Team } from "../database/models/Team.js";
import { Season } from "../database/models/Season.js";
import {
  Modality,
  ModalitySettings,
  DEFAULT_SETTINGS,
} from "../database/models/Modality.js";
import { logger } from "../utils/logger.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";

const resolveSettings = (
  raw: Partial<ModalitySettings> | null,
): ModalitySettings => ({ ...DEFAULT_SETTINGS, ...raw });

function getRoles(member: GuildMember | null, s: ModalitySettings): string {
  if (!member) return "`—`";
  const r: string[] = [];
  if (s.rol_dt && member.roles.cache.has(s.rol_dt)) r.push("DT");
  if (s.rol_sub_dt && member.roles.cache.has(s.rol_sub_dt)) r.push("Sub-DT");
  if (s.rol_admin && member.roles.cache.has(s.rol_admin)) r.push("Admin");
  return r.length ? r.map((x) => `\`${x}\``).join(" · ") : "`—`";
}

export default {
  category: "📊 Carrera & Estadísticas",
  emoji: "🔍",
  usage: "/player-check [jugador] (modalidad)",

  data: new SlashCommandBuilder()
    .setName("player-check")
    .setDescription(
      "Verifica el estado de un jugador en las modalidades activas.",
    )
    .setDMPermission(false)
    .addUserOption((opt) =>
      opt
        .setName("jugador")
        .setDescription("Jugador a verificar (por defecto: tú).")
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName("modalidad")
        .setDescription("Filtrar por modalidad (opcional).")
        .setRequired(false)
        .setAutocomplete(true),
    ),

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await autocompleteModality(interaction);
  },

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser =
      interaction.options.getUser("jugador") ?? interaction.user;
    const modalityName = interaction.options.getString("modalidad");

    if (targetUser.bot) {
      await interaction.editReply({
        content: "Los bots no tienen ficha en iDinox.",
      });
      return;
    }

    try {
      const member =
        (await interaction.guild?.members
          .fetch(targetUser.id)
          .catch(() => null)) ?? null;

      const modalities = await Modality.findAll({
        where: {
          isActive: true,
          ...(modalityName ? { name: modalityName } : {}),
        },
      });

      if (!modalities.length) {
        await interaction.editReply({ content: "No hay modalidades activas." });
        return;
      }

      const player = await Player.findOne({
        where: { discordId: targetUser.id },
      });
      const displayName = targetUser.globalName ?? targetUser.username;
      const color =
        member?.displayHexColor && member.displayHexColor !== "#000000"
          ? member.displayHexColor
          : "#2B2D31";

      const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({
          name: `Player Check · ${displayName}`,
          iconURL: targetUser.displayAvatarURL({ size: 256 }),
        })
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .setFooter({ text: "iDinox v3" })
        .setTimestamp();

      embed.addFields({
        name: "――――――――――――――――――――",
        value: [
          `**Usuario** <@${targetUser.id}>`,
          `**ID** \`${targetUser.id}\``,
          `**Registro** ${player ? "sí" : "**no** — nunca usó `/start`"}`,
        ].join("\n"),
        inline: false,
      });

      if (!player) {
        for (const modality of modalities) {
          const roles = getRoles(member, resolveSettings(modality.settings));
          embed.addFields({
            name: `· ${modality.displayName}`,
            value: `\`sin ficha\`  ·  roles: ${roles}`,
            inline: true,
          });
        }
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      for (const modality of modalities) {
        const settings = resolveSettings(modality.settings);
        const season = await Season.findOne({
          where: { modalityId: modality.id, isActive: true },
        });
        const roles = getRoles(member, settings);

        if (!season) {
          embed.addFields({
            name: `· ${modality.displayName}`,
            value: `\`sin temporada activa\`\n↳ roles: ${roles}`,
            inline: true,
          });
          continue;
        }

        const participant = await Participant.findOne({
          where: {
            playerId: player.id,
            seasonId: season.id,
            modalityId: modality.id,
          },
        });

        if (!participant) {
          embed.addFields({
            name: `· ${modality.displayName}`,
            value: `\`sin ficha\`  ·  ${season.name}\n↳ roles: ${roles}`,
            inline: true,
          });
          continue;
        }

        const team = participant.teamId
          ? await Team.findByPk(participant.teamId)
          : null;
        const equipoStr = team
          ? `[${team.abbreviation}] ${team.name}`
          : "Agente libre";
        const estadoStr = participant.isActive ? "activo" : "~~inactivo~~";

        embed.addFields({
          name: `· ${modality.displayName}`,
          value: [
            `\`${season.name}\`  ·  ${estadoStr}`,
            `→ ${equipoStr}`,
            `→ \`${participant.position ?? "N/A"}\``,
            `↳ roles: ${roles}`,
          ].join("\n"),
          inline: true,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error(`/player-check | target: ${targetUser.id}`, error);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(
              "No se pudo verificar al jugador. El equipo técnico fue notificado.",
            ),
        ],
      });
    }
  },
};
