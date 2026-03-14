import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  GuildMember,
  AutocompleteInteraction,
} from "discord.js";

import { Team } from "../database/models/Team.js";
import { Player } from "../database/models/Player.js";
import { Participant } from "../database/models/Participant.js";
import {
  Modality,
  ModalitySettings,
  DEFAULT_SETTINGS,
} from "../database/models/Modality.js";
import { Season } from "../database/models/Season.js";
import { logger } from "../utils/logger.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";

const REGEX_COLORS = /^\/colors\b/i;

function resolveSettings(
  raw: Partial<ModalitySettings> | null,
): ModalitySettings {
  return { ...DEFAULT_SETTINGS, ...raw };
}

function isDTorSubDT(member: GuildMember, settings: ModalitySettings): boolean {
  if (settings.rol_dt && member.roles.cache.has(settings.rol_dt)) return true;
  if (settings.rol_sub_dt && member.roles.cache.has(settings.rol_sub_dt))
    return true;
  return false;
}

export default {
  category: "👥 Gestión de Equipos",
  emoji: "👕",
  usage: "/club-unis [modalidad] [uniforme_local] [uniforme_visitante]",

  data: new SlashCommandBuilder()
    .setName("club-unis")
    .setDescription("Edita los uniformes de tu equipo.")
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt
        .setName("modalidad")
        .setDescription("Modalidad de tu equipo.")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("uniforme_local")
        .setDescription("Uniforme local. Debe iniciar con /colors."),
    )
    .addStringOption((opt) =>
      opt
        .setName("uniforme_visitante")
        .setDescription("Uniforme visitante. Debe iniciar con /colors."),
    ),

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await autocompleteModality(interaction);
  },

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = interaction.member as GuildMember | null;
    const modalityName = interaction.options.getString("modalidad", true);
    const uniLocal = interaction.options.getString("uniforme_local")?.trim();
    const uniVisit = interaction.options
      .getString("uniforme_visitante")
      ?.trim();

    if (!member) {
      await interaction.editReply({
        content: "No se pudo verificar tu identidad en el servidor.",
      });
      return;
    }

    if (!uniLocal && !uniVisit) {
      await interaction.editReply({
        content:
          "Debes indicar al menos un uniforme (`uniforme_local` o `uniforme_visitante`).",
      });
      return;
    }

    if (uniLocal && !REGEX_COLORS.test(uniLocal)) {
      await interaction.editReply({
        content: "El uniforme local debe iniciar con `/colors`.",
      });
      return;
    }
    if (uniVisit && !REGEX_COLORS.test(uniVisit)) {
      await interaction.editReply({
        content: "El uniforme visitante debe iniciar con `/colors`.",
      });
      return;
    }

    try {
      const modality = await Modality.findOne({
        where: { name: modalityName, isActive: true },
      });
      if (!modality) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("Modalidad no encontrada")
              .setDescription(
                `La modalidad **${modalityName.toUpperCase()}** no existe o no está activa.`,
              ),
          ],
        });
        return;
      }

      const settings = resolveSettings(modality.settings);

      if (!isDTorSubDT(member, settings)) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("Sin permisos")
              .setDescription(
                "Solo los **Directores Técnicos** y **Sub-Directores Técnicos** pueden editar los uniformes de su equipo.",
              ),
          ],
        });
        return;
      }

      const season = await Season.findOne({
        where: { modalityId: modality.id, isActive: true },
      });
      if (!season) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe67e22)
              .setTitle("Sin temporada activa")
              .setDescription(
                `No hay una temporada activa en **${modality.displayName}**.`,
              ),
          ],
        });
        return;
      }

      const [player] = await Player.findOrCreate({
        where: { discordId: interaction.user.id },
        defaults: {
          discordId: interaction.user.id,
          username: interaction.user.username,
          globalName: interaction.user.globalName ?? null,
        },
      });

      const participant = await Participant.findOne({
        where: {
          playerId: player.id,
          seasonId: season.id,
          modalityId: modality.id,
        },
      });

      if (!participant?.teamId) {
        await interaction.editReply({
          content: `No estás asignado a ningún equipo en **${modality.displayName}** esta temporada.`,
        });
        return;
      }

      const team = await Team.findOne({
        where: { id: participant.teamId, isActive: true },
      });
      if (!team) {
        await interaction.editReply({
          content: "No se encontró tu equipo en el sistema.",
        });
        return;
      }

      const cambios: string[] = [];

      if (uniLocal && uniLocal !== team.uniformHome) {
        cambios.push("Uniforme local actualizado");
        team.uniformHome = uniLocal;
      }
      if (uniVisit && uniVisit !== team.uniformAway) {
        cambios.push("Uniforme visitante actualizado");
        team.uniformAway = uniVisit;
      }

      if (cambios.length === 0) {
        await interaction.editReply({
          content:
            "Los uniformes indicados son iguales a los actuales. Sin cambios.",
        });
        return;
      }

      await team.save();

      logger.success(
        `/club-unis | ${interaction.user.username} actualizó uniformes de **${team.name}** en ${modality.displayName}`,
      );

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("👕 Uniformes actualizados")
            .setDescription(
              `Los uniformes de **${team.name}** han sido actualizados.`,
            )
            .addFields(
              {
                name: "🏠 Local",
                value: `\`${team.uniformHome ?? "N/A"}\``,
                inline: false,
              },
              {
                name: "✈️ Visita",
                value: `\`${team.uniformAway ?? "N/A"}\``,
                inline: false,
              },
            )
            .setFooter({
              text: `iDinox v3 · ${modality.displayName} · ${season.name}`,
            })
            .setTimestamp(),
        ],
      });
    } catch (error) {
      logger.error(
        `/club-unis | user: ${interaction.user.id} | modalidad: ${modalityName}`,
        error,
      );
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("Algo salió mal")
            .setDescription(
              "No se pudo actualizar los uniformes. El equipo técnico fue notificado.",
            ),
        ],
      });
    }
  },
};
