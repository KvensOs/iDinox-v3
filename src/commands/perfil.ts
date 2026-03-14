"use strict";

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  StringSelectMenuInteraction,
  GuildMember,
  User,
} from "discord.js";

import { Op, WhereOptions } from "sequelize";
import { Player } from "../database/models/Player.js";
import { Participant, Position } from "../database/models/Participant.js";
import { Team } from "../database/models/Team.js";
import { Season } from "../database/models/Season.js";
import { Modality } from "../database/models/Modality.js";
import { Competition } from "../database/models/Competition.js";
import { Stat, StatValues } from "../database/models/Stat.js";
import { Award } from "../database/models/Award.js";
import { AwardWinner } from "../database/models/AwardWinner.js";
import { logger } from "../utils/logger.js";

const COLOR_FALLBACK = "#2B2D31";
const COLLECTOR_TTL = 120_000;
const ZERO_STATS: StatValues = {
  goles: 0,
  asistencias: 0,
  vallas: 0,
  autogoles: 0,
};

const POSITIONS: { label: string; value: Position }[] = [
  { label: "GK   — Portero", value: "GK" },
  { label: "DEF  — Defensa", value: "DEF" },
  { label: "MID  — Mediocampista", value: "MID" },
  { label: "DFWD — Defensa-Delantero", value: "DFWD" },
  { label: "FWD  — Delantero", value: "FWD" },
];

interface AwardSnap {
  award: Award;
  seasonName: string;
  competitionName: string | null;
  teamName: string | null;
}

interface SeasonSnap {
  modality: Modality;
  season: Season;
  participant: Participant;
  team: Team | null;
  totalStats: StatValues;
  compStats: Map<number, { comp: Competition; values: StatValues }>;
  awards: AwardSnap[];
  allSeasons: Season[];
}

interface ModalityCareer {
  modality: Modality;
  totalStats: StatValues;
  awards: AwardSnap[];
  activeSnap: SeasonSnap | null;
  seasonCount: number;
}

interface GlobalCareer {
  totalStats: StatValues;
  awards: AwardSnap[];
  modalities: ModalityCareer[];
}

type ViewState =
  | { type: "global" }
  | { type: "modality"; modalityId: number }
  | { type: "season"; modalityId: number; seasonId: number }
  | { type: "comp"; modalityId: number; seasonId: number; compId: number };

type AwardWinnerFull = AwardWinner & {
  award: Award & { season: Season; competition: Competition | null };
  team: Team | null;
};
type StatWithComp = Stat & { competition: Competition };

const getColor = (member: GuildMember | null): `#${string}` => {
  const hex = member?.displayHexColor;
  return hex && hex !== "#000000" ? hex : COLOR_FALLBACK;
};

function sumStats(stats: Stat[]): StatValues {
  const base: StatValues = { ...ZERO_STATS };
  for (const s of stats)
    for (const k of Object.keys(s.values ?? {}) as (keyof StatValues)[])
      base[k] = (base[k] ?? 0) + ((s.values ?? {})[k] ?? 0);
  return base;
}

function addStats(a: StatValues, b: StatValues): StatValues {
  return {
    goles: (a.goles ?? 0) + (b.goles ?? 0),
    asistencias: (a.asistencias ?? 0) + (b.asistencias ?? 0),
    vallas: (a.vallas ?? 0) + (b.vallas ?? 0),
    autogoles: (a.autogoles ?? 0) + (b.autogoles ?? 0),
  };
}

const hasStats = (v: StatValues): boolean =>
  Object.values(v).some((x) => x > 0);

const statLine = (v: StatValues): string =>
  `\`${v.goles ?? 0}\` G  ·  \`${v.asistencias ?? 0}\` A  ·  \`${v.vallas ?? 0}\` CS  ·  \`${v.autogoles ?? 0}\` AG`;

