import {
    SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
    ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
    ComponentType, StringSelectMenuInteraction, GuildMember, User,
} from "discord.js";

import { Op } from "sequelize";
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

const POSITIONS: { label: string; value: Position }[] = [
    { label: "GK   — Portero", value: "GK" },
    { label: "DEF  — Defensa", value: "DEF" },
    { label: "MID  — Mediocampista", value: "MID" },
    { label: "DFWD — Defensa-Delantero", value: "DFWD" },
    { label: "FWD  — Delantero", value: "FWD" },
];

interface AwardSnap {
    award: Award;
    teamName: string | null;
}

interface ModalitySnap {
    modality: Modality;
    season: Season;
    participant: Participant;
    team: Team | null;
    totalStats: StatValues;
    compStats: Map<number, { comp: Competition; values: StatValues }>;
    indivAwards: AwardSnap[];
    teamAwards: AwardSnap[];
    allSeasons: Season[];
}

type ViewState =
    | { type: "global" }
    | { type: "modality"; modalityId: number }
    | { type: "comp"; modalityId: number; compId: number }
    | { type: "season"; modalityId: number; seasonId: number }
    | { type: "season_comp"; modalityId: number; seasonId: number; compId: number };

type StatWithComp = Stat & { competition: Competition };
type AwardWinnerFull = AwardWinner & { award: Award; team: Team | null };

const getColor = (member: GuildMember | null): `#${string}` => {
    const hex = member?.displayHexColor;
    return hex && hex !== "#000000" ? hex : COLOR_FALLBACK;
};

const statLine = (v: Partial<StatValues>): string =>
    `\`${v.goles ?? 0}\` G  ·  \`${v.asistencias ?? 0}\` A  ·  \`${v.vallas ?? 0}\` CS  ·  \`${v.autogoles ?? 0}\` AG`;

const hasStats = (v: StatValues): boolean => Object.values(v).some(x => x > 0);

function sumStats(stats: Stat[]): StatValues {
    const base: StatValues = { goles: 0, asistencias: 0, vallas: 0, autogoles: 0 };
    for (const s of stats)
        for (const k of Object.keys(s.values ?? {}) as (keyof StatValues)[])
            base[k] = (base[k] ?? 0) + ((s.values ?? {})[k] ?? 0);
    return base;
}

function addStats(a: StatValues, b: StatValues): StatValues {
    const r = { ...a };
    for (const k of Object.keys(b) as (keyof StatValues)[])
        r[k] = (r[k] ?? 0) + (b[k] ?? 0);
    return r;
}

const ZERO_STATS: StatValues = { goles: 0, asistencias: 0, vallas: 0, autogoles: 0 };

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
    customId: string,
    placeholder: string,
    options: { label: string; value: string; description?: string }[],
): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(placeholder)
            .addOptions(options),
    );
}

async function loadSnap(
    playerId: number,
    modality: Modality,
    season: Season,
): Promise<ModalitySnap | null> {
    const participant = await Participant.findOne({
        where: { playerId, seasonId: season.id, modalityId: modality.id },
    });
    if (!participant) return null;

    const [statsWithComp, awardWinners, pastParticipants] = await Promise.all([
        Stat.findAll({
            where: { participantId: participant.id },
            include: [{ model: Competition, as: "competition", required: true }],
        }),
        AwardWinner.findAll({
            where: {
                [Op.or]: [
                    { playerId },
                    ...(participant.teamId ? [{ teamId: participant.teamId }] : []),
                ],
            },
            include: [
                { model: Award, as: "award", where: { seasonId: season.id }, required: true },
                { model: Team, as: "team", required: false },
            ],
        }),
        Participant.findAll({
            attributes: ["seasonId"],
            where: { playerId, modalityId: modality.id },
        }),
    ]);

    const typedStats = statsWithComp as StatWithComp[];
    const typedWinners = awardWinners as AwardWinnerFull[];

    let team: Team | null = null;
    if (participant.teamId) {
        team =
            typedWinners.find(w => w.teamId === participant.teamId)?.team
            ?? await Team.findByPk(participant.teamId);
    }

    const compStats = new Map<number, { comp: Competition; values: StatValues }>();
    for (const s of typedStats) {
        const comp = s.competition;
        if (!comp) continue;
        if (!compStats.has(comp.id))
            compStats.set(comp.id, { comp, values: { ...ZERO_STATS } });
        const entry = compStats.get(comp.id)!;
        for (const k of Object.keys(s.values ?? {}) as (keyof StatValues)[])
            entry.values[k] = (entry.values[k] ?? 0) + ((s.values ?? {})[k] ?? 0);
    }

    const indivAwards: AwardSnap[] = [];
    const teamAwards: AwardSnap[] = [];
    const seen = new Set<number>();

    for (const w of typedWinners) {
        const award = w.award;
        if (!award || seen.has(award.id)) continue;
        seen.add(award.id);

        if (award.type === "individual") {
            indivAwards.push({ award, teamName: null });
        } else {
            teamAwards.push({ award, teamName: w.team?.name ?? null });
        }
    }

    const seasonIds = pastParticipants.map(p => p.seasonId);
    const allSeasons = seasonIds.length
        ? await Season.findAll({ where: { id: { [Op.in]: seasonIds } }, order: [["id", "DESC"]] })
        : [];

    return {
        modality, season, participant,
        team,
        totalStats: sumStats(statsWithComp),
        compStats,
        indivAwards,
        teamAwards,
        allSeasons,
    };
}

