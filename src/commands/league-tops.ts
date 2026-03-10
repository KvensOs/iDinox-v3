import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuInteraction,
} from "discord.js";

import { Op } from "sequelize";
import { Modality } from "../database/models/Modality.js";
import { Season } from "../database/models/Season.js";
import { Competition } from "../database/models/Competition.js";
import { Participant } from "../database/models/Participant.js";
import { Player } from "../database/models/Player.js";
import { Stat, StatValues } from "../database/models/Stat.js";
import { Team } from "../database/models/Team.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";
import { logger } from "../utils/logger.js";

// ─── Constantes ───────────────────────────────────────────────────────────────

const COLLECTOR_TTL = 120_000;
const PAGE_SIZE = 10;

const STAT_KEYS: { id: keyof StatValues; label: string; emoji: string }[] = [
    { id: "goles", label: "Goles", emoji: "⚽" },
    { id: "asistencias", label: "Asistencias", emoji: "🎯" },
    { id: "vallas", label: "Vallas invictas", emoji: "🧤" },
    { id: "autogoles", label: "Autogoles", emoji: "😅" },
];

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PlayerRow {
    discordId: string;
    username: string;
    teamAbbr: string | null;
    stats: StatValues;
}

type ViewMode = "overview" | keyof StatValues;

interface State {
    modality: Modality;
    season: Season;
    competition: Competition | null;   // null = totales de la temporada
    allSeasons: Season[];
    competitions: Competition[];       // competencias de la temporada activa
    rows: PlayerRow[];
    view: ViewMode;
    page: number;
}

// ─── Carga de datos ───────────────────────────────────────────────────────────

/**
 * Carga todos los jugadores con sus stats sumadas para una temporada.
 * Si competition es null, suma todas las competencias de esa temporada.
 */