async function loadSeasonSnap(
  playerId: number,
  modality: Modality,
  season: Season,
): Promise<SeasonSnap | null> {
  const participant = await Participant.findOne({
    where: { playerId, seasonId: season.id, modalityId: modality.id },
  });
  if (!participant) return null;

  const orWhere = participant.teamId
    ? [{ playerId }, { teamId: participant.teamId }]
    : [{ playerId }];

  const [statsRaw, winnersRaw, allParticipants] = await Promise.all([
    Stat.findAll({
      where: { participantId: participant.id },
      include: [{ model: Competition, as: "competition", required: true }],
    }),
    AwardWinner.findAll({
      where: { [Op.or]: orWhere } as WhereOptions,
      include: [
        {
          model: Award,
          as: "award",
          required: true,
          where: { seasonId: season.id },
          include: [
            { model: Season, as: "season", required: true },
            { model: Competition, as: "competition", required: false },
          ],
        },
        { model: Team, as: "team", required: false },
      ],
    }),
    Participant.findAll({
      attributes: ["seasonId"],
      where: { playerId, modalityId: modality.id },
    }),
  ]);

  const typedStats = statsRaw as StatWithComp[];
  const typedWinners = winnersRaw as AwardWinnerFull[];

  let team: Team | null = null;
  if (participant.teamId)
    team =
      typedWinners.find((w) => w.teamId === participant.teamId)?.team ??
      (await Team.findByPk(participant.teamId));

  const compStats = new Map<
    number,
    { comp: Competition; values: StatValues }
  >();
  for (const s of typedStats) {
    if (!s.competition) continue;
    if (!compStats.has(s.competition.id))
      compStats.set(s.competition.id, {
        comp: s.competition,
        values: { ...ZERO_STATS },
      });
    const entry = compStats.get(s.competition.id)!;
    for (const k of Object.keys(s.values ?? {}) as (keyof StatValues)[])
      entry.values[k] = (entry.values[k] ?? 0) + ((s.values ?? {})[k] ?? 0);
  }

  const teamAwardIds = typedWinners
    .filter((w) => w.award.type === "team")
    .map((w) => w.award.id);

  const teamWinnerMap = new Map<number, string>();
  if (teamAwardIds.length) {
    const teamRows = (await AwardWinner.findAll({
      where: { awardId: { [Op.in]: teamAwardIds }, teamId: { [Op.not]: null } },
      include: [{ model: Team, as: "team", required: true }],
    })) as (AwardWinner & { team: Team })[];
    for (const tw of teamRows) teamWinnerMap.set(tw.awardId, tw.team.name);
  }

  const seen = new Set<number>();
  const awards: AwardSnap[] = [];
  for (const w of typedWinners) {
    if (!w.award || seen.has(w.award.id)) continue;
    seen.add(w.award.id);
    awards.push({
      award: w.award,
      seasonName: w.award.season.name,
      competitionName: w.award.competition?.name ?? null,
      teamName:
        w.award.type === "team"
          ? (teamWinnerMap.get(w.award.id) ?? null)
          : null,
    });
  }

  const seasonIds = allParticipants.map((p) => p.seasonId);
  const allSeasons = seasonIds.length
    ? await Season.findAll({
        where: { id: { [Op.in]: seasonIds } },
        order: [["id", "DESC"]],
      })
    : [];

  return {
    modality,
    season,
    participant,
    team,
    totalStats: sumStats(statsRaw),
    compStats,
    awards,
    allSeasons,
  };
}

