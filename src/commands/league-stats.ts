import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    EmbedBuilder,
    GuildMember,
    MessageFlags,
} from "discord.js";

import { Op } from "sequelize";
import { Modality } from "../database/models/Modality.js";
import { Season } from "../database/models/Season.js";
import { Competition } from "../database/models/Competition.js";
import { Player } from "../database/models/Player.js";
import { Participant } from "../database/models/Participant.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";
import { isModalityAdmin } from "../utils/permissions.js";
import { logger } from "../utils/logger.js";
import { parseStats, applyStats, sendStatsLog } from "../utils/statsHelper.js";

// ─── Autocomplete helpers ──────────────────────────────────────────────────────

async function autocompleteCompetition(
    interaction: AutocompleteInteraction,
    modalityName: string,
): Promise<void> {
    const modality = await Modality.findOne({ where: { name: modalityName, isActive: true } });
    if (!modality) { await interaction.respond([]); return; }

    const season = await Season.findOne({ where: { modalityId: modality.id, isActive: true } });
    if (!season) { await interaction.respond([]); return; }

    const focused = interaction.options.getFocused().toLowerCase();

    const competitions = await Competition.findAll({
        where: {
            seasonId: season.id,
            isActive: true,
            name: { [Op.like]: `%${focused}%` },
        },
        limit: 25,
    });

    await interaction.respond(
        competitions.map(c => ({ name: `${c.name} · ${c.type}`, value: String(c.id) })),
    );
}

async function autocompletePlayer(
    interaction: AutocompleteInteraction,
    modalityName: string,
): Promise<void> {
    const modality = await Modality.findOne({ where: { name: modalityName, isActive: true } });
    if (!modality) { await interaction.respond([]); return; }

    const season = await Season.findOne({ where: { modalityId: modality.id, isActive: true } });
    if (!season) { await interaction.respond([]); return; }

    const focused = interaction.options.getFocused().toLowerCase();

    const participants = await Participant.findAll({
        where: { seasonId: season.id, modalityId: modality.id },
        include: [{
            model: Player,
            as: "player",
            where: { username: { [Op.like]: `%${focused}%` } },
            required: true,
        }],
        limit: 25,
    });

    await interaction.respond(
        participants.map(p => {
            const player = (p as Participant & { player: Player }).player;
            return { name: player.username, value: player.discordId };
        }),
    );
}

// ─── Comando ──────────────────────────────────────────────────────────────────