function baseEmbed(targetUser: User, name: string, color: `#${string}`): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name, iconURL: targetUser.displayAvatarURL({ size: 256 }) })
        .setThumbnail(targetUser.displayAvatarURL({ size: 512 }))
        .setFooter({ text: "iDinox v3" })
        .setTimestamp();
}

function formatAwardSection(snaps: AwardSnap[], type: "individual" | "team"): string {
    if (!snaps.length) return "_Ninguno_";
    return snaps.map(({ award, teamName }) => {
        const icon = type === "individual" ? "`🎖️`" : "`🏆`";
        const extra = teamName ? ` _(${teamName})_` : "";
        return `· ${icon} _${award.name}_${extra}`;
    }).join("\n");
}

function buildGlobalEmbed(snaps: ModalitySnap[], targetUser: User, color: `#${string}`): EmbedBuilder {
    const grandTotal = snaps.reduce((acc, s) => addStats(acc, s.totalStats), { ...ZERO_STATS });

    const equipos = snaps
        .map(s => `→ ${s.team ? `**${s.team.name}**` : "Agente libre"} · \`${s.modality.displayName}\``)
        .join("\n");

    const allIndiv = snaps.flatMap(s =>
        s.indivAwards.map(a => `· \`🎖️\` _${a.award.name}_ · \`${s.modality.displayName}\``),
    );
    const allTeam = snaps.flatMap(s =>
        s.teamAwards.map(a => {
            const extra = a.teamName ? ` _(${a.teamName})_` : "";
            return `· \`🏆\` _${a.award.name}_${extra} · \`${s.modality.displayName}\``;
        }),
    );

    const embed = baseEmbed(targetUser, targetUser.globalName ?? targetUser.username, color)
        .addFields(
            { name: "Equipos", value: equipos || "_Sin equipos_" },
            { name: "Estadísticas globales", value: hasStats(grandTotal) ? statLine(grandTotal) : "_Sin estadísticas._" },
        );

    if (allIndiv.length || allTeam.length) {
        if (allIndiv.length) embed.addFields({ name: "🎖️ Premios individuales", value: allIndiv.join("\n") });
        if (allTeam.length) embed.addFields({ name: "🏆 Premios de equipo", value: allTeam.join("\n") });
    } else {
        embed.addFields({ name: "Premios", value: "_Ninguno_" });
    }

    return embed.setFooter({ text: "Selecciona una modalidad para ver el detalle · iDinox v3" });
}

function buildModalityEmbed(snap: ModalitySnap, targetUser: User, color: `#${string}`): EmbedBuilder {
    const pos = snap.participant.position && snap.participant.position !== "N/A" ? snap.participant.position : "—";
    const equipo = snap.team ? `[${snap.team.abbreviation}] ${snap.team.name}` : "Agente libre";

    const embed = baseEmbed(
        targetUser,
        `${targetUser.globalName ?? targetUser.username} · ${snap.modality.displayName}`,
        color,
    ).addFields(
        { name: "Temporada", value: `\`${snap.season.name}\``, inline: true },
        { name: "Equipo", value: `\`${equipo}\``, inline: true },
        { name: "Posición", value: `\`${pos}\``, inline: true },
        { name: "Estadísticas", value: hasStats(snap.totalStats) ? statLine(snap.totalStats) : "_Sin estadísticas._" },
    );

    if (snap.indivAwards.length || snap.teamAwards.length) {
        if (snap.indivAwards.length)
            embed.addFields({ name: "🎖️ Premios individuales", value: formatAwardSection(snap.indivAwards, "individual") });
        if (snap.teamAwards.length)
            embed.addFields({ name: "🏆 Premios de equipo", value: formatAwardSection(snap.teamAwards, "team") });
    } else {
        embed.addFields({ name: "Premios", value: "_Ninguno_" });
    }

    return embed;
}

function buildCompEmbed(
    comp: Competition,
    values: StatValues,
    snap: ModalitySnap,
    targetUser: User,
    color: `#${string}`,
): EmbedBuilder {
    return baseEmbed(targetUser, `${targetUser.globalName ?? targetUser.username} · ${comp.name}`, color)
        .setDescription(`\`${snap.modality.displayName}\` · \`${snap.season.name}\``)
        .addFields(
            { name: "Estadísticas", value: statLine(values) },
            { name: "Participaciones (G+A)", value: `\`${(values.goles ?? 0) + (values.asistencias ?? 0)}\``, inline: true },
        );
}

