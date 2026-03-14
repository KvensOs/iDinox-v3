import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
} from "discord.js";

import { Op } from "sequelize";
import { Modality } from "../database/models/Modality.js";
import { Season } from "../database/models/Season.js";
import { Competition } from "../database/models/Competition.js";
import { Participant } from "../database/models/Participant.js";
import { Player } from "../database/models/Player.js";
import { Stat, StatValues } from "../database/models/Stat.js";
import { Award } from "../database/models/Award.js";
import { AwardWinner } from "../database/models/AwardWinner.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";
import { logger } from "../utils/logger.js";

interface CompareSubject {
  player: Player;
  stats: StatValues;
  titles: number;
}

const STAT_KEYS: { id: keyof StatValues; label: string }[] = [
  { id: "goles", label: "Goles" },
  { id: "asistencias", label: "Asistencias" },
  { id: "vallas", label: "Vallas" },
  { id: "autogoles", label: "Autogoles" },
];

const EMPTY_STATS: StatValues = {
  goles: 0,
  asistencias: 0,
  vallas: 0,
  autogoles: 0,
};

function sumStats(statRecords: Stat[]): StatValues {
  const result = { ...EMPTY_STATS };
  for (const s of statRecords) {
    for (const k of Object.keys(s.values ?? {}) as (keyof StatValues)[])
      result[k] = (result[k] ?? 0) + ((s.values ?? {})[k] ?? 0);
  }
  return result;
}

async function getParticipantIds(
  playerId: number,
  modalityId: number,
  seasonId?: number,
): Promise<number[]> {
  const where: Record<string, unknown> = { playerId, modalityId };
  if (seasonId !== undefined) where.seasonId = seasonId;

  const participants = await Participant.findAll({ where, attributes: ["id"] });
  return participants.map((p) => p.id);
}

async function loadStats(
  participantIds: number[],
  competitionId?: number,
): Promise<StatValues> {
  if (!participantIds.length) return { ...EMPTY_STATS };

  const where: Record<string, unknown> = {
    participantId: { [Op.in]: participantIds },
  };
  if (competitionId !== undefined) where.competitionId = competitionId;

  const records = await Stat.findAll({ where });
  return sumStats(records);
}

async function countIndividualTitles(
  playerId: number,
  modalityId: number,
  seasonId?: number,
  competitionId?: number,
): Promise<number> {
  const awardWhere: Record<string, unknown> = {};
  if (competitionId !== undefined) {
    awardWhere.competitionId = competitionId;
  } else {
    const seasonWhere: Record<string, unknown> = { modalityId };
    if (seasonId !== undefined) seasonWhere.id = seasonId;
    const seasons = await Season.findAll({
      where: seasonWhere,
      attributes: ["id"],
    });
    const seasonIds = seasons.map((s) => s.id);
    if (!seasonIds.length) return 0;
    awardWhere.seasonId = { [Op.in]: seasonIds };
  }

  const awards = await Award.findAll({
    where: { ...awardWhere, type: "individual" },
    attributes: ["id"],
  });

  if (!awards.length) return 0;

  const awardIds = awards.map((a) => a.id);

  const count = await AwardWinner.count({
    where: {
      awardId: { [Op.in]: awardIds },
      playerId,
    },
  });

  return count;
}

async function getCommonSeasons(
  playerId1: number,
  playerId2: number,
  modalityId: number,
): Promise<Season[]> {
  const [p1, p2] = await Promise.all([
    Participant.findAll({
      where: { playerId: playerId1, modalityId },
      attributes: ["seasonId"],
    }),
    Participant.findAll({
      where: { playerId: playerId2, modalityId },
      attributes: ["seasonId"],
    }),
  ]);

  const ids1 = new Set(p1.map((p) => p.seasonId));
  const commonIds = [...new Set(p2.map((p) => p.seasonId))].filter((id) =>
    ids1.has(id),
  );
  if (!commonIds.length) return [];

  return Season.findAll({
    where: { id: { [Op.in]: commonIds } },
    order: [["id", "DESC"]],
  });
}

