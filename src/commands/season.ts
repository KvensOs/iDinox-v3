"use strict";

import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    EmbedBuilder,
    MessageFlags,
    GuildMember,
} from "discord.js";

import { promises as fs } from "fs";
import * as path          from "path";
import { fileURLToPath }  from "url";
import { join, dirname }  from "node:path";
import { Op }             from "sequelize";

import { sequelize }   from "../core/database.js";
import { Modality }    from "../database/models/Modality.js";
import { Season }      from "../database/models/Season.js";
import { Competition } from "../database/models/Competition.js";
import { Participant } from "../database/models/Participant.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";
import { isAdmin, DENIED_EMBED } from "../utils/permissions.js";
import { logger } from "../utils/logger.js";

// ─── Constantes ───────────────────────────────────────────────────────────────

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const BACKUPS_DIR   = path.join(__dirname, "../../backups");
const SEASON_SECRET = process.env.SEASON_SECRET ?? "";

// Mismo path que core/database.ts → join(__dirname, "../../database.sqlite")
const DB_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../database.sqlite");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const err  = (desc: string) => new EmbedBuilder().setColor(0xE74C3C).setDescription(desc);
const warn = (desc: string) => new EmbedBuilder().setColor(0xF1C40F).setDescription(desc);
const ok   = (title: string, desc: string) =>
    new EmbedBuilder().setColor(0x57F287).setTitle(title).setDescription(desc).setTimestamp();

/**
 * Copia el archivo SQLite a backups/ antes de cualquier operación destructiva.
 * Si el backup falla, lanza un error — la operación se cancela completamente.
 */
async function backupDatabase(label: string): Promise<string> {
    await fs.mkdir(BACKUPS_DIR, { recursive: true });

    const ts       = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `backup_${label}_${ts}.sqlite`;
    const dest     = path.join(BACKUPS_DIR, filename);

    // Cualquier error aquí (permisos, disco lleno, etc.) se propaga hacia arriba
    // y cancela la operación antes de tocar la DB.
    await fs.copyFile(DB_PATH, dest);

    logger.success(`season backup | ${filename}`);
    return filename;
}

// ─── Subcomandos ──────────────────────────────────────────────────────────────

async function handleNew(
    interaction: ChatInputCommandInteraction,
    modality: Modality,
): Promise<void> {
    const nombre    = interaction.options.getString("nombre",    true).trim();
    const clave     = interaction.options.getString("clave",     true);
    const confirmar = interaction.options.getString("confirmar", false)?.trim() ?? null;

    // ── Clave de seguridad ─────────────────────────────────────────────────
    if (!SEASON_SECRET) {
        return void interaction.editReply({
            embeds: [err("La variable `SEASON_SECRET` no está configurada en el servidor.")],
        });
    }
    if (clave !== SEASON_SECRET) {
        return void interaction.editReply({
            embeds: [err("Clave incorrecta.")],
        });
    }

    // ── Verificar nombre único ─────────────────────────────────────────────
    const nameConflict = await Season.findOne({
        where: { name: nombre, modalityId: modality.id },
    });
    if (nameConflict) {
        return void interaction.editReply({
            embeds: [warn(`Ya existe una temporada llamada **"${nombre}"** en **${modality.displayName}**.`)],
        });
    }

    // ── Temporada activa a cerrar ──────────────────────────────────────────
    const activeSeason = await Season.findOne({
        where: { modalityId: modality.id, isActive: true },
    });

    if (activeSeason) {
        // Exigir confirmación explícita del nombre de la temporada que se cierra
        if (!confirmar) {
            return void interaction.editReply({
                embeds: [warn(
                    `Hay una temporada activa: **"${activeSeason.name}"**.\n` +
                    `Para continuar, incluye \`confirmar: ${activeSeason.name}\` en el comando.`,
                )],
            });
        }
        if (confirmar !== activeSeason.name) {
            return void interaction.editReply({
                embeds: [err(
                    `El nombre de confirmación no coincide.\n` +
                    `Esperado: \`${activeSeason.name}\`  ·  Recibido: \`${confirmar}\``,
                )],
            });
        }
    }

    // ── Backup ────────────────────────────────────────────────────────────
    const backupFile = await backupDatabase(`before_new_${nombre.replace(/\s+/g, "_")}`);

    // ── Cerrar temporada anterior y crear la nueva (transacción) ──────────
    let newSeason: Season;
    let carryCount = 0;

    await sequelize.transaction(async (t) => {
        let fromSeasonId: number | null = null;

        if (activeSeason) {
            await Competition.update(
                { isActive: false },
                { where: { seasonId: activeSeason.id, isActive: true }, transaction: t },
            );
            activeSeason.isActive = false;
            activeSeason.endedAt  = new Date();
            await activeSeason.save({ transaction: t });
            fromSeasonId = activeSeason.id;
        }

        newSeason = await Season.create(
            { name: nombre, modalityId: modality.id, isActive: true, startedAt: new Date() },
            { transaction: t },
        );

        if (fromSeasonId !== null) {
            const sourceParticipants = await Participant.findAll({
                where: {
                    seasonId:   fromSeasonId,
                    modalityId: modality.id,
                    teamId:     { [Op.not]: null },
                },
                transaction: t,
            });

            if (sourceParticipants.length) {
                const rows = sourceParticipants.map(p => ({
                    playerId:   p.playerId,
                    teamId:     p.teamId,
                    seasonId:   newSeason.id,
                    modalityId: modality.id,
                    position:   p.position,
                    isActive:   true,
                }));

                await Participant.bulkCreate(rows, {
                    ignoreDuplicates: true,
                    hooks:            false,
                    transaction:      t,
                });

                carryCount = rows.length;
            }
        }
    });

    logger.success(
        `/season new | "${nombre}" | ${modality.displayName} | carry: ${carryCount} participants | backup: ${backupFile || "N/A"} | por ${interaction.user.username}`,
    );

    const lines: string[] = [
        `Modalidad: \`${modality.displayName}\``,
        activeSeason ? `Temporada cerrada: \`${activeSeason.name}\`` : "",
        `Temporada nueva: \`${nombre}\``,
        carryCount ? `Plantillas copiadas: \`${carryCount}\` participantes` : "_Sin plantillas anteriores_",
        backupFile ? `Backup: \`${backupFile}\`` : "",
    ].filter(Boolean);

    return void interaction.editReply({
        embeds: [ok("✅ Nueva temporada iniciada", lines.join("\n"))
            .setFooter({ text: `Por ${interaction.user.username} · iDinox v3` })],
    });
}