function buildHistoricEmbed(snap: ModalitySnap, targetUser: User, color: `#${string}`): EmbedBuilder {
    const equipo = snap.team ? `[${snap.team.abbreviation}] ${snap.team.name}` : "Agente libre";

    const embed = baseEmbed(
        targetUser,
        `${targetUser.globalName ?? targetUser.username} · ${snap.modality.displayName}`,
        color,
    )
        .setDescription(`📅 \`${snap.season.name}\` _(temporada cerrada)_`)
        .addFields(
            { name: "Equipo", value: `\`${equipo}\``, inline: true },
            { name: "Posición", value: `\`${snap.participant.position ?? "—"}\``, inline: true },
            { name: "Estadísticas", value: hasStats(snap.totalStats) ? statLine(snap.totalStats) : "_Sin estadísticas._" },
        );

    if (snap.indivAwards.length || snap.teamAwards.length) {
        if (snap.indivAwards.length)
            embed.addFields({ name: "🎖️ Premios individuales", value: formatAwardSection(snap.indivAwards, "individual") });
        if (snap.teamAwards.length)
            embed.addFields({ name: "🏆 Premios de equipo", value: formatAwardSection(snap.teamAwards, "team") });
    } else {
        embed.addFields({ name: "Premios", value: "_Ninguno_" });
    }

    return embed;
}

function buildGlobalComponents(snaps: ModalitySnap[]): ActionRowBuilder<StringSelectMenuBuilder>[] {
    return [
        selectMenu(
            "select_modality",
            "Ver detalle por modalidad",
            snaps.map(s => ({
                label: s.modality.displayName,
                value: String(s.modality.id),
                description: s.team?.name ?? "Agente libre",
            })),
        ),
    ];
}

function buildModalityComponents(
    snap: ModalitySnap,
    isSelf: boolean,
): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
    const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

    if (snap.compStats.size > 0)
        rows.push(selectMenu(
            "select_comp",
            "Ver estadísticas por competencia",
            [...snap.compStats.values()].map(({ comp }) => ({
                label: comp.name,
                value: String(comp.id),
                description: comp.type,
            })),
        ));

    const pastSeasons = snap.allSeasons.filter(s => !s.isActive);
    if (pastSeasons.length > 0)
        rows.push(selectMenu(
            "select_season",
            "Ver temporada anterior",
            pastSeasons.map(s => ({ label: s.name, value: String(s.id) })),
        ));

    if (isSelf)
        rows.push(selectMenu(
            "change_pos",
            `Cambiar posición (actual: ${snap.participant.position ?? "N/A"})`,
            POSITIONS.map(p => ({ label: p.label, value: p.value })),
        ));

    rows.push(backBtn());
    return rows;
}