async function loadModalityCareer(
  playerId: number,
  modality: Modality,
  activeSnap: SeasonSnap | null,
): Promise<ModalityCareer> {
  const allParticipants = await Participant.findAll({
    where: { playerId, modalityId: modality.id },
    attributes: ["id", "seasonId", "teamId"],
  });

  if (!allParticipants.length)
    return {
      modality,
      totalStats: { ...ZERO_STATS },
      awards: [],
      activeSnap,
      seasonCount: 0,
    };

  const participantIds = allParticipants.map((p) => p.id!);
  const seasonIds = allParticipants.map((p) => p.seasonId);
  const teamIds = [
    ...new Set(
      allParticipants
        .map((p) => p.teamId)
        .filter((id): id is number => id !== null),
    ),
  ];

  const orWhere = [
    { playerId },
    ...(teamIds.length ? [{ teamId: { [Op.in]: teamIds } }] : []),
  ];

  const [allStats, allWinners] = await Promise.all([
    Stat.findAll({ where: { participantId: { [Op.in]: participantIds } } }),
    AwardWinner.findAll({
      where: { [Op.or]: orWhere } as WhereOptions,
      include: [
        {
          model: Award,
          as: "award",
          required: true,
          where: { seasonId: { [Op.in]: seasonIds } },
          include: [
            { model: Season, as: "season", required: true },
            { model: Competition, as: "competition", required: false },
          ],
        },
        { model: Team, as: "team", required: false },
      ],
    }),
  ]);

  const totalStats = sumStats(allStats);

  const typedWinners = allWinners as AwardWinnerFull[];
  const teamAwardIds = typedWinners
    .filter((w) => w.award.type === "team")
    .map((w) => w.award.id);
  const teamWinnerMap = new Map<number, string>();
  if (teamAwardIds.length) {
    const teamRows = (await AwardWinner.findAll({
      where: { awardId: { [Op.in]: teamAwardIds }, teamId: { [Op.not]: null } },
      include: [{ model: Team, as: "team", required: true }],
    })) as (AwardWinner & { team: Team })[];
    for (const tw of teamRows) teamWinnerMap.set(tw.awardId, tw.team.name);
  }

  const seen = new Set<number>();
  const awards: AwardSnap[] = [];
  for (const w of typedWinners) {
    if (!w.award || seen.has(w.award.id)) continue;
    seen.add(w.award.id);
    awards.push({
      award: w.award,
      seasonName: w.award.season.name,
      competitionName: w.award.competition?.name ?? null,
      teamName:
        w.award.type === "team"
          ? (teamWinnerMap.get(w.award.id) ?? null)
          : null,
    });
  }

  return {
    modality,
    totalStats,
    awards,
    activeSnap,
    seasonCount: seasonIds.length,
  };
}

async function loadGlobalCareer(
  careers: ModalityCareer[],
): Promise<GlobalCareer> {
  const totalStats = careers.reduce<StatValues>(
    (acc, c) => addStats(acc, c.totalStats),
    { ...ZERO_STATS },
  );

  const seen = new Set<number>();
  const awards: AwardSnap[] = [];
  for (const c of careers)
    for (const a of c.awards)
      if (!seen.has(a.award.id)) {
        seen.add(a.award.id);
        awards.push(a);
      }

  return { totalStats, awards, modalities: careers };
}

function fmtAward(a: AwardSnap, showSeason = false): string {
  const icon = a.award.type === "team" ? "🏆" : "🎖️";
  const showComp = a.competitionName && a.competitionName !== a.award.name;
  const parts = [`· \`${icon}\` **${a.award.name}**`];
  if (showComp) parts.push(`\`[${a.competitionName}]\``);
  if (a.teamName) parts.push(`con \`${a.teamName}\``);
  if (showSeason) parts.push(`\`${a.seasonName}\``);
  return parts.join(" · ");
}

function awardsToFields(
  awards: AwardSnap[],
  showSeason = false,
): { name: string; value: string }[] {
  const indiv = awards.filter((a) => a.award.type === "individual");
  const team = awards.filter((a) => a.award.type === "team");
  const fields: { name: string; value: string }[] = [];

  if (!indiv.length && !team.length)
    return [{ name: "Premios", value: "_Ninguno_" }];

  if (indiv.length)
    fields.push({
      name: `🎖️ Premios individuales (${indiv.length})`,
      value: indiv.map((a) => fmtAward(a, showSeason)).join("\n"),
    });
  if (team.length)
    fields.push({
      name: `🏆 Premios de equipo (${team.length})`,
      value: team.map((a) => fmtAward(a, showSeason)).join("\n"),
    });

  return fields;
}

function baseEmbed(
  user: User,
  name: string,
  color: `#${string}`,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name, iconURL: user.displayAvatarURL({ size: 256 }) })
    .setThumbnail(user.displayAvatarURL({ size: 512 }))
    .setFooter({ text: "iDinox v3" })
    .setTimestamp();
}

function buildGlobalEmbed(
  career: GlobalCareer,
  user: User,
  color: `#${string}`,
): EmbedBuilder {
  const equipos = career.modalities
    .map((c) => {
      const equipo = c.activeSnap?.team
        ? `**${c.activeSnap.team.name}**`
        : "_Agente libre_";
      return `→ ${equipo} · \`${c.modality.displayName}\``;
    })
    .join("\n");

  return baseEmbed(user, user.globalName ?? user.username, color)
    .addFields(
      { name: "Equipos activos", value: equipos || "_Sin equipos_" },
      {
        name: "Estadísticas de carrera",
        value: hasStats(career.totalStats)
          ? statLine(career.totalStats)
          : "_Sin estadísticas_",
      },
      ...awardsToFields(career.awards, true),
    )
    .setFooter({
      text: "Selecciona una modalidad para ver el detalle · iDinox v3",
    });
}