async function handleEnd(
    interaction: ChatInputCommandInteraction,
    modality: Modality,
): Promise<void> {
    const clave     = interaction.options.getString("clave",     true);
    const confirmar = interaction.options.getString("confirmar", true).trim();

    // ── Clave ─────────────────────────────────────────────────────────────
    if (!SEASON_SECRET) {
        return void interaction.editReply({
            embeds: [err("La variable `SEASON_SECRET` no está configurada en el servidor.")],
        });
    }
    if (clave !== SEASON_SECRET) {
        return void interaction.editReply({ embeds: [err("Clave incorrecta.")] });
    }

    const season = await Season.findOne({ where: { modalityId: modality.id, isActive: true } });
    if (!season) {
        return void interaction.editReply({
            embeds: [warn(`No hay temporada activa en **${modality.displayName}**.`)],
        });
    }

    // ── Confirmación ──────────────────────────────────────────────────────
    if (confirmar !== season.name) {
        return void interaction.editReply({
            embeds: [err(
                `El nombre de confirmación no coincide.\n` +
                `Esperado: \`${season.name}\`  ·  Recibido: \`${confirmar}\``,
            )],
        });
    }

    // ── Backup ────────────────────────────────────────────────────────────
    const backupFile = await backupDatabase(`before_end_${season.name.replace(/\s+/g, "_")}`);

    // ── Cerrar ────────────────────────────────────────────────────────────
    const [compsActivas] = await Promise.all([
        Competition.count({ where: { seasonId: season.id, isActive: true } }),
    ]);

    await sequelize.transaction(async (t) => {
        await Competition.update(
            { isActive: false },
            { where: { seasonId: season.id, isActive: true }, transaction: t },
        );
        season.isActive = false;
        season.endedAt  = new Date();
        await season.save({ transaction: t });
    });

    logger.success(
        `/season end | "${season.name}" | ${modality.displayName} | ${compsActivas} comps cerradas | backup: ${backupFile || "N/A"} | por ${interaction.user.username}`,
    );

    const lines = [
        `Modalidad: \`${modality.displayName}\``,
        `Temporada cerrada: \`${season.name}\``,
        compsActivas ? `Competencias cerradas: \`${compsActivas}\`` : "_Sin competencias activas_",
        backupFile ? `Backup: \`${backupFile}\`` : "",
    ].filter(Boolean);

    return void interaction.editReply({
        embeds: [ok("🔒 Temporada cerrada", lines.join("\n"))
            .setFooter({ text: `Por ${interaction.user.username} · iDinox v3` })],
    });
}

