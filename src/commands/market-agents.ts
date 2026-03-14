import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
  MessageFlags,
  GuildMember,
  AutocompleteInteraction,
} from "discord.js";

import { Op } from "sequelize";
import { Participant } from "../database/models/Participant.js";
import { Player } from "../database/models/Player.js";
import { Stat } from "../database/models/Stat.js";
import { Season } from "../database/models/Season.js";
import { Modality } from "../database/models/Modality.js";
import { isModalityAdmin, DENIED_EMBED } from "../utils/permissions.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";
import { logger } from "../utils/logger.js";

const POR_PAGINA = 10;
const COLLECTOR_TTL = 120_000;

const POSICIONES = [
  { label: "Todas las posiciones", value: "ALL" },
  { label: "GK   — Portero", value: "GK" },
  { label: "DEF  — Defensa", value: "DEF" },
  { label: "MID  — Mediocampista", value: "MID" },
  { label: "DFWD — Defensa-Delant.", value: "DFWD" },
  { label: "FWD  — Delantero", value: "FWD" },
];

type ParticipantWithPlayer = Participant & { player: Player };

interface AgentEntry {
  discordId: string;
  username: string;
  globalName: string | null;
  position: string;
  hasStats: boolean;
}

function formatEntry(index: number, agent: AgentEntry): string {
  const statsTag = agent.hasStats ? " 📊" : "";
  return `\`${String(index + 1).padStart(2, "0")}.\` <@${agent.discordId}> \`${agent.position}\`${statsTag}`;
}

function buildEmbed(
  lista: AgentEntry[],
  pagina: number,
  filtroPos: string,
  modality: Modality,
  season: Season,
): EmbedBuilder {
  const totalPags = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const inicio = pagina * POR_PAGINA;
  const slice = lista.slice(inicio, inicio + POR_PAGINA);
  const filtroLabel =
    POSICIONES.find((p) => p.value === filtroPos)?.label ??
    "Todas las posiciones";

  const descripcion = slice.length
    ? slice.map((a, i) => formatEntry(inicio + i, a)).join("\n")
    : "_No hay agentes libres con este filtro._";

  return new EmbedBuilder()
    .setColor(0x1e90ff)
    .setTitle(`🕵️ Agentes Libres · ${modality.displayName}`)
    .setDescription(descripcion)
    .addFields(
      { name: "👥 Total", value: `**${lista.length}**`, inline: true },
      { name: "🔍 Posición", value: `_${filtroLabel}_`, inline: true },
      { name: "📅 Temporada", value: `\`${season.name}\``, inline: true },
    )
    .setFooter({
      text: `Página ${pagina + 1} de ${totalPags} · 📊 = tiene historial de stats`,
    })
    .setTimestamp();
}

function buildComponents(
  lista: AgentEntry[],
  pagina: number,
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const totalPags = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  if (totalPags > 1) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("prev")
          .setEmoji("◀️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pagina === 0),
        new ButtonBuilder()
          .setCustomId("next")
          .setEmoji("▶️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pagina >= totalPags - 1),
      ),
    );
  }

  rows.push(
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("filtro_pos")
        .setPlaceholder("Filtrar por posición")
        .addOptions(POSICIONES),
    ),
  );

  return rows;
}

export default {
  category: "💰 Mercado & Fichajes",
  emoji: "🕵️",
  usage: "/market agents [modalidad]",

  data: new SlashCommandBuilder()
    .setName("market-agents")
    .setDescription(
      "Muestra los jugadores sin equipo disponibles en el mercado.",
    )
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt
        .setName("modalidad")
        .setDescription("Modalidad a consultar.")
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await autocompleteModality(interaction);
  },

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = interaction.member as GuildMember | null;
    const modalityName = interaction.options.getString("modalidad", true);

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

      const settings = modality.settings ?? {};
      if (!member || !isModalityAdmin(member, interaction.client, settings)) {
        await interaction.editReply({
          embeds: [new EmbedBuilder(DENIED_EMBED)],
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

      const agentParticipants = (await Participant.findAll({
        where: {
          modalityId: modality.id,
          seasonId: season.id,
          teamId: null,
          isActive: true,
        },
        include: [{ model: Player, as: "player", required: true }],
      })) as ParticipantWithPlayer[];

      if (!agentParticipants.length) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xf1c40f)
              .setTitle("🕵️ Agentes Libres")
              .setDescription(
                `No hay agentes libres en **${modality.displayName}** esta temporada.`,
              ),
          ],
        });
        return;
      }

      const participantIds = agentParticipants.map((p) => p.id);
      const statsRows = await Stat.findAll({
        where: { participantId: { [Op.in]: participantIds } },
        attributes: ["participantId"],
        group: ["participantId"],
      });
      const withStats = new Set(statsRows.map((s) => s.participantId));

      const entries: AgentEntry[] = agentParticipants.map((p) => ({
        discordId: p.player.discordId,
        username: p.player.username,
        globalName: p.player.globalName ?? null,
        position: p.position ?? "N/A",
        hasStats: withStats.has(p.id),
      }));

      entries.sort((a, b) => a.position.localeCompare(b.position, "es"));

      let pagina = 0;
      let filtroPos = "ALL";

      const getFiltered = () =>
        filtroPos === "ALL"
          ? entries
          : entries.filter((e) => e.position === filtroPos);

      const buildPayload = () => {
        const lista = getFiltered();
        return {
          embeds: [buildEmbed(lista, pagina, filtroPos, modality, season)],
          components: buildComponents(lista, pagina),
        };
      };

      const response = await interaction.editReply(buildPayload());

      const collector = response.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        time: COLLECTOR_TTL,
      });

      collector.on("collect", async (i) => {
        if (i.componentType === ComponentType.Button) {
          i.customId === "prev" ? pagina-- : pagina++;
        } else if (i.customId === "filtro_pos") {
          filtroPos = i.values[0];
          pagina = 0;
        }
        await i.update(buildPayload());
      });

      collector.on("end", () => {
        interaction.editReply({ components: [] }).catch(() => null);
      });
    } catch (error) {
      logger.error(`/market agents | user: ${interaction.user.id}`, error);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("Algo salió mal")
            .setDescription(
              "No se pudo cargar la lista de agentes. El equipo técnico fue notificado.",
            ),
        ],
      });
    }
  },
};
