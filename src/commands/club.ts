import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    GuildMember,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    AutocompleteInteraction,
    ComponentType,
} from "discord.js";

import { Op }          from "sequelize";
import { promises as fs } from "fs";
import * as path          from "path";
import { fileURLToPath }  from "url";

import { Player }      from "../database/models/Player.js";
import { Participant } from "../database/models/Participant.js";
import { Team }        from "../database/models/Team.js";
import { Season }      from "../database/models/Season.js";
import { Modality, ModalitySettings, DEFAULT_SETTINGS } from "../database/models/Modality.js";
import { Stat, StatValues } from "../database/models/Stat.js";
import { Award }       from "../database/models/Award.js";
import { AwardWinner } from "../database/models/AwardWinner.js";
import { logger }    from "../utils/logger.js";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const LOGOS_DIR    = path.join(__dirname, "../../logos");
const COLOR_FALLBACK = "#2B2D31";
const COLLECTOR_TTL  = 120_000;

const resolveSettings = (raw: Partial<ModalitySettings> | null): ModalitySettings =>
    ({ ...DEFAULT_SETTINGS, ...raw });

async function fileExists(p: string): Promise<boolean> {
    return fs.access(p).then(() => true).catch(() => false);
}

function sumStats(stats: Stat[]): StatValues {
    const base: StatValues = { goles: 0, asistencias: 0, vallas: 0, autogoles: 0 };
    for (const s of stats) {
        for (const key of Object.keys(s.values ?? {})) {
            base[key] = (base[key] ?? 0) + (s.values[key] ?? 0);
        }
    }
    return base;
}

function statTag(v: StatValues): string {
    const parts: string[] = [];
    if (v.goles)       parts.push(`G:${v.goles}`);
    if (v.asistencias) parts.push(`A:${v.asistencias}`);
    if (v.vallas)      parts.push(`CS:${v.vallas}`);
    if (v.autogoles)   parts.push(`AG:${v.autogoles}`);
    return parts.length ? `\`${parts.join(" · ")}\`` : "";
}

interface PlayerRow {
    discordId: string;
    position:  string;
    stats:     StatValues;
    isDT:      boolean;
    isSubDT:   boolean;
}

// ─── Tipos para campeonatos ───────────────────────────────────────────────────

type AwardWithSeason = Award & { season: Season };

interface ClubTitles {
    team: AwardWithSeason[];
}

// ─── Carga de plantilla ───────────────────────────────────────────────────────

async function loadRoster(
    team:     Team,
    season:   Season,
    modality: Modality,
    guild:    NonNullable<ChatInputCommandInteraction["guild"]>,
): Promise<PlayerRow[]> {
    const settings = resolveSettings(modality.settings);

    const participants = await Participant.findAll({
        where: {
            teamId:     team.id,
            seasonId:   season.id,
            modalityId: modality.id,
            isActive:   true,
        },
        include: [
            { model: Player, as: "player",  required: true  },
            { model: Stat,   as: "stats",   required: false },
        ],
    }) as (Participant & { player: Player; stats: Stat[] })[];

    const discordIds = participants.map(p => p.player.discordId);
    const memberMap  = new Map<string, GuildMember>();

    await Promise.allSettled(
        discordIds.map(id =>
            guild.members.fetch(id)
                .then(m => memberMap.set(id, m))
                .catch(() => null)
        )
    );

    const rows: PlayerRow[] = participants.map(p => {
        const member  = memberMap.get(p.player.discordId) ?? null;
        const isDT    = !!(settings.rol_dt     && member?.roles.cache.has(settings.rol_dt));
        const isSubDT = !!(settings.rol_sub_dt && member?.roles.cache.has(settings.rol_sub_dt));

        return {
            discordId: p.player.discordId,
            position:  p.position ?? "N/A",
            stats:     sumStats(p.stats ?? []),
            isDT,
            isSubDT,
        };
    });

    rows.sort((a, b) => {
        if (a.isDT && !b.isDT) return -1;
        if (!a.isDT && b.isDT) return 1;
        if (a.isSubDT && !b.isSubDT) return -1;
        if (!a.isSubDT && b.isSubDT) return 1;
        return 0;
    });

    return rows;
}

// ─── Carga de títulos del equipo ──────────────────────────────────────────────

