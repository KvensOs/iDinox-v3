import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    ChannelType,
    GuildMember,
    AutocompleteInteraction,
} from "discord.js";

import { Modality, ModalitySettings, DEFAULT_SETTINGS } from "../database/models/Modality.js";
import { isAdmin, isModalityAdmin, DENIED_EMBED } from "../utils/permissions.js";
import { logger } from "../utils/logger.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";

const FIELDS: {
    key: keyof Omit<ModalitySettings, "marketOpen">;
    label: string;
    type: "role" | "channel";
}[] = [
        { key: "rol_admin", label: "Rol — Administrador de Modalidad", type: "role" },
        { key: "rol_dt", label: "Rol — Director Técnico", type: "role" },
        { key: "rol_sub_dt", label: "Rol — Sub-Director Técnico", type: "role" },
        { key: "canal_mercado_fichajes", label: "Canal — Fichajes", type: "channel" },
        { key: "canal_mercado_bajas", label: "Canal — Bajas", type: "channel" },
        { key: "canal_resultados", label: "Canal — Resultados", type: "channel" },
        { key: "canal_logs", label: "Canal — Logs internos", type: "channel" },
    ];


function resolveSettings(raw: Partial<ModalitySettings> | null): ModalitySettings {
    return { ...DEFAULT_SETTINGS, ...raw };
}

function formatValue(key: keyof ModalitySettings, settings: ModalitySettings): string {
    const val = settings[key];
    if (key === "marketOpen") return val ? "✅ Abierto" : "❌ Cerrado";
    if (!val) return "`Sin configurar`";
    const field = FIELDS.find(f => f.key === key);
    if (!field) return `\`${val}\``;
    return field.type === "role" ? `<@&${val}>` : `<#${val}>`;
}

function buildOverviewEmbed(modality: Modality, settings: ModalitySettings): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`⚙️ Configuración · iDinox ${modality.displayName}`)
        .setDescription("Estado actual de la configuración de esta modalidad.")
        .addFields(
            ...FIELDS.map(f => ({
                name: f.label,
                value: formatValue(f.key, settings),
                inline: true,
            })),
            { name: "Mercado", value: settings.marketOpen ? "✅ Abierto" : "❌ Cerrado", inline: true }
        )
        .setFooter({ text: `iDinox v3 · Modalidad ${modality.displayName}` })
        .setTimestamp();
}

export default {
    category: "⚙️ Administración",
    emoji: "⚙️",
    usage: "/setup [modalidad] [campo] [valor]",

    data: new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Configura los roles y canales de una modalidad de iDinox.")
        .setDMPermission(false)
        .addStringOption(opt =>
            opt.setName("modalidad")
                .setDescription("Modalidad a configurar.")
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(opt =>
            opt.setName("campo")
                .setDescription("Campo a configurar. Omítelo para ver el estado actual.")
                .setRequired(false)
                .addChoices(
                    { name: "Rol — Administrador de Modalidad", value: "rol_admin" },
                    { name: "Rol — Director Técnico", value: "rol_dt" },
                    { name: "Rol — Sub-Director Técnico", value: "rol_sub_dt" },
                    { name: "Canal — Fichajes", value: "canal_mercado_fichajes" },
                    { name: "Canal — Bajas", value: "canal_mercado_bajas" },
                    { name: "Canal — Resultados", value: "canal_resultados" },
                    { name: "Canal — Logs internos", value: "canal_logs" },
                )
        )
        .addRoleOption(opt =>
            opt.setName("rol")
                .setDescription("Rol a asignar (si el campo es un rol).")
                .setRequired(false)
        )
        .addChannelOption(opt =>
            opt.setName("canal")
                .setDescription("Canal a asignar (si el campo es un canal).")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        ),

    async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        await autocompleteModality(interaction);
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const member = interaction.member as GuildMember | null;
        const modalityName = interaction.options.getString("modalidad", true);
        const campo = interaction.options.getString("campo") as keyof Omit<ModalitySettings, "marketOpen"> | null;
        const rol = interaction.options.getRole("rol");
        const canal = interaction.options.getChannel("canal");

        try {
            const modality = await Modality.findOne({ where: { name: modalityName } });

            if (!modality) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xE74C3C)
                            .setTitle("Modalidad no encontrada")
                            .setDescription(`La modalidad **${modalityName.toUpperCase()}** no existe en el sistema.`),
                    ],
                });
                return;
            }

            const settings = resolveSettings(modality.settings);

            const campoEsRolAdmin = campo === "rol_admin";
            const tienePermiso = campoEsRolAdmin
                ? (member && isAdmin(member, interaction.client))
                : (member && isModalityAdmin(member, interaction.client, settings));

            if (!tienePermiso) {
                await interaction.editReply({ embeds: [new EmbedBuilder(DENIED_EMBED)] });
                return;
            }

            if (!campo) {
                await interaction.editReply({ embeds: [buildOverviewEmbed(modality, settings)] });
                return;
            }

            const fieldMeta = FIELDS.find(f => f.key === campo);
            if (!fieldMeta) {
                await interaction.editReply({ content: "Campo no reconocido." });
                return;
            }

            if (fieldMeta.type === "role" && !rol) {
                await interaction.editReply({
                    content: "Este campo requiere un **rol**. Usa la opción `rol` al ejecutar el comando.",
                });
                return;
            }

            if (fieldMeta.type === "channel" && !canal) {
                await interaction.editReply({
                    content: "Este campo requiere un **canal**. Usa la opción `canal` al ejecutar el comando.",
                });
                return;
            }

            const newValue = fieldMeta.type === "role" ? rol!.id : canal!.id;
            const oldValue = settings[campo];
            const newSettings: ModalitySettings = { ...settings, [campo]: newValue };

            modality.settings = newSettings;
            modality.changed("settings", true);
            await modality.save();

            logger.success(
                `/setup | ${interaction.user.username} actualizó **${fieldMeta.label}** en ${modality.displayName}`
            );

            const oldDisplay = oldValue
                ? (fieldMeta.type === "role" ? `<@&${oldValue}>` : `<#${oldValue}>`)
                : "`Sin configurar`";
            const newDisplay = fieldMeta.type === "role" ? `<@&${newValue}>` : `<#${newValue}>`;

            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x2ECC71)
                        .setTitle("Configuración actualizada")
                        .setDescription(`**${fieldMeta.label}** actualizado en **iDinox ${modality.displayName}**.`)
                        .addFields(
                            { name: "Antes", value: oldDisplay, inline: true },
                            { name: "Ahora", value: newDisplay, inline: true },
                        )
                        .setFooter({ text: `iDinox v3 · Configurado por ${interaction.user.username}` })
                        .setTimestamp(),
                ],
            });

        } catch (error) {
            logger.error(
                `/setup | user: ${interaction.user.id} | modalidad: ${modalityName} | campo: ${campo}`,
                error
            );
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xE74C3C)
                        .setTitle("Algo salió mal")
                        .setDescription("No se pudo guardar la configuración. El equipo técnico fue notificado."),
                ],
            });
        }
    },
};