async function loadRows(
    season: Season,
    modality: Modality,
    competition: Competition | null,
): Promise<PlayerRow[]> {
    // Participants de esta temporada+modalidad
    const participants = await Participant.findAll({
        where: { seasonId: season.id, modalityId: modality.id },
        include: [
            { model: Player, as: "player", required: true },
            { model: Team, as: "team", required: false },
        ],
    });

    if (!participants.length) return [];

    const participantIds = participants.map(p => p.id);

    // Filtrar stats por competencia o todas
    const statWhere: Record<string, unknown> = { participantId: { [Op.in]: participantIds } };
    if (competition) statWhere.competitionId = competition.id;

    const stats = await Stat.findAll({ where: statWhere });

    // Agrupar stats por participantId
    const statMap = new Map<number, StatValues>();
    for (const s of stats) {
        const current = statMap.get(s.participantId) ?? { goles: 0, asistencias: 0, vallas: 0, autogoles: 0 };
        for (const k of Object.keys(s.values ?? {}) as (keyof StatValues)[])
            current[k] = (current[k] ?? 0) + ((s.values ?? {})[k] ?? 0);
        statMap.set(s.participantId, current);
    }

    // Construir rows — solo jugadores con al menos una stat
    const rows: PlayerRow[] = [];
    for (const p of participants) {
        const s = statMap.get(p.id);
        if (!s || Object.values(s).every(v => v === 0)) continue;

        const player = (p as unknown as { player: Player; team: Team | null }).player;
        const team = (p as unknown as { player: Player; team: Team | null }).team;

        rows.push({
            discordId: player.discordId,
            username: player.username,
            teamAbbr: team?.abbreviation ?? null,
            stats: s,
        });
    }

    return rows;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function buildEmbed(state: State): EmbedBuilder {
    const { modality, season, competition, rows, view, page } = state;

    const scope = competition ? `\`${competition.name}\`` : "_Totales de temporada_";
    const title = `${modality.displayName} · ${season.name}`;

    const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle(`📈 ${title}`)
        .setDescription(`Temporada: \`${season.name}\`  ·  Competencia: ${scope}`)
        .setTimestamp()
        .setFooter({ text: "iDinox v3" });

    if (view === "overview") {
        // Vista resumen: top 1 de cada stat
        for (const sk of STAT_KEYS) {
            const sorted = [...rows].sort((a, b) => (b.stats[sk.id] ?? 0) - (a.stats[sk.id] ?? 0));
            const top = sorted.find(r => (r.stats[sk.id] ?? 0) > 0);
            const prefix = top?.teamAbbr ? `\`[${top.teamAbbr}]\` ` : "";
            embed.addFields({
                name: `${sk.emoji} ${sk.label}`,
                value: top ? `${prefix}<@${top.discordId}> — **${top.stats[sk.id]}**` : "_Sin datos_",
                inline: true,
            });
        }
        return embed;
    }

    // Vista ranking de una stat
    const sk = STAT_KEYS.find(s => s.id === view)!;
    const sorted = [...rows]
        .filter(r => (r.stats[sk.id] ?? 0) > 0)
        .sort((a, b) => (b.stats[sk.id] ?? 0) - (a.stats[sk.id] ?? 0));

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const slice = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    const MEDALS = ["🥇", "🥈", "🥉"];

    const lines = slice.map((r, i) => {
        const pos = page * PAGE_SIZE + i + 1;
        const medal = pos <= 3 ? MEDALS[pos - 1] : `**${pos}.**`;
        const prefix = r.teamAbbr ? `\`[${r.teamAbbr}]\` ` : "";
        return `${medal} ${prefix}<@${r.discordId}> — **${r.stats[sk.id]}**`;
    });

    embed
        .setTitle(`${sk.emoji} ${sk.label} · ${title}`)
        .setDescription(lines.join("\n") || "_Sin datos_")
        .setFooter({ text: `Página ${page + 1} de ${totalPages} · iDinox v3` });

    return embed;
}

function buildComponents(state: State): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
    const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

    // ── Selector de categoría ──────────────────────────────────────────────────
    const catMenu = new StringSelectMenuBuilder()
        .setCustomId("select_stat")
        .setPlaceholder("Ver categoría...")
        .addOptions([
            new StringSelectMenuOptionBuilder().setLabel("Vista general").setValue("overview").setEmoji("🏠"),
            ...STAT_KEYS.map(sk =>
                new StringSelectMenuOptionBuilder().setLabel(sk.label).setValue(sk.id as string).setEmoji(sk.emoji)
            ),
        ]);
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(catMenu));

    // ── Selector de temporada ──────────────────────────────────────────────────
    if (state.allSeasons.length > 1) {
        const seasonMenu = new StringSelectMenuBuilder()
            .setCustomId("select_season")
            .setPlaceholder("Cambiar temporada...")
            .addOptions(
                state.allSeasons.map(s =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(s.name)
                        .setValue(String(s.id))
                        .setEmoji(s.isActive ? "🟢" : "🔴")
                ),
            );
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(seasonMenu));
    }

    // ── Selector de competencia ────────────────────────────────────────────────
    if (state.competitions.length > 0) {
        const compMenu = new StringSelectMenuBuilder()
            .setCustomId("select_comp")
            .setPlaceholder("Filtrar por competencia...")
            .addOptions([
                new StringSelectMenuOptionBuilder().setLabel("Totales de temporada").setValue("all").setEmoji("🌍"),
                ...state.competitions.map(c =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(c.name)
                        .setValue(String(c.id))
                        .setEmoji(c.isActive ? "🟢" : "🔴")
                ),
            ]);
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(compMenu));
    }

    // ── Paginación ─────────────────────────────────────────────────────────────
    if (state.view !== "overview") {
        const sk = STAT_KEYS.find(s => s.id === state.view)!;
        const sorted = [...state.rows]
            .filter(r => (r.stats[sk.id] ?? 0) > 0)
            .sort((a, b) => (b.stats[sk.id] ?? 0) - (a.stats[sk.id] ?? 0));
        const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

        if (totalPages > 1) {
            const navRow = new ActionRowBuilder<ButtonBuilder>();
            if (state.page > 0)
                navRow.addComponents(
                    new ButtonBuilder().setCustomId("prev").setEmoji("⬅️").setStyle(ButtonStyle.Secondary),
                );
            navRow.addComponents(
                new ButtonBuilder().setCustomId("home").setEmoji("🏠").setStyle(ButtonStyle.Primary),
            );
            if (state.page + 1 < totalPages)
                navRow.addComponents(
                    new ButtonBuilder().setCustomId("next").setEmoji("➡️").setStyle(ButtonStyle.Secondary),
                );
            rows.push(navRow);
        }
    }

    return rows;
}