async function getCommonCompetitions(
  playerId1: number,
  playerId2: number,
  modalityId: number,
  seasonId: number,
): Promise<Competition[]> {
  const [ids1, ids2] = await Promise.all([
    getParticipantIds(playerId1, modalityId, seasonId),
    getParticipantIds(playerId2, modalityId, seasonId),
  ]);

  if (!ids1.length || !ids2.length) return [];

  const [stats1, stats2] = await Promise.all([
    Stat.findAll({
      where: { participantId: { [Op.in]: ids1 } },
      attributes: ["competitionId"],
    }),
    Stat.findAll({
      where: { participantId: { [Op.in]: ids2 } },
      attributes: ["competitionId"],
    }),
  ]);

  const compIds1 = new Set(stats1.map((s) => s.competitionId));
  const commonIds = [...new Set(stats2.map((s) => s.competitionId))].filter(
    (id) => compIds1.has(id),
  );
  if (!commonIds.length) return [];

  return Competition.findAll({
    where: { id: { [Op.in]: commonIds } },
    order: [["name", "ASC"]],
  });
}

function pad(s: string, len: number): string {
  return s.padEnd(len);
}

function buildEmbed(
  a: CompareSubject,
  b: CompareSubject,
  scope: string,
  modality: Modality,
): EmbedBuilder {
  const nameA = a.player.username;
  const nameB = b.player.username;

  const gaA = (a.stats.goles ?? 0) + (a.stats.asistencias ?? 0);
  const gaB = (b.stats.goles ?? 0) + (b.stats.asistencias ?? 0);

  const COL_LABEL = 12;
  const COL_VAL = Math.max(nameA.length, 6) + 2;

  const header = `${pad(nameA, COL_VAL)}  ${nameB}`;
  const divider = "─".repeat(Math.max(header.length, 28));

  const statLines = STAT_KEYS.map((sk) => {
    const va = a.stats[sk.id] ?? 0;
    const vb = b.stats[sk.id] ?? 0;
    const markA = va > vb ? " ✦" : "";
    const markB = vb > va ? " ✦" : "";
    return `${pad(sk.label, COL_LABEL)}  ${pad(String(va) + markA, COL_VAL)}  ${vb}${markB}`;
  });

  const gaMarkA = gaA > gaB ? " ✦" : "";
  const gaMarkB = gaB > gaA ? " ✦" : "";
  statLines.push(
    `${pad("G+A", COL_LABEL)}  ${pad(String(gaA) + gaMarkA, COL_VAL)}  ${gaB}${gaMarkB}`,
  );

  const statsBlock = [header, divider, ...statLines].join("\n");

  const titMarkA = a.titles > b.titles ? " ✦" : "";
  const titMarkB = b.titles > a.titles ? " ✦" : "";
  const titlesLine = `\`${a.titles}${titMarkA}\`  vs  \`${b.titles}${titMarkB}\``;

  return new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${nameA}  vs  ${nameB}` })
    .setDescription(
      `\`${modality.displayName}\` · ${scope}\n\n` +
        `\`\`\`\n${statsBlock}\n\`\`\``,
    )
    .addFields({ name: "Títulos individuales", value: titlesLine })
    .setFooter({ text: "iDinox v3" })
    .setTimestamp();
}