async function loadClubTitles(teamId: number): Promise<ClubTitles> {
    const winners = await AwardWinner.findAll({
        where: { teamId },
        include: [
            {
                model:    Award,
                as:       "award",
                required: true,
                where:    { type: "team" },
                include:  [{ model: Season, as: "season", required: true }],
            },
        ],
    }) as (AwardWinner & { award: AwardWithSeason })[];

    // Deduplicar por award.id (podría llegar duplicado si hay varias filas por equipo)
    const seen  = new Set<number>();
    const team: AwardWithSeason[] = [];

    for (const w of winners) {
        if (seen.has(w.award.id)) continue;
        seen.add(w.award.id);
        team.push(w.award);
    }

    // Orden cronológico: temporada más reciente primero (por id DESC)
    team.sort((a, b) => b.season.id - a.season.id);

    return { team };
}

// ─── Embed ────────────────────────────────────────────────────────────────────

function buildEmbed(
    team:     Team,
    modality: Modality,
    season:   Season,
    roster:   PlayerRow[],
    titles:   ClubTitles,
    guild:    NonNullable<ChatInputCommandInteraction["guild"]>,
    hasLogo:  boolean,
): EmbedBuilder {
    const rol   = guild.roles.cache.get(team.roleId);
    const color = (rol?.hexColor && rol.hexColor !== "#000000")
        ? rol.hexColor
        : COLOR_FALLBACK;

    const dt       = roster.find(r => r.isDT);
    const subdt    = roster.find(r => r.isSubDT);
    const dtStr    = dt    ? `<@${dt.discordId}>`    : "`Vacante`";
    const subdtStr = subdt ? `<@${subdt.discordId}>` : "`Vacante`";

    const listaStr = roster.length
        ? roster.map((r, i) => {
            const badge  = r.isDT ? " `DT`" : r.isSubDT ? " `Sub-DT`" : "";
            const posStr = r.position && r.position !== "N/A" ? `\`${r.position}\` ` : "";
            const stats  = statTag(r.stats);
            return `\`${String(i + 1).padStart(2, "0")}.\` ${posStr}<@${r.discordId}>${badge}${stats ? "  " + stats : ""}`;
        }).join("\n")
        : "_Sin jugadores registrados._";

    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({
            name:    `${team.name} · ${modality.displayName}`,
            iconURL: guild.iconURL({ extension: "png" }) ?? undefined,
        })
        .setThumbnail(hasLogo ? "attachment://logo.png" : null)
        .addFields(
            {
                name:   "Cuerpo Técnico",
                value:  `DT → ${dtStr}\nSub-DT → ${subdtStr}`,
                inline: true,
            },
            {
                name: "Info",
                value: [
                    `Temporada → \`${season.name}\``,
                    `Plantilla → \`${roster.length}/${modality.playersPerTeam}\``,
                    `Fichajes emergencia → \`${team.emergencySigns ?? 0}\``,
                ].join("\n"),
                inline: true,
            },
            ...(titles.team.length ? [{
                name:  `Campeonatos (${titles.team.length})`,
                value: titles.team
                    .map(a => `· **${a.name}** · \`${a.season.name}\``)
                    .join("\n"),
            }] : []),
            {
                name:  `Plantilla (${roster.length}/${modality.playersPerTeam})`,
                value: listaStr,
            },
            {
                name:  "Equipación",
                value: `🏠 ${team.uniformHome || "`N/A`"}  ·  ✈️ ${team.uniformAway || "`N/A`"}`,
            },
        );

    return embed
        .setFooter({ text: "iDinox v3 · Ficha de Club" })
        .setTimestamp();
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────

async function autocompleteTeam(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused().toLowerCase();

    const [teams, modalities] = await Promise.all([
        Team.findAll({
            where: {
                isActive: true,
                ...(focused ? {
                    [Op.or]: [
                        { name:         { [Op.like]: `%${focused}%` } },
                        { abbreviation: { [Op.like]: `%${focused}%` } },
                    ],
                } : {}),
            },
            limit: 25,
        }),
        Modality.findAll({ where: { isActive: true } }),
    ]);

    const modalityMap = new Map(modalities.map(m => [m.id, m.displayName]));

    await interaction.respond(
        teams.map(t => ({
            name:  `${t.name} · ${modalityMap.get(t.modalityId) ?? "?"}`,
            value: String(t.id),
        }))
    );
}

// ─── Comando ──────────────────────────────────────────────────────────────────

export default {
    category: "👥 Gestión de Equipos",
    emoji:    "🏟️",
    usage:    "/club (equipo)",

    data: new SlashCommandBuilder()
        .setName("club")
        .setDescription("Consulta la ficha técnica de un equipo.")
        .setDMPermission(false)
        .addStringOption(opt =>
            opt.setName("equipo")
                .setDescription("Equipo a consultar (por defecto: tu equipo actual).")
                .setRequired(false)
                .setAutocomplete(true)
        ),

    async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        await autocompleteTeam(interaction);
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply();

        const equipoInput = interaction.options.getString("equipo");

        try {
            let team: Team | null = null;

            if (equipoInput) {
                team = await Team.findOne({ where: { id: Number(equipoInput), isActive: true } });
            } else {
                const player = await Player.findOne({ where: { discordId: interaction.user.id } });

                if (player) {
                    const activeSeasons = await Season.findAll({ where: { isActive: true } });
                    const seasonIds     = activeSeasons.map(s => s.id);

                    const participants = await Participant.findAll({
                        where: {
                            playerId: player.id,
                            seasonId: { [Op.in]: seasonIds },
                            isActive: true,
                        },
                    });

                    const withTeam = participants.filter(p => p.teamId);

                    if (withTeam.length === 0) {
                        await interaction.editReply({
                            embeds: [new EmbedBuilder().setColor(0xE67E22)
                                .setDescription("No perteneces a ningún equipo actualmente. Indica un equipo con el parámetro `equipo`.")],
                        });
                        return;
                    }

                    if (withTeam.length === 1) {
                        team = await Team.findOne({ where: { id: withTeam[0].teamId!, isActive: true } });
                    } else {
                        const teams = await Promise.all(withTeam.map(p => Team.findByPk(p.teamId!)));
                        const modalities = await Modality.findAll({ where: { isActive: true } });
                        const modalityMap = new Map(modalities.map(m => [m.id, m.displayName]));

                        const opciones = teams
                            .filter(Boolean)
                            .map(t => `· **${t!.name}** \`${modalityMap.get(t!.modalityId) ?? "?"}\``)
                            .join("\n");

                        await interaction.editReply({
                            embeds: [new EmbedBuilder().setColor(0x1E90FF)
                                .setTitle("Estás en varios equipos")
                                .setDescription(
                                    `Perteneces a más de un equipo. Usa el parámetro \`equipo\` para elegir cuál ver:\n\n${opciones}`
                                )],
                        });
                        return;
                    }
                }
            }

            if (!team) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C)
                        .setDescription("No se encontró el equipo o no estás en ninguno.")],
                });
                return;
            }

            const modality = await Modality.findOne({ where: { id: team.modalityId, isActive: true } });
            if (!modality) {
                await interaction.editReply({ content: "La modalidad de este equipo no está activa." });
                return;
            }

            const season = await Season.findOne({ where: { modalityId: modality.id, isActive: true } });
            if (!season) {
                await interaction.editReply({ content: `No hay temporada activa en **${modality.displayName}**.` });
                return;
            }

            const logoFilename = team.logoPath ? path.basename(team.logoPath) : null;
            const logoFullPath = logoFilename ? path.join(LOGOS_DIR, logoFilename) : null;
            const hasLogo      = !!(logoFullPath && await fileExists(logoFullPath));
            const files        = hasLogo ? [new AttachmentBuilder(logoFullPath!, { name: "logo.png" })] : [];

            let [roster, titles] = await Promise.all([
                loadRoster(team, season, modality, interaction.guild!),
                loadClubTitles(team.id),
            ]);

            const buildPayload = () => ({
                embeds: [buildEmbed(team!, modality, season, roster, titles, interaction.guild!, hasLogo)],
                components: [
                    new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder()
                            .setCustomId("refresh_club")
                            .setEmoji("🔄")
                            .setStyle(ButtonStyle.Secondary)
                    ),
                ],
                files,
            });

            const response = await interaction.editReply(buildPayload());

            const collector = response.createMessageComponentCollector({
                filter:        i => i.user.id === interaction.user.id,
                time:          COLLECTOR_TTL,
                componentType: ComponentType.Button,
            });

            collector.on("collect", async i => {
                if (i.customId === "refresh_club") {
                    await i.deferUpdate();
                    [roster, titles] = await Promise.all([
                        loadRoster(team!, season, modality, interaction.guild!),
                        loadClubTitles(team!.id),
                    ]);
                    await interaction.editReply(buildPayload());
                }
            });

            collector.on("end", () => {
                interaction.editReply({ components: [] }).catch(() => null);
            });

        } catch (error) {
            logger.error(`/club | user: ${interaction.user.id} | equipo: ${equipoInput}`, error);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xE74C3C)
                    .setDescription("No se pudo cargar la ficha del club. El equipo técnico fue notificado.")],
            });
        }
    },
};