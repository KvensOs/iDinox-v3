import { Events, Message, EmbedBuilder, GuildMember } from "discord.js";
import { Modality } from "../database/models/Modality.js";
import { Season } from "../database/models/Season.js";
import { Competition } from "../database/models/Competition.js";
import { Player } from "../database/models/Player.js";
import { isModalityAdmin } from "../utils/permissions.js";
import { parseStats, applyStats, sendStatsLog } from "../utils/statsHelper.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shouldIgnore(message: Message): boolean {
    return message.author.bot || !!message.webhookId || !message.guild;
}

function isBotMentioned(message: Message, botId: string): boolean {
    if (message.mentions.everyone) return false;
    if (message.mentions.roles.size > 0 && !message.mentions.users.has(botId)) return false;
    return (
        message.mentions.users.has(botId) ||
        message.content.includes(`<@${botId}>`) ||
        message.content.includes(`<@!${botId}>`)
    );
}

// ─── Handler de stats por canal ───────────────────────────────────────────────

/**
 * Busca si el canal del mensaje corresponde a una competición activa.
 * Solo considera competiciones cuya temporada esté activa.
 */
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
        include: [{
            model: Season,
            as: "season",
            where: { isActive: true },
            required: true,
            include: [{
                model: Modality,
                as: "modality",
                where: { isActive: true },
                required: true,
            }],
        }],
    });

    if (!competition) return null;

    const season = (competition as unknown as { season: Season & { modality: Modality } }).season;
    const modality = season.modality;

    return { competition, season, modality };
}

/**
 * Parsea un mensaje del canal de stats.
 * Formato: @Jugador g2 a1 cs1
 * Retorna null si el mensaje no tiene la estructura esperada.
 */
function parseChannelMessage(message: Message): {
    targetUser: import("discord.js").User;
    rawStats: string;
} | null {
    // El primer mention debe ser un usuario (no bot, no everyone)
    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser || mentionedUser.bot) return null;

    // Quitar el mention del contenido para quedarse con las stats
    const withoutMention = message.content
        .replace(/<@!?\d+>/g, "")
        .trim();

    if (!withoutMention) return null;

    return { targetUser: mentionedUser, rawStats: withoutMention };
}

async function handleStatsChannel(message: Message): Promise<boolean> {
    const match = await findCompetitionByChannel(message.channelId);
    if (!match) return false;

    const { competition, season, modality } = match;
    const member = message.member as GuildMember;
    const settings = modality.settings;

    // Verificar permisos
    const hasEstadistiquero = settings.rol_estadistiquero
        ? member.roles.cache.has(settings.rol_estadistiquero)
        : false;
    const hasAdmin = isModalityAdmin(member, message.client, settings);

    if (!hasEstadistiquero && !hasAdmin) {
        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setDescription("No tienes permisos para registrar estadísticas en esta modalidad."),
            ],
        }).catch(() => null);
        return true;
    }

    // Parsear estructura del mensaje
    const parsed = parseChannelMessage(message);
    if (!parsed) return true; // está en el canal pero no tiene formato válido — ignorar silencioso

    const { targetUser, rawStats } = parsed;

    // Parsear stats
    const { deltas, errors } = parseStats(rawStats);

    if (errors.length) {
        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setTitle("Formato incorrecto")
                    .setDescription(errors.join("\n"))
                    .setFooter({ text: "Ejemplo: @Jugador g2 a1 cs1 | @Jugador g-1" }),
            ],
        }).catch(() => null);
        return true;
    }

    if (!Object.keys(deltas).length) {
        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xE67E22)
                    .setDescription("No se detectaron stats válidas en el mensaje."),
            ],
        }).catch(() => null);
        return true;
    }

    // Resolver jugador
    const targetPlayer = await Player.findOne({ where: { discordId: targetUser.id } });
    if (!targetPlayer) {
        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setDescription(`**${targetUser.username}** no está registrado en iDinox.`),
            ],
        }).catch(() => null);
        return true;
    }

    // Aplicar stats
    const result = await applyStats(modality, competition, targetPlayer, season, deltas);

    if (!result.success) {
        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setDescription(result.errorMessage ?? "No se pudieron aplicar las estadísticas."),
            ],
        }).catch(() => null);
        return true;
    }

    // Respuesta pública
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("Estadísticas actualizadas")
        .addFields(
            { name: "Jugador", value: `\`${targetPlayer.username}\``, inline: true },
            { name: "Competicion", value: `\`${competition.name}\``, inline: true },
            { name: "Cambios", value: result.appliedChanges.join("\n") },
        )
        .setTimestamp();

    if (result.clampedKeys.length)
        embed.setFooter({ text: `Clamp aplicado en: ${result.clampedKeys.join(", ")}` });

    await message.reply({ embeds: [embed] }).catch(() => null);

    // Log al canal_logs de la modalidad
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

// ─── Evento ───────────────────────────────────────────────────────────────────

export default {
    name: Events.MessageCreate,

    async execute(message: Message): Promise<void> {
        if (shouldIgnore(message)) return;

        // Primero verificar si el mensaje es en un canal de stats
        const handledAsStats = await handleStatsChannel(message);
        if (handledAsStats) return;

        // Flujo normal: mención al bot
        const botId = message.client.user?.id;
        if (!botId || !isBotMentioned(message, botId)) return;

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle("👋 ¡Hola!")
            .setDescription(
                "Soy **iDinox v3**, el sistema de gestión de ligas.\n" +
                "Usa `/ayuda` para ver todos los comandos disponibles."
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