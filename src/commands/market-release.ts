import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    GuildMember,
    TextChannel,
    AttachmentBuilder,
    AutocompleteInteraction,
    User,
} from "discord.js";

import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { Participant } from "../database/models/Participant.js";
import { Player } from "../database/models/Player.js";
import { Team } from "../database/models/Team.js";
import { Season } from "../database/models/Season.js";
import { Modality, ModalitySettings, DEFAULT_SETTINGS } from "../database/models/Modality.js";
import { logger } from "../utils/logger.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGOS_DIR = path.join(__dirname, "../../logos");
const FONDO_PATH = path.join(LOGOS_DIR, "fondo_bajas.png");

const resolveSettings = (raw: Partial<ModalitySettings> | null): ModalitySettings =>
    ({ ...DEFAULT_SETTINGS, ...raw });

function isDTorSubDT(member: GuildMember, settings: ModalitySettings): boolean {
    return !!(
        (settings.rol_dt && member.roles.cache.has(settings.rol_dt)) ||
        (settings.rol_sub_dt && member.roles.cache.has(settings.rol_sub_dt))
    );
}

async function fileExists(p: string): Promise<boolean> {
    return fs.access(p).then(() => true).catch(() => false);
}

interface ReleaseEmbedData {
    target: User;
    dtUser: User;
    team: Team;
    modality: Modality;
    season: Season;
    position: string;
    plantilla: number;
    color: number;
    logoFilename: string | null;
    fondoExists: boolean;
    guildIconURL: string | null;
}

function buildPublicEmbed(d: ReleaseEmbedData): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(d.color)
        .setAuthor({
            name: `Baja · ${d.modality.displayName}`,
            iconURL: d.guildIconURL ?? undefined,
        })
        .setTitle(`${d.team.name} ha dado de baja a un jugador`)
        .setDescription(
            `<@${d.target.id}> ha sido liberado del equipo **${d.team.name}**.\n` +
            `Queda disponible como agente libre en el mercado.`
        )
        .addFields(
            { name: "🛡️ Equipo", value: `\`${d.team.name}\``, inline: true },
            { name: "👤 DT", value: `<@${d.dtUser.id}>`, inline: true },
            { name: "👥 Plantilla", value: `\`${d.plantilla}/${d.modality.playersPerTeam}\``, inline: true },
            { name: "📍 Posición", value: `\`${d.position}\``, inline: true },
            { name: "📅 Temporada", value: `\`${d.season.name}\``, inline: true },
        )
        .setFooter({ text: `iDinox v3 · ${d.modality.displayName} · ${d.season.name}` })
        .setTimestamp();

    if (d.logoFilename) embed.setThumbnail(`attachment://${d.logoFilename}`);
    if (d.fondoExists) embed.setImage("attachment://fondo_bajas.png");

    return embed;
}

function buildDmEmbed(d: ReleaseEmbedData): EmbedBuilder {
    const displayDT = d.dtUser.globalName ?? d.dtUser.username;
    return new EmbedBuilder()
        .setColor(d.color)
        .setTitle("📤 Has sido dado de baja")
        .setDescription(
            `El cuerpo técnico de **${d.team.name}** ha decidido prescindir de tus servicios ` +
            `en **iDinox ${d.modality.displayName}**.\n` +
            `Quedas disponible como agente libre.`
        )
        .addFields(
            { name: "🛡️ Equipo", value: `\`${d.team.name}\``, inline: true },
            { name: "👤 DT", value: `\`${displayDT}\``, inline: true },
            { name: "📅 Temporada", value: `\`${d.season.name}\``, inline: true },
        )
        .setFooter({ text: "iDinox v3 · Agente Libre" })
        .setTimestamp();
}