function buildHistoricComponents(
    snap: ModalitySnap,
): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
    const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];
    if (snap.compStats.size > 0)
        rows.push(selectMenu(
            "select_historic_comp",
            "Ver estadísticas por competencia",
            [...snap.compStats.values()].map(({ comp }) => ({
                label: comp.name,
                value: String(comp.id),
                description: comp.type,
            })),
        ));
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
        .addUserOption(opt =>
            opt.setName("jugador")
                .setDescription("Jugador a consultar (por defecto: tú).")
                .setRequired(false),
        ),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser("jugador") ?? interaction.user;
        const isSelf = targetUser.id === interaction.user.id;

        if (targetUser.bot) {
            await interaction.editReply({ content: "Los bots no tienen perfil en iDinox." });
            return;
        }

        try {
            const [member, player] = await Promise.all([
                interaction.guild?.members.fetch(targetUser.id).catch(() => null) ?? Promise.resolve(null),
                Player.findOne({ where: { discordId: targetUser.id } }),
            ]);

            if (!player) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE67E22).setDescription(
                        `**${targetUser.globalName ?? targetUser.username}** no está registrado en iDinox.`,
                    )],
                });
                return;
            }

            const color = getColor(member);
            const modalities = await Modality.findAll({ where: { isActive: true } });

            const seasonResults = await Promise.all(
                modalities.map(mod =>
                    Season.findOne({ where: { modalityId: mod.id, isActive: true } })
                        .then(season => ({ mod, season })),
                ),
            );

            const snapResults = await Promise.all(
                seasonResults
                    .filter((r): r is { mod: Modality; season: Season } => r.season !== null)
                    .map(({ mod, season }) => loadSnap(player.id, mod, season)),
            );

            const activeSnaps = snapResults.filter((s): s is ModalitySnap => s !== null);

            if (!activeSnaps.length) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE67E22).setDescription(
                        `**${targetUser.globalName ?? targetUser.username}** no tiene ficha en ninguna modalidad activa.`,
                    )],
                });
                return;
            }

            const snapCache = new Map<number, ModalitySnap>(activeSnaps.map(s => [s.modality.id, s]));
            const historicCache = new Map<string, ModalitySnap>();

            let view: ViewState = activeSnaps.length === 1
                ? { type: "modality", modalityId: activeSnaps[0].modality.id }
                : { type: "global" };

            const getPayload = async (): Promise<object> => {
                switch (view.type) {
                    case "global":
                        return {
                            embeds: [buildGlobalEmbed(activeSnaps, targetUser, color)],
                            components: buildGlobalComponents(activeSnaps),
                        };

                    case "modality": {
                        const snap = snapCache.get(view.modalityId);
                        if (!snap) return {};
                        return {
                            embeds: [buildModalityEmbed(snap, targetUser, color)],
                            components: buildModalityComponents(snap, isSelf),
                        };
                    }

                    case "comp": {
                        const snap = snapCache.get(view.modalityId);
                        const entry = snap?.compStats.get(view.compId);
                        if (!snap || !entry) return {};
                        return {
                            embeds: [buildCompEmbed(entry.comp, entry.values, snap, targetUser, color)],
                            components: [backBtn()],
                        };
                    }

                    case "season": {
                        const { modalityId, seasonId } = view;
                        const cacheKey = `${modalityId}_${seasonId}`;
                        let snap = historicCache.get(cacheKey);

                        if (!snap) {
                            const mod = modalities.find(m => m.id === modalityId);
                            const season = await Season.findByPk(seasonId);
                            if (!mod || !season) return {};
                            snap = await loadSnap(player.id, mod, season) ?? undefined;
                            if (!snap) return {};
                            historicCache.set(cacheKey, snap);
                        }

                        return {
                            embeds: [buildHistoricEmbed(snap, targetUser, color)],
                            components: buildHistoricComponents(snap),
                        };
                    }

                    case "season_comp": {
                        const { modalityId, seasonId, compId } = view;
                        const snap = historicCache.get(`${modalityId}_${seasonId}`);
                        const entry = snap?.compStats.get(compId);
                        if (!snap || !entry) return {};
                        return {
                            embeds: [buildCompEmbed(entry.comp, entry.values, snap, targetUser, color)],
                            components: [backBtn()],
                        };
                    }
                }
            };

            const response = await interaction.editReply(await getPayload());

            const collectorFilter = (i: { user: { id: string } }) =>
                i.user.id === interaction.user.id;

            const selectCollector = response.createMessageComponentCollector({
                filter: collectorFilter, time: COLLECTOR_TTL, componentType: ComponentType.StringSelect,
            });
            const buttonCollector = response.createMessageComponentCollector({
                filter: collectorFilter, time: COLLECTOR_TTL, componentType: ComponentType.Button,
            });

            selectCollector.on("collect", async (i: StringSelectMenuInteraction) => {
                const val = Number(i.values[0]);

                switch (i.customId) {
                    case "select_modality":
                        view = { type: "modality", modalityId: val };
                        break;
                    case "select_comp":
                        if (view.type !== "modality") { await i.deferUpdate(); return; }
                        view = { type: "comp", modalityId: view.modalityId, compId: val };
                        break;
                    case "select_season":
                        if (view.type !== "modality") { await i.deferUpdate(); return; }
                        view = { type: "season", modalityId: view.modalityId, seasonId: val };
                        break;
                    case "select_historic_comp":
                        if (view.type !== "season") { await i.deferUpdate(); return; }
                        view = { type: "season_comp", modalityId: view.modalityId, seasonId: view.seasonId, compId: val };
                        break;
                    case "change_pos": {
                        if (view.type !== "modality") { await i.deferUpdate(); return; }
                        const snap = snapCache.get(view.modalityId);
                        if (!snap) { await i.deferUpdate(); return; }
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

            buttonCollector.on("collect", async i => {
                if (i.customId !== "go_back") { await i.deferUpdate(); return; }

                if (view.type === "season_comp") view = { type: "season", modalityId: view.modalityId, seasonId: view.seasonId };
                else if (view.type === "comp" || view.type === "season") view = { type: "modality", modalityId: view.modalityId };
                else if (view.type === "modality" && activeSnaps.length > 1) view = { type: "global" };

                await i.update(await getPayload());
            });

            selectCollector.on("end", () => {
                interaction.editReply({ components: [] }).catch(() => null);
            });

        } catch (error) {
            logger.error(`/perfil | target: ${targetUser.id}`, error);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xE74C3C)
                    .setDescription("No se pudo cargar el perfil. El equipo técnico fue notificado.")],
            });
        }
    },
};