function buildModalityEmbed(
  career: ModalityCareer,
  user: User,
  color: `#${string}`,
): EmbedBuilder {
  const snap = career.activeSnap;
  const equipo = snap?.team
    ? `\`[${snap.team.abbreviation ?? "?"}] ${snap.team.name}\``
    : "`Agente libre`";
  const pos = snap?.participant.position ?? "N/A";

  return baseEmbed(
    user,
    `${user.globalName ?? user.username} · ${career.modality.displayName}`,
    color,
  ).addFields(
    { name: "Equipo actual", value: equipo, inline: true },
    { name: "Posición", value: `\`${pos}\``, inline: true },
    { name: "Temporadas", value: `\`${career.seasonCount}\``, inline: true },
    {
      name: "Estadísticas acumuladas",
      value: hasStats(career.totalStats)
        ? statLine(career.totalStats)
        : "_Sin estadísticas_",
    },
    ...awardsToFields(career.awards, true),
  );
}

function buildSeasonEmbed(
  snap: SeasonSnap,
  user: User,
  color: `#${string}`,
): EmbedBuilder {
  const equipo = snap.team
    ? `\`[${snap.team.abbreviation ?? "?"}] ${snap.team.name}\``
    : "`Agente libre`";
  const pos = snap.participant.position ?? "N/A";
  const closed = !snap.season.isActive;

  return baseEmbed(
    user,
    `${user.globalName ?? user.username} · ${snap.modality.displayName}`,
    color,
  )
    .setDescription(
      closed
        ? `📅 \`${snap.season.name}\` _(temporada cerrada)_`
        : `📅 \`${snap.season.name}\``,
    )
    .addFields(
      { name: "Equipo", value: equipo, inline: true },
      { name: "Posición", value: `\`${pos}\``, inline: true },
      {
        name: "Estadísticas",
        value: hasStats(snap.totalStats)
          ? statLine(snap.totalStats)
          : "_Sin estadísticas_",
      },
      ...awardsToFields(snap.awards, false),
    );
}

function buildCompEmbed(
  comp: Competition,
  vals: StatValues,
  snap: SeasonSnap,
  user: User,
  color: `#${string}`,
): EmbedBuilder {
  return baseEmbed(
    user,
    `${user.globalName ?? user.username} · ${comp.name}`,
    color,
  )
    .setDescription(
      `\`${snap.modality.displayName}\` · \`${snap.season.name}\``,
    )
    .addFields(
      { name: "Estadísticas", value: statLine(vals) },
      {
        name: "G+A",
        value: `\`${(vals.goles ?? 0) + (vals.asistencias ?? 0)}\``,
        inline: true,
      },
    );
}

function backBtn(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("go_back")
      .setLabel("Volver")
      .setEmoji("↩️")
      .setStyle(ButtonStyle.Secondary),
  );
}

function selectMenu(
  id: string,
  placeholder: string,
  opts: { label: string; value: string; description?: string }[],
): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder(placeholder)
      .addOptions(opts),
  );
}

function globalComponents(
  careers: ModalityCareer[],
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  return [
    selectMenu(
      "sel_modality",
      "Ver una modalidad",
      careers.map((c) => ({
        label: c.modality.displayName,
        value: String(c.modality.id),
        description: c.activeSnap?.team?.name ?? "Agente libre",
      })),
    ),
  ];
}

function modalityComponents(
  career: ModalityCareer,
  isSelf: boolean,
  multiModality: boolean,
): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

  const seasons = career.activeSnap?.allSeasons ?? [];
  if (seasons.length > 1)
    rows.push(
      selectMenu(
        "sel_season",
        "Ver temporada específica",
        seasons.map((s) => ({
          label: s.name,
          value: String(s.id),
          description: s.isActive ? "Activa" : "Cerrada",
        })),
      ),
    );

  if (isSelf && career.activeSnap)
    rows.push(
      selectMenu(
        "change_pos",
        `Cambiar posición (actual: ${career.activeSnap.participant.position ?? "N/A"})`,
        POSITIONS.map((p) => ({ label: p.label, value: p.value })),
      ),
    );

  if (multiModality) rows.push(backBtn());
  return rows;
}