export default {
    category: "💰 Mercado & Fichajes",
    emoji: "📤",
    usage: "/market release [modalidad] [jugador]",

    data: new SlashCommandBuilder()
        .setName("market-release")
        .setDescription("Da de baja a un jugador de tu equipo.")
        .setDMPermission(false)
        .addStringOption(opt =>
            opt.setName("modalidad").setDescription("Modalidad del equipo.").setRequired(true).setAutocomplete(true)
        )
        .addUserOption(opt =>
            opt.setName("jugador").setDescription("Jugador a dar de baja.").setRequired(true)
        ),

    async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        await autocompleteModality(interaction);
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const member = interaction.member as GuildMember | null;
        const modalityName = interaction.options.getString("modalidad", true);
        const targetUser = interaction.options.getUser("jugador", true);

        if (!member) {
            await interaction.editReply({ content: "No se pudo verificar tu identidad." });
            return;
        }
        if (targetUser.bot) {
            await interaction.editReply({ content: "No puedes dar de baja a un bot." });
            return;
        }
        if (targetUser.id === interaction.user.id) {
            await interaction.editReply({ content: "No puedes darte de baja a ti mismo." });
            return;
        }

        try {
            const modality = await Modality.findOne({ where: { name: modalityName, isActive: true } });
            if (!modality) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setTitle("Modalidad no encontrada")
                        .setDescription(`La modalidad **${modalityName.toUpperCase()}** no existe o no está activa.`)],
                });
                return;
            }

            const settings = resolveSettings(modality.settings);

            if (!isDTorSubDT(member, settings)) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setTitle("Sin permisos")
                        .setDescription("Solo los **Directores Técnicos** y **Sub-DT** pueden dar de baja jugadores.")],
                });
                return;
            }

            if (!settings.marketOpen) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setTitle("Mercado cerrado")
                        .setDescription(`El mercado de **${modality.displayName}** está cerrado actualmente.`)],
                });
                return;
            }

            const season = await Season.findOne({ where: { modalityId: modality.id, isActive: true } });
            if (!season) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE67E22).setTitle("Sin temporada activa")
                        .setDescription(`No hay una temporada activa en **${modality.displayName}**.`)],
                });
                return;
            }

            const [[dtPlayer], targetPlayer] = await Promise.all([
                Player.findOrCreate({
                    where: { discordId: interaction.user.id },
                    defaults: {
                        discordId: interaction.user.id,
                        username: interaction.user.username,
                        globalName: interaction.user.globalName ?? null,
                    },
                }),
                Player.findOne({ where: { discordId: targetUser.id } }),
            ]);

            if (!targetPlayer) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setTitle("Jugador no encontrado")
                        .setDescription(`**${targetUser.globalName ?? targetUser.username}** no tiene ficha en iDinox.`)],
                });
                return;
            }

            const [dtParticipant, targetParticipant] = await Promise.all([
                Participant.findOne({ where: { playerId: dtPlayer.id, seasonId: season.id, modalityId: modality.id } }),
                Participant.findOne({ where: { playerId: targetPlayer.id, seasonId: season.id, modalityId: modality.id } }),
            ]);

            if (!dtParticipant?.teamId) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setTitle("Sin equipo")
                        .setDescription(`No estás asignado a ningún equipo en **${modality.displayName}** esta temporada.`)],
                });
                return;
            }

            if (!targetParticipant?.teamId || targetParticipant.teamId !== dtParticipant.teamId) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setTitle("Jugador no pertenece a tu equipo")
                        .setDescription(
                            `**${targetUser.globalName ?? targetUser.username}** no forma parte de tu equipo esta temporada.`
                        )],
                });
                return;
            }

            const [team, targetMember] = await Promise.all([
                Team.findOne({ where: { id: dtParticipant.teamId, isActive: true } }),
                interaction.guild?.members.fetch(targetUser.id).catch(() => null) ?? Promise.resolve(null),
            ]);

            if (!team) {
                await interaction.editReply({ content: "No se encontró tu equipo en el sistema." });
                return;
            }

            const resolvedLogoFilename = team.logoPath ? path.basename(team.logoPath) : null;
            const logoFullPath = resolvedLogoFilename ? path.join(LOGOS_DIR, resolvedLogoFilename) : null;

            const [logoExists, fondoExists] = await Promise.all([
                logoFullPath ? fileExists(logoFullPath) : Promise.resolve(false),
                fileExists(FONDO_PATH),
            ]);

            const plantillaAntes = await Participant.count({
                where: { teamId: team.id, seasonId: season.id, isActive: true },
            });

            targetParticipant.teamId = null;
            await targetParticipant.save();

            if (targetMember) {
                const displayName = targetUser.globalName ?? targetUser.username;
                const teamRole = interaction.guild?.roles.cache.get(team.roleId);
                await Promise.allSettled([
                    targetMember.setNickname(displayName.slice(0, 32)),
                    teamRole ? targetMember.roles.remove(teamRole) : Promise.resolve(),
                ]);
            }

            const rolEquipo = interaction.guild?.roles.cache.get(team.roleId);
            const color = (rolEquipo?.color && rolEquipo.color !== 0) ? rolEquipo.color : 0xED4245;

            const embedData: ReleaseEmbedData = {
                target: targetUser,
                dtUser: interaction.user,
                team,
                modality,
                season,
                position: targetParticipant.position ?? "N/A",
                plantilla: plantillaAntes - 1,
                color,
                logoFilename: logoExists ? resolvedLogoFilename : null,
                fondoExists,
                guildIconURL: interaction.guild?.iconURL({ extension: "png" }) ?? null,
            };

            const files: AttachmentBuilder[] = [];
            if (logoExists && logoFullPath && resolvedLogoFilename) {
                files.push(new AttachmentBuilder(logoFullPath, { name: resolvedLogoFilename }));
            }
            if (fondoExists) {
                files.push(new AttachmentBuilder(FONDO_PATH, { name: "fondo_bajas.png" }));
            }

            const canal = settings.canal_mercado_bajas
                ? interaction.guild?.channels.cache.get(settings.canal_mercado_bajas) as TextChannel | undefined
                : undefined;

            await Promise.allSettled([
                canal?.send({
                    content: `<@${targetUser.id}>`,
                    embeds: [buildPublicEmbed(embedData)],
                    files,
                }),
                targetUser.send({
                    embeds: [buildDmEmbed(embedData)],
                }),
            ]);

            logger.success(
                `/market release | ${interaction.user.username} dio de baja a **${targetUser.globalName ?? targetUser.username}** de **${team.name}** en ${modality.displayName}`
            );

            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x2ECC71)
                        .setTitle("✅ Baja completada")
                        .setDescription(
                            `**${targetUser.globalName ?? targetUser.username}** ha sido liberado de **${team.name}** ` +
                            `y queda disponible como agente libre.`
                        )
                        .addFields(
                            { name: "Jugador", value: `<@${targetUser.id}>`, inline: true },
                            { name: "Plantilla", value: `\`${embedData.plantilla}/${modality.playersPerTeam}\``, inline: true },
                        )
                        .setTimestamp(),
                ],
            });

        } catch (error) {
            logger.error(
                `/market release | user: ${interaction.user.id} | target: ${targetUser.id} | modalidad: ${modalityName}`,
                error
            );
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xE74C3C).setTitle("Algo salió mal")
                    .setDescription("No se pudo completar la baja. El equipo técnico fue notificado.")],
            });
        }
    },
};