// ─── Comando ──────────────────────────────────────────────────────────────────

export default {
    category: "📊 Carrera & Estadísticas",
    emoji: "📈",
    usage: "/league-tops [modalidad]",

    data: new SlashCommandBuilder()
        .setName("league-tops")
        .setDescription("Ranking de jugadores de una modalidad.")
        .setDMPermission(false)
        .addStringOption(opt =>
            opt.setName("modalidad")
                .setDescription("Modalidad a consultar.")
                .setRequired(true)
                .setAutocomplete(true),
        ),

    async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        await autocompleteModality(interaction);
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply();

        const modalityName = interaction.options.getString("modalidad", true);

        try {
            // ── Resolver modality + season activa ──────────────────────────
            const modality = await Modality.findOne({ where: { name: modalityName, isActive: true } });
            if (!modality) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setDescription("Modalidad no encontrada o inactiva.")],
                });
                return;
            }

            const activeSeason = await Season.findOne({ where: { modalityId: modality.id, isActive: true } });
            if (!activeSeason) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE67E22).setDescription(`No hay temporada activa en **${modality.displayName}**.`)],
                });
                return;
            }

            // ── Cargar todas las temporadas de esta modalidad ──────────────
            const allSeasons = await Season.findAll({
                where: { modalityId: modality.id },
                order: [["id", "DESC"]],
            });

            // ── Competencias de la temporada activa ────────────────────────
            const competitions = await Competition.findAll({
                where: { seasonId: activeSeason.id },
                order: [["isActive", "DESC"], ["name", "ASC"]],
            });

            // ── Estado inicial ─────────────────────────────────────────────
            const state: State = {
                modality,
                season: activeSeason,
                competition: null,
                allSeasons,
                competitions,
                rows: await loadRows(activeSeason, modality, null),
                view: "overview",
                page: 0,
            };

            if (!state.rows.length) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE67E22)
                        .setDescription(`No hay estadísticas registradas en **${modality.displayName}** esta temporada.`)],
                });
                return;
            }

            const getPayload = () => ({
                embeds: [buildEmbed(state)],
                components: buildComponents(state),
            });

            const msg = await interaction.editReply(getPayload());

            const collector = msg.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: COLLECTOR_TTL,
            });

            collector.on("collect", async (i) => {
                // ── Categoría ──────────────────────────────────────────────
                if (i.customId === "select_stat") {
                    const si = i as StringSelectMenuInteraction;
                    state.view = si.values[0] as ViewMode;
                    state.page = 0;

                    // ── Temporada ──────────────────────────────────────────────
                } else if (i.customId === "select_season") {
                    const si = i as StringSelectMenuInteraction;
                    const seasonId = Number(si.values[0]);
                    const newSeason = allSeasons.find(s => s.id === seasonId);
                    if (!newSeason) { await i.deferUpdate(); return; }

                    state.season = newSeason;
                    state.competition = null;
                    state.view = "overview";
                    state.page = 0;
                    state.competitions = await Competition.findAll({
                        where: { seasonId: newSeason.id },
                        order: [["isActive", "DESC"], ["name", "ASC"]],
                    });
                    state.rows = await loadRows(newSeason, modality, null);

                    // ── Competencia ────────────────────────────────────────────
                } else if (i.customId === "select_comp") {
                    const si = i as StringSelectMenuInteraction;
                    const val = si.values[0];

                    if (val === "all") {
                        state.competition = null;
                    } else {
                        const comp = state.competitions.find(c => c.id === Number(val)) ?? null;
                        state.competition = comp;
                    }

                    state.view = "overview";
                    state.page = 0;
                    state.rows = await loadRows(state.season, modality, state.competition);

                    // ── Paginación ─────────────────────────────────────────────
                } else if (i.customId === "next") {
                    state.page++;
                } else if (i.customId === "prev") {
                    state.page--;
                } else if (i.customId === "home") {
                    state.view = "overview";
                    state.page = 0;
                }

                await i.update(getPayload());
            });

            collector.on("end", () => {
                interaction.editReply({ components: [] }).catch(() => null);
            });

        } catch (error) {
            logger.error(`/league-tops | modalidad: ${modalityName}`, error);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xE74C3C)
                    .setDescription("No se pudo cargar el ranking. El equipo técnico fue notificado.")],
            });
        }
    },
};