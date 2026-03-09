import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    GuildMember,
    TextChannel,
    AutocompleteInteraction,
} from "discord.js";

import { Modality, ModalitySettings, DEFAULT_SETTINGS } from "../database/models/Modality.js";
import { isModalityAdmin, DENIED_EMBED } from "../utils/permissions.js";
import { logger } from "../utils/logger.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";

const resolveSettings = (raw: Partial<ModalitySettings> | null): ModalitySettings =>
    ({ ...DEFAULT_SETTINGS, ...raw });

export default {
    category: "💰 Mercado & Fichajes",
    emoji: "🛒",
    usage: "/market open | close | estado",

    data: new SlashCommandBuilder()
        .setName("market")
        .setDescription("Gestiona el estado del mercado de fichajes.")
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName("open")
                .setDescription("Abre el mercado de fichajes de una modalidad.")
                .addStringOption(opt =>
                    opt.setName("modalidad").setDescription("Modalidad a abrir.").setRequired(true).setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName("close")
                .setDescription("Cierra el mercado de fichajes de una modalidad.")
                .addStringOption(opt =>
                    opt.setName("modalidad").setDescription("Modalidad a cerrar.").setRequired(true).setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName("estado")
                .setDescription("Consulta el estado actual del mercado.")
                .addStringOption(opt =>
                    opt.setName("modalidad").setDescription("Modalidad a consultar.").setRequired(true).setAutocomplete(true)
                )
        ),

    async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        await autocompleteModality(interaction);
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const sub = interaction.options.getSubcommand();
        const modalityName = interaction.options.getString("modalidad", true);
        const member = interaction.member as GuildMember | null;

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

            if (sub === "estado") {
                const abierto = settings.marketOpen;
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(abierto ? 0x57F287 : 0xED4245)
                            .setTitle(`Mercado · ${modality.displayName}`)
                            .setDescription(
                                abierto
                                    ? "El mercado está **abierto**."
                                    : "El mercado está **cerrado**."
                            )
                            .setTimestamp(),
                    ],
                });
                return;
            }

            if (!member || !isModalityAdmin(member, interaction.client, settings)) {
                await interaction.editReply({ embeds: [new EmbedBuilder(DENIED_EMBED)] });
                return;
            }

            const nuevoEstado = sub === "open";

            if (settings.marketOpen === nuevoEstado) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xF1C40F).setTitle("Sin cambios")
                        .setDescription(`El mercado de **${modality.displayName}** ya está ${nuevoEstado ? "abierto" : "cerrado"}.`)],
                });
                return;
            }

            modality.settings = { ...settings, marketOpen: nuevoEstado };
            modality.changed("settings", true);
            await modality.save();

            const notifEmbed = new EmbedBuilder()
                .setColor(nuevoEstado ? 0x57F287 : 0xED4245)
                .setTitle(`Mercado ${nuevoEstado ? "abierto" : "cerrado"} · ${modality.displayName}`)
                .setDescription(
                    nuevoEstado
                        ? `El mercado de **${modality.displayName}** ya está abierto. Los DTs pueden fichar.`
                        : `El mercado de **${modality.displayName}** está cerrado. No habrá más movimientos hasta nuevo aviso.`
                )
                .setFooter({ text: `Por ${interaction.user.username} · iDinox v3` })
                .setTimestamp();

            const canales = [...new Set([settings.canal_mercado_fichajes, settings.canal_mercado_bajas])].filter(Boolean);
            for (const canalId of canales) {
                const canal = interaction.guild?.channels.cache.get(canalId!) as TextChannel | undefined;
                await canal?.send({ embeds: [notifEmbed] }).catch(() => null);
            }

            logger.success(
                `/market ${sub} | ${modality.displayName} → ${nuevoEstado ? "ABIERTO" : "CERRADO"} por ${interaction.user.username}`
            );

            await interaction.editReply({ embeds: [notifEmbed] });

        } catch (error) {
            logger.error(
                `/market ${sub} | user: ${interaction.user.id} | modalidad: ${modalityName}`,
                error
            );
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xE74C3C).setTitle("Algo salió mal")
                    .setDescription("No se pudo actualizar el estado del mercado. El equipo técnico fue notificado.")],
            });
        }
    },
};