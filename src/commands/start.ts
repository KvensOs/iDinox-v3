import {
    SlashCommandBuilder,
    EmbedBuilder,
    ChatInputCommandInteraction,
    GuildMember,
    ColorResolvable,
    MessageFlags,
    AutocompleteInteraction,
} from "discord.js";

import { Player } from "../database/models/Player.js";
import { Participant, Position } from "../database/models/Participant.js";
import { Modality } from "../database/models/Modality.js";
import { Season } from "../database/models/Season.js";
import { logger } from "../utils/logger.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";

const POSITIONS: { name: string; value: Position }[] = [
    { name: "GK   — Portero", value: "GK" },
    { name: "DEF  — Defensa", value: "DEF" },
    { name: "MID  — Mediocampista", value: "MID" },
    { name: "DFWD — Defensa-Delantero", value: "DFWD" },
    { name: "FWD  — Delantero", value: "FWD" },
];

const COLOR_FALLBACK: ColorResolvable = "#2B2D31";

function getMemberColor(member: GuildMember | null): ColorResolvable {
    const hex = member?.displayHexColor;
    return hex && hex !== "#000000" ? (hex as ColorResolvable) : COLOR_FALLBACK;
}

export default {
    category: "📊 Carrera & Estadísticas",
    emoji: "📝",
    usage: "/start [modalidad] [posicion]",

    data: new SlashCommandBuilder()
        .setName("start")
        .setDescription("Registra tu ficha en iDinox o actualiza tu posición.")
        .setDMPermission(false)
        .addStringOption(opt =>
            opt.setName("modalidad")
                .setDescription("Modalidad en la que quieres registrarte.")
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(opt =>
            opt.setName("posicion")
                .setDescription("Tu posición oficial en el campo.")
                .setRequired(true)
                .addChoices(...POSITIONS)
        ),

    async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        await autocompleteModality(interaction);
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const modalityName = interaction.options.getString("modalidad", true);
        const position = interaction.options.getString("posicion", true) as Position;
        const discordUser = interaction.user;

        try {
            const member = await interaction.guild!.members.fetch(discordUser.id).catch(() => null);
            const color = getMemberColor(member);

            const modality = await Modality.findOne({ where: { name: modalityName, isActive: true } });
            if (!modality) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xE74C3C)
                            .setTitle("Modalidad no disponible")
                            .setDescription(
                                `La modalidad **${modalityName.toUpperCase()}** no está activa en este momento.`
                            ),
                    ],
                });
                return;
            }

            const season = await Season.findOne({ where: { modalityId: modality.id, isActive: true } });
            if (!season) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xE67E22)
                            .setTitle("Sin temporada activa")
                            .setDescription(
                                `No hay una temporada activa para **${modality.displayName}** en este momento.`
                            ),
                    ],
                });
                return;
            }

            const [player, playerCreated] = await Player.findOrCreate({
                where: { discordId: discordUser.id },
                defaults: {
                    discordId: discordUser.id,
                    username: discordUser.username,
                    globalName: discordUser.globalName ?? null,
                },
            });

            if (!playerCreated) {
                let changed = false;
                if (player.username !== discordUser.username) {
                    player.username = discordUser.username;
                    changed = true;
                }
                if (player.globalName !== (discordUser.globalName ?? null)) {
                    player.globalName = discordUser.globalName ?? null;
                    changed = true;
                }
                if (changed) await player.save();
            }

            const existing = await Participant.findOne({
                where: { playerId: player.id, seasonId: season.id, modalityId: modality.id },
            });

            const displayName = discordUser.globalName ?? discordUser.username;

            if (existing) {
                if (existing.position === position) {
                    await interaction.editReply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(color)
                                .setTitle("Sin cambios")
                                .setDescription(
                                    `Ya estás registrado en **${modality.displayName}** con la posición **${position}**.`
                                )
                                .setThumbnail(discordUser.displayAvatarURL({ size: 256 })),
                        ],
                    });
                    return;
                }

                const oldPosition = existing.position;
                existing.position = position;
                await existing.save();

                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(color)
                            .setTitle("Posición actualizada")
                            .setDescription(`Tu posición en **${modality.displayName}** ha sido actualizada.`)
                            .addFields(
                                { name: "Antes", value: `\`${oldPosition}\``, inline: true },
                                { name: "Ahora", value: `\`${position}\``, inline: true },
                                { name: "Temporada", value: `\`${season.name}\``, inline: true },
                            )
                            .setThumbnail(discordUser.displayAvatarURL({ size: 256 }))
                            .setTimestamp(),
                    ],
                });
                return;
            }

            await Participant.create({
                playerId: player.id,
                seasonId: season.id,
                modalityId: modality.id,
                position,
                isActive: true,
            });

            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(color)
                        .setTitle("Registro completado")
                        .setDescription(
                            `Bienvenido a **iDinox ${modality.displayName}**, ${displayName}.\n` +
                            `Tu ficha ha sido creada para la **${season.name}**.`
                        )
                        .addFields(
                            { name: "Modalidad", value: `\`${modality.displayName}\``, inline: true },
                            { name: "Posición", value: `\`${position}\``, inline: true },
                            { name: "Temporada", value: `\`${season.name}\``, inline: true },
                            { name: "Equipo", value: "`Agente Libre`", inline: true },
                        )
                        .setThumbnail(discordUser.displayAvatarURL({ size: 256 }))
                        .setFooter({ text: "Un DT podrá ficharte próximamente · iDinox v3" })
                        .setTimestamp(),
                ],
            });

        } catch (error) {
            logger.error(
                `/start | user: ${discordUser.id} | modalidad: ${modalityName}`,
                error
            );
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xE74C3C)
                        .setTitle("Algo salió mal")
                        .setDescription(
                            "No se pudo procesar tu registro. El equipo técnico fue notificado."
                        ),
                ],
            });
        }
    },
};