async function handleEdit(
    interaction: ChatInputCommandInteraction,
    modality: Modality,
): Promise<void> {
    const seasonIdRaw = interaction.options.getString("temporada", true);
    const nuevoNombre = interaction.options.getString("nuevo_nombre", true).trim();

    const season = await Season.findOne({
        where: { id: Number(seasonIdRaw), modalityId: modality.id },
    });
    if (!season) {
        return void interaction.editReply({ embeds: [err("Temporada no encontrada.")] });
    }

    if (nuevoNombre === season.name) {
        return void interaction.editReply({
            embeds: [warn("El nombre nuevo es igual al actual. No hay cambios.")],
        });
    }

    const conflict = await Season.findOne({
        where: { name: nuevoNombre, modalityId: modality.id },
    });
    if (conflict) {
        return void interaction.editReply({
            embeds: [warn(`Ya existe una temporada llamada **"${nuevoNombre}"** en **${modality.displayName}**.`)],
        });
    }

    const nombreAnterior = season.name;
    season.name = nuevoNombre;
    await season.save();

    logger.success(`/season edit | "${nombreAnterior}" → "${nuevoNombre}" | ${modality.displayName} | ${interaction.user.username}`);

    return void interaction.editReply({
        embeds: [ok("✏️ Temporada actualizada",
            `**\`${nombreAnterior}\`** → **\`${nuevoNombre}\`**\n` +
            `Modalidad: \`${modality.displayName}\``
        ).setFooter({ text: `Por ${interaction.user.username} · iDinox v3` })],
    });
}

async function handleInfo(
    interaction: ChatInputCommandInteraction,
    modality: Modality,
): Promise<void> {
    const seasonIdRaw = interaction.options.getString("temporada");

    const season = seasonIdRaw
        ? await Season.findOne({ where: { id: Number(seasonIdRaw), modalityId: modality.id } })
        : await Season.findOne({ where: { modalityId: modality.id, isActive: true } });

    if (!season) {
        return void interaction.editReply({
            embeds: [warn(
                seasonIdRaw
                    ? "Temporada no encontrada."
                    : `No hay temporada activa en **${modality.displayName}**.`,
            )],
        });
    }

    const [competitions, participantCount, teamCount] = await Promise.all([
        Competition.findAll({ where: { seasonId: season.id }, order: [["name", "ASC"]] }),
        Participant.count({ where: { seasonId: season.id } }),
        Participant.count({
            where: { seasonId: season.id, teamId: { [Op.not]: null } },
            distinct: true,
            col: "teamId",
        }),
    ]);

    const activeComps   = competitions.filter(c => c.isActive);
    const inactiveComps = competitions.filter(c => !c.isActive);

    const startStr = season.startedAt
        ? `<t:${Math.floor(new Date(season.startedAt).getTime() / 1000)}:D>`
        : "_Desconocida_";
    const endStr = season.endedAt
        ? `<t:${Math.floor(new Date(season.endedAt).getTime() / 1000)}:D>`
        : "_En curso_";

    const compLines = [
        ...(activeComps.length   ? activeComps.map(c   => `· 🟢 \`${c.name}\` _(${c.type})_`) : []),
        ...(inactiveComps.length ? inactiveComps.map(c => `· 🔴 \`${c.name}\` _(${c.type})_`) : []),
    ].join("\n") || "_Sin competencias_";

    const embed = new EmbedBuilder()
        .setColor(season.isActive ? 0x57F287 : 0x99AAB5)
        .setAuthor({ name: `${modality.displayName}  ·  ${season.name}` })
        .setTitle(season.isActive ? "🟢 Temporada activa" : "🔴 Temporada cerrada")
        .addFields(
            { name: "Inicio",        value: startStr,                     inline: true },
            { name: "Fin",           value: endStr,                       inline: true },
            { name: "Participantes", value: `\`${participantCount}\``,    inline: true },
            { name: "Equipos",       value: `\`${teamCount}\``,           inline: true },
            { name: `Competencias (${competitions.length})`, value: compLines },
        )
        .setFooter({ text: "iDinox v3" })
        .setTimestamp();

    return void interaction.editReply({ embeds: [embed] });
}

// ─── Comando ──────────────────────────────────────────────────────────────────