export default {
    category: "📊 Carrera & Estadísticas",
    emoji: "📈",
    usage: "/league-stats add [modalidad] [competicion] [jugador] [stats]",

    data: new SlashCommandBuilder()
        .setName("league-stats")
        .setDescription("Gestión de estadísticas de jugadores.")
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub
                .setName("add")
                .setDescription("Añade o resta estadísticas a un jugador en una competición.")
                .addStringOption(opt =>
                    opt.setName("modalidad")
                        .setDescription("Modalidad de la competición.")
                        .setRequired(true)
                        .setAutocomplete(true),
                )
                .addStringOption(opt =>
                    opt.setName("competicion")
                        .setDescription("Competición donde se registran las stats.")
                        .setRequired(true)
                        .setAutocomplete(true),
                )
                .addStringOption(opt =>
                    opt.setName("jugador")
                        .setDescription("Jugador al que se le cargan las stats.")
                        .setRequired(true)
                        .setAutocomplete(true),
                )
                .addStringOption(opt =>
                    opt.setName("stats")
                        .setDescription("Stats a registrar. Ej: g2 a1 cs1  |  g-2 og1")
                        .setRequired(true),
                ),
        ),

    async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        const focused = interaction.options.getFocused(true);
        const modalityName = interaction.options.getString("modalidad") ?? "";

        if (focused.name === "modalidad") {
            await autocompleteModality(interaction);
            return;
        }
        if (focused.name === "competicion") {
            await autocompleteCompetition(interaction, modalityName);
            return;
        }
        if (focused.name === "jugador") {
            await autocompletePlayer(interaction, modalityName);
        }
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const sub = interaction.options.getSubcommand();
        if (sub !== "add") return;

        const modalityName    = interaction.options.getString("modalidad",    true);
        const competitionId   = Number(interaction.options.getString("competicion", true));
        const playerDiscordId = interaction.options.getString("jugador",      true);
        const rawStats        = interaction.options.getString("stats",        true);

        try {
            // ── Modalidad ──────────────────────────────────────────────────
            const modality = await Modality.findOne({ where: { name: modalityName, isActive: true } });
            if (!modality) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setDescription("Modalidad no encontrada o inactiva.")],
                });
                return;
            }

            // ── Permisos ───────────────────────────────────────────────────
            const settings = modality.settings;
            const member = interaction.member as GuildMember;

            const hasEstadistiquero = settings.rol_estadistiquero
                ? member.roles.cache.has(settings.rol_estadistiquero)
                : false;
            const hasAdmin = isModalityAdmin(member, interaction.client, settings);

            if (!hasEstadistiquero && !hasAdmin) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setDescription("No tienes permisos para registrar estadísticas en esta modalidad.")],
                });
                return;
            }

            // ── Temporada ──────────────────────────────────────────────────
            const season = await Season.findOne({ where: { modalityId: modality.id, isActive: true } });
            if (!season) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE67E22).setDescription("No hay temporada activa en esta modalidad.")],
                });
                return;
            }

            // ── Competición ────────────────────────────────────────────────
            const competition = await Competition.findOne({
                where: { id: competitionId, seasonId: season.id, isActive: true },
            });
            if (!competition) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setDescription("Competición no encontrada o inactiva.")],
                });
                return;
            }

            // ── Jugador ────────────────────────────────────────────────────
            const targetPlayer = await Player.findOne({ where: { discordId: playerDiscordId } });
            if (!targetPlayer) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setDescription("Jugador no encontrado en iDinox.")],
                });
                return;
            }

            // ── Parsear ────────────────────────────────────────────────────
            const { deltas, errors } = parseStats(rawStats);

            if (errors.length) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xE74C3C)
                            .setTitle("Formato incorrecto")
                            .setDescription(errors.join("\n"))
                            .setFooter({ text: "Ejemplo: g2 a1 cs1 | g-2 og1" }),
                    ],
                });
                return;
            }

            if (!Object.keys(deltas).length) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE67E22).setDescription("No se detectaron stats válidas en el input.")],
                });
                return;
            }

            // ── Aplicar ────────────────────────────────────────────────────
            const result = await applyStats(modality, competition, targetPlayer, season, deltas);

            if (!result.success) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setDescription(result.errorMessage ?? "No se pudieron aplicar las estadísticas.")],
                });
                return;
            }

            // ── Respuesta ──────────────────────────────────────────────────
            const embed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle("Estadísticas actualizadas")
                .addFields(
                    { name: "Jugador",     value: `\`${targetPlayer.username}\``, inline: true },
                    { name: "Competición", value: `\`${competition.name}\``,      inline: true },
                    { name: "Modalidad",   value: `\`${modality.displayName}\``,  inline: true },
                    { name: "Cambios",     value: result.appliedChanges.join("\n") || "_Ninguno_" },
                )
                .setTimestamp();

            if (result.clampedKeys.length)
                embed.setFooter({ text: `Clamp aplicado en: ${result.clampedKeys.join(", ")}` });

            await interaction.editReply({ embeds: [embed] });

            // ── Log ────────────────────────────────────────────────────────
            await sendStatsLog(
                interaction.client,
                modality,
                competition,
                targetPlayer,
                member,
                result.appliedChanges,
                result.clampedKeys,
            );

        } catch (error) {
            logger.error(`/league-stats add | user: ${interaction.user.id}`, error);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xE74C3C).setDescription("Ocurrió un error al procesar las estadísticas. El equipo técnico fue notificado.")],
            });
        }
    },
};