function seasonComponents(
  snap: SeasonSnap,
  isSelf: boolean,
): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

  if (snap.compStats.size > 0)
    rows.push(
      selectMenu(
        "sel_comp",
        "Ver estadísticas por competencia",
        [...snap.compStats.values()].map(({ comp }) => ({
          label: comp.name,
          value: String(comp.id),
          description: comp.type,
        })),
      ),
    );

  if (isSelf && snap.season.isActive)
    rows.push(
      selectMenu(
        "change_pos",
        `Cambiar posición (actual: ${snap.participant.position ?? "N/A"})`,
        POSITIONS.map((p) => ({ label: p.label, value: p.value })),
      ),
    );

  rows.push(backBtn());
  return rows;
}

export default {
  category: "📊 Carrera & Estadísticas",
  emoji: "👤",
  usage: "/perfil (jugador)",

  data: new SlashCommandBuilder()
    .setName("perfil")
    .setDescription("Muestra la ficha y estadísticas de un jugador.")
    .setDMPermission(false)
    .addUserOption((opt) =>
      opt
        .setName("jugador")
        .setDescription("Jugador a consultar (por defecto: tú).")
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const targetUser =
      interaction.options.getUser("jugador") ?? interaction.user;
    const isSelf = targetUser.id === interaction.user.id;

    if (targetUser.bot) {
      await interaction.editReply({
        content: "Los bots no tienen perfil en iDinox.",
      });
      return;
    }

    try {
      const [member, player] = await Promise.all([
        interaction.guild?.members.fetch(targetUser.id).catch(() => null) ??
          Promise.resolve(null),
        Player.findOne({ where: { discordId: targetUser.id } }),
      ]);

      if (!player) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe67e22)
              .setDescription(
                `**${targetUser.globalName ?? targetUser.username}** no está registrado en iDinox.`,
              ),
          ],
        });
        return;
      }

      const color = getColor(member);
      const modalities = await Modality.findAll({ where: { isActive: true } });

      const activeSeasonsByMod = await Promise.all(
        modalities.map((mod) =>
          Season.findOne({
            where: { modalityId: mod.id, isActive: true },
          }).then((s) => ({ mod, season: s })),
        ),
      );

      const snapResults = await Promise.all(
        activeSeasonsByMod
          .filter(
            (r): r is { mod: Modality; season: Season } => r.season !== null,
          )
          .map(({ mod, season }) => loadSeasonSnap(player.id, mod, season)),
      );

      const activeSnaps = snapResults.filter(
        (s): s is SeasonSnap => s !== null,
      );

      if (!activeSnaps.length) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe67e22)
              .setDescription(
                `**${targetUser.globalName ?? targetUser.username}** no tiene ficha en ninguna modalidad activa.`,
              ),
          ],
        });
        return;
      }

      const careers = await Promise.all(
        activeSnaps.map((snap) =>
          loadModalityCareer(player.id, snap.modality, snap),
        ),
      );
      const globalCareer = await loadGlobalCareer(careers);
      const multiModality = careers.length > 1;

      const careerByMod = new Map(careers.map((c) => [c.modality.id, c]));
      const snapCache = new Map<string, SeasonSnap>(); // key: `${modId}_${seasonId}`
      for (const snap of activeSnaps)
        snapCache.set(`${snap.modality.id}_${snap.season.id}`, snap);

      let view: ViewState;
      if (!multiModality && activeSnaps[0].allSeasons.length <= 1) {
        view = {
          type: "season",
          modalityId: activeSnaps[0].modality.id,
          seasonId: activeSnaps[0].season.id,
        };
      } else if (!multiModality) {
        view = { type: "modality", modalityId: activeSnaps[0].modality.id };
      } else {
        view = { type: "global" };
      }

      const getPayload = async (): Promise<object> => {
        switch (view.type) {
          case "global":
            return {
              embeds: [buildGlobalEmbed(globalCareer, targetUser, color)],
              components: globalComponents(careers),
            };

          case "modality": {
            const career = careerByMod.get(view.modalityId);
            if (!career) return {};
            return {
              embeds: [buildModalityEmbed(career, targetUser, color)],
              components: modalityComponents(career, isSelf, multiModality),
            };
          }

          case "season": {
            const { modalityId, seasonId } = view;
            const key = `${modalityId}_${seasonId}`;
            let snap = snapCache.get(key);

            if (!snap) {
              const mod = modalities.find((m) => m.id === modalityId);
              const season = await Season.findByPk(seasonId);
              if (!mod || !season) return {};
              snap =
                (await loadSeasonSnap(player.id, mod, season)) ?? undefined;
              if (!snap) return {};
              snapCache.set(key, snap);
            }

            return {
              embeds: [buildSeasonEmbed(snap, targetUser, color)],
              components: seasonComponents(snap, isSelf),
            };
          }

          case "comp": {
            const { modalityId, seasonId, compId } = view;
            const snap = snapCache.get(`${modalityId}_${seasonId}`);
            const entry = snap?.compStats.get(compId);
            if (!snap || !entry) return {};
            return {
              embeds: [
                buildCompEmbed(
                  entry.comp,
                  entry.values,
                  snap,
                  targetUser,
                  color,
                ),
              ],
              components: [backBtn()],
            };
          }
        }
      };

      const response = await interaction.editReply(await getPayload());

      const byUser = (i: { user: { id: string } }) =>
        i.user.id === interaction.user.id;

      const selCollector = response.createMessageComponentCollector({
        filter: byUser,
        time: COLLECTOR_TTL,
        componentType: ComponentType.StringSelect,
      });
      const btnCollector = response.createMessageComponentCollector({
        filter: byUser,
        time: COLLECTOR_TTL,
        componentType: ComponentType.Button,
      });

      selCollector.on("collect", async (i: StringSelectMenuInteraction) => {
        const val = Number(i.values[0]);

        switch (i.customId) {
          case "sel_modality":
            view = { type: "modality", modalityId: val };
            break;

          case "sel_season":
            if (view.type !== "modality") {
              await i.deferUpdate();
              return;
            }
            view = {
              type: "season",
              modalityId: view.modalityId,
              seasonId: val,
            };
            break;

          case "sel_comp":
            if (view.type !== "season") {
              await i.deferUpdate();
              return;
            }
            view = {
              type: "comp",
              modalityId: view.modalityId,
              seasonId: view.seasonId,
              compId: val,
            };
            break;

          case "change_pos": {
            let snap: SeasonSnap | undefined;
            if (view.type === "modality") {
              snap = careerByMod.get(view.modalityId)?.activeSnap ?? undefined;
            } else if (view.type === "season") {
              snap = snapCache.get(`${view.modalityId}_${view.seasonId}`);
            }
            if (!snap) {
              await i.deferUpdate();
              return;
            }
            snap.participant.position = i.values[0] as Position;
            await snap.participant.save();
            break;
          }

          default:
            await i.deferUpdate();
            return;
        }

        await i.update(await getPayload());
      });

      btnCollector.on("collect", async (i) => {
        if (i.customId !== "go_back") {
          await i.deferUpdate();
          return;
        }

        if (view.type === "comp") {
          view = {
            type: "season",
            modalityId: view.modalityId,
            seasonId: view.seasonId,
          };
        } else if (view.type === "season") {
          if (
            !multiModality &&
            (careerByMod.get(view.modalityId)?.seasonCount ?? 0) <= 1
          ) {
            await i.deferUpdate();
            return;
          }
          view = multiModality
            ? { type: "modality", modalityId: view.modalityId }
            : { type: "modality", modalityId: view.modalityId };
        } else if (view.type === "modality" && multiModality) {
          view = { type: "global" };
        } else {
          await i.deferUpdate();
          return;
        }

        await i.update(await getPayload());
      });

      selCollector.on("end", () => {
        interaction.editReply({ components: [] }).catch(() => null);
      });
    } catch (error) {
      logger.error(`/perfil | target: ${targetUser.id}`, error);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(
              "No se pudo cargar el perfil. El equipo técnico fue notificado.",
            ),
        ],
      });
    }
  },
};