export default {
    category: "⚙️ Administración",
    emoji:    "📅",
    usage:    "/season new | end | edit | info",

    data: new SlashCommandBuilder()
        .setName("season")
        .setDescription("Gestión del ciclo de vida de temporadas.")
        .setDMPermission(false)

        // ── new ───────────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName("new")
                .setDescription("Crea una nueva temporada y cierra la anterior (si existe).")
                .addStringOption(opt =>
                    opt.setName("modalidad").setDescription("Modalidad.").setRequired(true).setAutocomplete(true)
                )
                .addStringOption(opt =>
                    opt.setName("nombre").setDescription("Nombre de la nueva temporada.").setRequired(true).setMaxLength(120)
                )
                .addStringOption(opt =>
                    opt.setName("clave").setDescription("Clave de seguridad (SEASON_SECRET).").setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName("confirmar")
                        .setDescription("Escribe el nombre exacto de la temporada activa para confirmar su cierre.")
                        .setRequired(false)
                )
        )

        // ── end ───────────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName("end")
                .setDescription("Cierra la temporada activa sin crear una nueva.")
                .addStringOption(opt =>
                    opt.setName("modalidad").setDescription("Modalidad.").setRequired(true).setAutocomplete(true)
                )
                .addStringOption(opt =>
                    opt.setName("clave").setDescription("Clave de seguridad (SEASON_SECRET).").setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName("confirmar")
                        .setDescription("Escribe el nombre exacto de la temporada activa para confirmar.")
                        .setRequired(true)
                )
        )

        // ── edit ──────────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName("edit")
                .setDescription("Edita el nombre de una temporada.")
                .addStringOption(opt =>
                    opt.setName("modalidad").setDescription("Modalidad.").setRequired(true).setAutocomplete(true)
                )
                .addStringOption(opt =>
                    opt.setName("temporada").setDescription("Temporada a editar.").setRequired(true).setAutocomplete(true)
                )
                .addStringOption(opt =>
                    opt.setName("nuevo_nombre").setDescription("Nuevo nombre.").setRequired(true).setMaxLength(120)
                )
        )

        // ── info ──────────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName("info")
                .setDescription("Muestra información de una temporada.")
                .addStringOption(opt =>
                    opt.setName("modalidad").setDescription("Modalidad.").setRequired(true).setAutocomplete(true)
                )
                .addStringOption(opt =>
                    opt.setName("temporada")
                        .setDescription("Temporada a consultar (por defecto: la activa).")
                        .setRequired(false)
                        .setAutocomplete(true)
                )
        ),

    // ─── Autocomplete ──────────────────────────────────────────────────────────

    async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        const focused      = interaction.options.getFocused(true);
        const modalityName = interaction.options.getString("modalidad");

        if (focused.name === "modalidad") return autocompleteModality(interaction);
        if (!modalityName) return interaction.respond([]);

        const modality = await Modality.findOne({ where: { name: modalityName, isActive: true } });
        if (!modality) return interaction.respond([]);

        if (focused.name === "temporada") {
            const query   = focused.value.toLowerCase();
            // edit: todas las temporadas | info: todas también (puede consultar históricas)
            const seasons = await Season.findAll({
                where: {
                    modalityId: modality.id,
                    ...(query ? { name: { [Op.like]: `%${query}%` } } : {}),
                },
                order: [["id", "DESC"]],
                limit: 25,
            });

            return interaction.respond(
                seasons.map(s => ({
                    name:  `${s.isActive ? "🟢" : "🔴"} ${s.name}`,
                    value: String(s.id),
                }))
            );
        }
    },

    // ─── Execute ───────────────────────────────────────────────────────────────

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const sub = interaction.options.getSubcommand() as "new" | "end" | "edit" | "info";

        // info es público — el resto requiere isAdmin
        const requiresAdmin = sub !== "info";

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const modalityName = interaction.options.getString("modalidad", true);
        const member       = interaction.member as GuildMember | null;

        try {
            const modality = await Modality.findOne({ where: { name: modalityName, isActive: true } });
            if (!modality) {
                return void interaction.editReply({ embeds: [err("Modalidad no encontrada o inactiva.")] });
            }

            if (requiresAdmin && (!member || !isAdmin(member, interaction.client))) {
                return void interaction.editReply({ embeds: [new EmbedBuilder(DENIED_EMBED)] });
            }

            switch (sub) {
                case "new":  return void await handleNew(interaction, modality);
                case "end":  return void await handleEnd(interaction, modality);
                case "edit": return void await handleEdit(interaction, modality);
                case "info": return void await handleInfo(interaction, modality);
            }

        } catch (error) {
            logger.error(`/season ${sub} | user: ${interaction.user.id} | modalidad: ${modalityName}`, error);
            return void interaction.editReply({
                embeds: [err("No se pudo completar la operación. El equipo técnico fue notificado.")],
            });
        }
    },
};