export default {
  category: "📊 Carrera & Estadísticas",
  emoji: "⚖️",
  usage:
    "/league-compare jugador1:@A jugador2:@B modalidad:[mod] [temporada] [competencia]",

  data: new SlashCommandBuilder()
    .setName("league-compare")
    .setDescription("Compara estadísticas de dos jugadores.")
    .setDMPermission(false)
    .addUserOption((opt) =>
      opt
        .setName("jugador1")
        .setDescription("Primer jugador.")
        .setRequired(true),
    )
    .addUserOption((opt) =>
      opt
        .setName("jugador2")
        .setDescription("Segundo jugador.")
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("modalidad")
        .setDescription("Modalidad a comparar.")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("temporada")
        .setDescription("Filtrar por temporada común entre ambos jugadores.")
        .setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("competencia")
        .setDescription("Filtrar por competencia común entre ambos jugadores.")
        .setAutocomplete(true),
    ),

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused(true);

    if (focused.name === "modalidad") {
      return autocompleteModality(interaction);
    }

    const opts =
      interaction.options as unknown as ChatInputCommandInteraction["options"];
    const user1 = opts.getUser("jugador1") ?? null;
    const user2 = opts.getUser("jugador2") ?? null;
    const modalityName = interaction.options.getString("modalidad");

    if (!user1 || !user2 || !modalityName) return interaction.respond([]);

    const [modality, player1, player2] = await Promise.all([
      Modality.findOne({ where: { name: modalityName, isActive: true } }),
      Player.findOne({ where: { discordId: user1.id } }),
      Player.findOne({ where: { discordId: user2.id } }),
    ]);

    if (!modality || !player1 || !player2) return interaction.respond([]);

    if (focused.name === "temporada") {
      const seasons = await getCommonSeasons(
        player1.id,
        player2.id,
        modality.id,
      );
      return interaction.respond(
        seasons.map((s) => ({
          name: `${s.isActive ? "🟢" : "🔴"} ${s.name}`,
          value: String(s.id),
        })),
      );
    }

    if (focused.name === "competencia") {
      const seasonIdRaw = interaction.options.getString("temporada");
      if (!seasonIdRaw) return interaction.respond([]);

      const seasonId = Number(seasonIdRaw);
      const competitions = await getCommonCompetitions(
        player1.id,
        player2.id,
        modality.id,
        seasonId,
      );
      return interaction.respond(
        competitions.map((c) => ({
          name: `${c.isActive ? "🟢" : "🔴"} ${c.name}`,
          value: String(c.id),
        })),
      );
    }
  },

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const user1 = interaction.options.getUser("jugador1", true);
    const user2 = interaction.options.getUser("jugador2", true);
    const modalityName = interaction.options.getString("modalidad", true);
    const seasonIdRaw = interaction.options.getString("temporada");
    const compIdRaw = interaction.options.getString("competencia");

    if (user1.id === user2.id) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription("No puedes comparar un jugador consigo mismo."),
        ],
      });
      return;
    }

    try {
      const [modality, player1, player2] = await Promise.all([
        Modality.findOne({ where: { name: modalityName, isActive: true } }),
        Player.findOne({ where: { discordId: user1.id } }),
        Player.findOne({ where: { discordId: user2.id } }),
      ]);

      if (!modality) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setDescription("Modalidad no encontrada o inactiva."),
          ],
        });
        return;
      }

      if (!player1 || !player2) {
        const missing = !player1 ? user1.username : user2.username;
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setDescription(`**${missing}** no está registrado en iDinox.`),
          ],
        });
        return;
      }

      const seasonId = seasonIdRaw ? Number(seasonIdRaw) : undefined;
      const competitionId = compIdRaw ? Number(compIdRaw) : undefined;

      if (seasonId !== undefined) {
        const [p1ids, p2ids] = await Promise.all([
          getParticipantIds(player1.id, modality.id, seasonId),
          getParticipantIds(player2.id, modality.id, seasonId),
        ]);
        if (!p1ids.length || !p2ids.length) {
          const missing = !p1ids.length ? player1.username : player2.username;
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xe67e22)
                .setDescription(
                  `**${missing}** no tiene participación en esa temporada.`,
                ),
            ],
          });
          return;
        }
      }

      const [p1ids, p2ids] = await Promise.all([
        getParticipantIds(player1.id, modality.id, seasonId),
        getParticipantIds(player2.id, modality.id, seasonId),
      ]);

      const [stats1, stats2, titles1, titles2] = await Promise.all([
        loadStats(p1ids, competitionId),
        loadStats(p2ids, competitionId),
        countIndividualTitles(player1.id, modality.id, seasonId, competitionId),
        countIndividualTitles(player2.id, modality.id, seasonId, competitionId),
      ]);

      let scopeLabel = "_Todas las temporadas_";
      if (competitionId !== undefined) {
        const comp = await Competition.findByPk(competitionId);
        scopeLabel = comp
          ? `Competencia: \`${comp.name}\``
          : `Competencia #${competitionId}`;
      } else if (seasonId !== undefined) {
        const season = await Season.findByPk(seasonId);
        scopeLabel = season
          ? `Temporada: \`${season.name}\``
          : `Temporada #${seasonId}`;
      }

      const subject1: CompareSubject = {
        player: player1,
        stats: stats1,
        titles: titles1,
      };
      const subject2: CompareSubject = {
        player: player2,
        stats: stats2,
        titles: titles2,
      };

      await interaction.editReply({
        embeds: [buildEmbed(subject1, subject2, scopeLabel, modality)],
      });
    } catch (error) {
      logger.error(
        `/league-compare | ${user1.username} vs ${user2.username}`,
        error,
      );
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(
              "No se pudo cargar la comparativa. El equipo técnico fue notificado.",
            ),
        ],
      });
    }
  },
};
