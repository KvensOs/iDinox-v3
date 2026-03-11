"use strict";

import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    EmbedBuilder,
    MessageFlags,
    GuildMember,
} from "discord.js";

import { Op }          from "sequelize";
import { Modality, ModalitySettings, DEFAULT_SETTINGS } from "../database/models/Modality.js";
import { Season }      from "../database/models/Season.js";
import { Team }        from "../database/models/Team.js";
import { Player }      from "../database/models/Player.js";
import { Participant } from "../database/models/Participant.js";
import { Competition } from "../database/models/Competition.js";
import { Award }       from "../database/models/Award.js";
import { AwardWinner } from "../database/models/AwardWinner.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";
import { isModalityAdmin, DENIED_EMBED } from "../utils/permissions.js";
import { logger } from "../utils/logger.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const resolveSettings = (raw: Partial<ModalitySettings> | null): ModalitySettings =>
    ({ ...DEFAULT_SETTINGS, ...raw });

const err = (desc: string) =>
    new EmbedBuilder().setColor(0xE74C3C).setDescription(desc);

const warn = (desc: string) =>
    new EmbedBuilder().setColor(0xF1C40F).setDescription(desc);

const ok = (title: string, desc: string) =>
    new EmbedBuilder().setColor(0x57F287).setTitle(title).setDescription(desc)
        .setTimestamp();

/** Devuelve la temporada activa o null. */
async function getActiveSeason(modalityId: number): Promise<Season | null> {
    return Season.findOne({ where: { modalityId, isActive: true } });
}

/**
 * Busca un Award por ID verificando que pertenezca a la modalidad indicada
 * (a través de su Season → modalityId).
 */
async function findAward(awardId: number, modalityId: number): Promise<Award | null> {
    const award = await Award.findByPk(awardId, {
        include: [{ model: Season, as: "season", required: true }],
    }) as (Award & { season: Season }) | null;

    if (!award) return null;
    if (award.season.modalityId !== modalityId) return null;
    return award;
}

/** Autocomplete: equipos con al menos un Participant activo en la temporada. */
async function respondTeams(
    interaction: AutocompleteInteraction,
    season: Season,
    modality: Modality,
    query: string,
): Promise<void> {
    const activeTeamIds = await Participant.findAll({
        attributes: ["teamId"],
        where: { seasonId: season.id, modalityId: modality.id, isActive: true, teamId: { [Op.not]: null } },
        group: ["teamId"],
    }).then(rows => rows.map(r => r.teamId).filter((id): id is number => id !== null));

    if (!activeTeamIds.length) return interaction.respond([]);

    const teams = await Team.findAll({
        where: {
            id: { [Op.in]: activeTeamIds },
            isActive: true,
            ...(query ? { [Op.or]: [{ name: { [Op.like]: `%${query}%` } }, { abbreviation: { [Op.like]: `%${query}%` } }] } : {}),
        },
        limit: 25,
    });

    return interaction.respond(teams.map(t => ({ name: `[${t.abbreviation}] ${t.name}`, value: String(t.id) })));
}

/** Autocomplete: awards de la temporada activa de la modalidad. */
async function respondAwards(
    interaction: AutocompleteInteraction,
    modality: Modality,
    query: string,
): Promise<void> {
    const season = await getActiveSeason(modality.id);
    if (!season) return interaction.respond([]);

    const awards = await Award.findAll({
        where: {
            seasonId: season.id,
            ...(query ? { name: { [Op.like]: `%${query}%` } } : {}),
        },
        limit: 25,
    });

    return interaction.respond(
        awards.map(a => ({
            name:  `${a.type === "team" ? "🏆" : "🎖️"} ${a.name}`,
            value: String(a.id),
        }))
    );
}

// ─── Subcomandos ──────────────────────────────────────────────────────────────

async function handleAdd(interaction: ChatInputCommandInteraction, modality: Modality): Promise<void> {
    const tipo          = interaction.options.getString("tipo",    true) as "team" | "individual";
    const nombre        = interaction.options.getString("nombre",  true).trim();
    const equipoIdRaw   = interaction.options.getString("equipo")  ?? null;
    const jugadorUser   = interaction.options.getUser("jugador")   ?? null;
    const competenciaId = interaction.options.getString("competencia") ?? null;
    const notas         = interaction.options.getString("notas")   ?? null;

    if (tipo === "team" && !equipoIdRaw) {
        return void interaction.editReply({ embeds: [err("Para un premio de **equipo** debes indicar el parámetro `equipo`.")] });
    }
    if (tipo === "individual" && !jugadorUser) {
        return void interaction.editReply({ embeds: [err("Para un premio **individual** debes indicar el parámetro `jugador`.")] });
    }

    const season = await getActiveSeason(modality.id);
    if (!season) {
        return void interaction.editReply({ embeds: [err(`No hay temporada activa en **${modality.displayName}**.`)] });
    }

    // Competencia opcional
    let competition: Competition | null = null;
    if (competenciaId) {
        competition = await Competition.findOne({ where: { id: Number(competenciaId), seasonId: season.id } });
        if (!competition) {
            return void interaction.editReply({ embeds: [err("La competencia no existe o no pertenece a esta temporada.")] });
        }
    }

    // Nombre único
    const existing = await Award.findOne({ where: { seasonId: season.id, name: nombre } });
    if (existing) {
        return void interaction.editReply({
            embeds: [warn(`Ya existe un premio **"${nombre}"** en la temporada \`${season.name}\`.`)],
        });
    }

    const award = await Award.create({
        name:          nombre,
        type:          tipo,
        seasonId:      season.id,
        competitionId: competition?.id ?? null,
        notes:         notas,
    });

    // ── TEAM ──────────────────────────────────────────────────────────────────
    if (tipo === "team") {
        const team = await Team.findOne({ where: { id: Number(equipoIdRaw), isActive: true, modalityId: modality.id } });
        if (!team) {
            await award.destroy();
            return void interaction.editReply({ embeds: [err("El equipo no existe o no pertenece a esta modalidad.")] });
        }

        await AwardWinner.create({ awardId: award.id, teamId: team.id });

        const participants = await Participant.findAll({
            where: { teamId: team.id, seasonId: season.id, modalityId: modality.id, isActive: true },
            include: [{ model: Player, as: "player", required: true }],
        }) as (Participant & { player: Player })[];

        if (participants.length) {
            await AwardWinner.bulkCreate(
                participants.map(p => ({ awardId: award.id, playerId: p.player.id, teamId: null })),
                { ignoreDuplicates: true },
            );
        }

        logger.success(`/league-trophy add | TEAM | "${nombre}" → ${team.name} | ${season.name} | ${modality.displayName} | ${interaction.user.username}`);

        const compLine  = competition ? `\n📋 Competencia: \`${competition.name}\`` : "";
        const notasLine = notas       ? `\n📝 ${notas}` : "";

        return void interaction.editReply({
            embeds: [
                ok("🏆 Premio de equipo registrado",
                    `**${nombre}** otorgado a **${team.name}**\n` +
                    `🗓️ Temporada: \`${season.name}\` · \`${modality.displayName}\`` +
                    compLine + notasLine
                ).addFields({
                    name:  `Jugadores incluidos (${participants.length})`,
                    value: participants.length
                        ? participants.map(p => `· <@${p.player.discordId}>`).join("\n")
                        : "_Sin jugadores activos registrados._",
                })
                .setFooter({ text: `Por ${interaction.user.username} · iDinox v3` }),
            ],
        });
    }

    // ── INDIVIDUAL ────────────────────────────────────────────────────────────
    const player = await Player.findOne({ where: { discordId: jugadorUser!.id } });
    if (!player) {
        await award.destroy();
        return void interaction.editReply({ embeds: [err(`**${jugadorUser!.username}** no está registrado en iDinox.`)] });
    }

    const participant = await Participant.findOne({
        where: { playerId: player.id, seasonId: season.id, modalityId: modality.id },
    });
    if (!participant) {
        await award.destroy();
        return void interaction.editReply({
            embeds: [err(`<@${jugadorUser!.id}> no tiene ficha en **${modality.displayName}** · \`${season.name}\`.`)],
        });
    }

    await AwardWinner.create({ awardId: award.id, playerId: player.id });

    logger.success(`/league-trophy add | INDIVIDUAL | "${nombre}" → ${player.username} | ${season.name} | ${modality.displayName} | ${interaction.user.username}`);

    const compLine  = competition ? `\n📋 Competencia: \`${competition.name}\`` : "";
    const notasLine = notas       ? `\n📝 ${notas}` : "";

    return void interaction.editReply({
        embeds: [
            ok("🎖️ Premio individual registrado",
                `**${nombre}** otorgado a <@${jugadorUser!.id}>\n` +
                `🗓️ Temporada: \`${season.name}\` · \`${modality.displayName}\`` +
                compLine + notasLine
            )
            .setThumbnail(jugadorUser!.displayAvatarURL({ size: 256 }))
            .setFooter({ text: `Por ${interaction.user.username} · iDinox v3` }),
        ],
    });
}

async function handleEdit(interaction: ChatInputCommandInteraction, modality: Modality): Promise<void> {
    const awardIdRaw    = interaction.options.getString("premio",      true);
    const nuevoNombre   = interaction.options.getString("nuevo_nombre") ?? null;
    const nuevasNotas   = interaction.options.getString("notas")        ?? null;
    const competenciaId = interaction.options.getString("competencia")  ?? null;

    if (!nuevoNombre && nuevasNotas === null && competenciaId === null) {
        return void interaction.editReply({
            embeds: [warn("Indica al menos un campo a editar: `nuevo_nombre`, `notas` o `competencia`.")],
        });
    }

    const award = await findAward(Number(awardIdRaw), modality.id);
    if (!award) {
        return void interaction.editReply({ embeds: [err("Premio no encontrado o no pertenece a esta modalidad.")] });
    }

    const season = (award as Award & { season: Season }).season;

    // Competencia
    let competition: Competition | null = null;
    if (competenciaId) {
        competition = await Competition.findOne({ where: { id: Number(competenciaId), seasonId: season.id } });
        if (!competition) {
            return void interaction.editReply({ embeds: [err("La competencia no existe o no pertenece a la temporada del premio.")] });
        }
    }

    // Nombre único si cambia
    if (nuevoNombre && nuevoNombre !== award.name) {
        const conflict = await Award.findOne({ where: { seasonId: season.id, name: nuevoNombre } });
        if (conflict) {
            return void interaction.editReply({
                embeds: [warn(`Ya existe un premio **"${nuevoNombre}"** en la temporada \`${season.name}\`.`)],
            });
        }
        award.name = nuevoNombre.trim();
    }

    if (nuevasNotas  !== null) award.notes         = nuevasNotas.trim() || null;
    if (competenciaId !== null) award.competitionId = competition?.id ?? null;

    await award.save();

    logger.success(`/league-trophy edit | #${award.id} "${award.name}" | ${modality.displayName} | ${interaction.user.username}`);

    return void interaction.editReply({
        embeds: [
            ok("✏️ Premio actualizado",
                `**${award.name}**\n🗓️ Temporada: \`${season.name}\` · \`${modality.displayName}\``
            )
            .setFooter({ text: `Por ${interaction.user.username} · iDinox v3` }),
        ],
    });
}

async function handleDelete(interaction: ChatInputCommandInteraction, modality: Modality): Promise<void> {
    const awardIdRaw = interaction.options.getString("premio", true);

    const award = await findAward(Number(awardIdRaw), modality.id) as (Award & { season: Season }) | null;
    if (!award) {
        return void interaction.editReply({ embeds: [err("Premio no encontrado o no pertenece a esta modalidad.")] });
    }

    const season    = award.season;
    const nombre    = award.name;
    const winnersN  = await AwardWinner.count({ where: { awardId: award.id } });

    // CASCADE en DB elimina los AwardWinner automáticamente
    await award.destroy();

    logger.success(`/league-trophy delete | #${award.id} "${nombre}" (${winnersN} winners) | ${season.name} | ${modality.displayName} | ${interaction.user.username}`);

    return void interaction.editReply({
        embeds: [
            ok("🗑️ Premio eliminado",
                `**"${nombre}"** eliminado junto con \`${winnersN}\` registro(s) de ganadores.\n` +
                `🗓️ Temporada: \`${season.name}\` · \`${modality.displayName}\``
            )
            .setFooter({ text: `Por ${interaction.user.username} · iDinox v3` }),
        ],
    });
}

// ─── Comando ──────────────────────────────────────────────────────────────────

export default {
    category: "📊 Carrera & Estadísticas",
    emoji:    "🏆",
    usage:    "/league-trophy add | edit | delete",

    data: new SlashCommandBuilder()
        .setName("league-trophy")
        .setDescription("Gestiona premios de temporada.")
        .setDMPermission(false)

        // ── add ───────────────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName("add")
                .setDescription("Registra un nuevo premio en la temporada activa.")
                .addStringOption(opt =>
                    opt.setName("modalidad").setDescription("Modalidad.").setRequired(true).setAutocomplete(true)
                )
                .addStringOption(opt =>
                    opt.setName("tipo").setDescription("Tipo de premio.").setRequired(true)
                        .addChoices(
                            { name: "🏆  Equipo",      value: "team"       },
                            { name: "🎖️  Individual",  value: "individual" },
                        )
                )
                .addStringOption(opt =>
                    opt.setName("nombre").setDescription("Nombre del premio.").setRequired(true).setMaxLength(120)
                )
                .addStringOption(opt =>
                    opt.setName("equipo").setDescription("Equipo ganador (requerido si tipo = equipo).").setRequired(false).setAutocomplete(true)
                )
                .addUserOption(opt =>
                    opt.setName("jugador").setDescription("Jugador ganador (requerido si tipo = individual).").setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName("competencia").setDescription("Competencia asociada (opcional).").setRequired(false).setAutocomplete(true)
                )
                .addStringOption(opt =>
                    opt.setName("notas").setDescription("Notas adicionales (opcional).").setRequired(false).setMaxLength(500)
                )
        )

        // ── edit ──────────────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName("edit")
                .setDescription("Edita nombre, notas o competencia de un premio existente.")
                .addStringOption(opt =>
                    opt.setName("modalidad").setDescription("Modalidad.").setRequired(true).setAutocomplete(true)
                )
                .addStringOption(opt =>
                    opt.setName("premio").setDescription("Premio a editar.").setRequired(true).setAutocomplete(true)
                )
                .addStringOption(opt =>
                    opt.setName("nuevo_nombre").setDescription("Nuevo nombre del premio.").setRequired(false).setMaxLength(120)
                )
                .addStringOption(opt =>
                    opt.setName("notas").setDescription("Nuevas notas (dejar vacío para eliminar).").setRequired(false).setMaxLength(500)
                )
                .addStringOption(opt =>
                    opt.setName("competencia").setDescription("Nueva competencia asociada.").setRequired(false).setAutocomplete(true)
                )
        )

        // ── delete ────────────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName("delete")
                .setDescription("Elimina un premio y todos sus registros de ganadores.")
                .addStringOption(opt =>
                    opt.setName("modalidad").setDescription("Modalidad.").setRequired(true).setAutocomplete(true)
                )
                .addStringOption(opt =>
                    opt.setName("premio").setDescription("Premio a eliminar.").setRequired(true).setAutocomplete(true)
                )
        ),

    // ─── Autocomplete ──────────────────────────────────────────────────────────

    async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        const focused      = interaction.options.getFocused(true);
        const sub          = interaction.options.getSubcommand(false);
        const modalityName = interaction.options.getString("modalidad");

        if (focused.name === "modalidad") return autocompleteModality(interaction);
        if (!modalityName) return interaction.respond([]);

        const modality = await Modality.findOne({ where: { name: modalityName, isActive: true } });
        if (!modality) return interaction.respond([]);

        const query = focused.value.toLowerCase();

        if (focused.name === "premio") {
            return respondAwards(interaction, modality, query);
        }

        if (focused.name === "equipo" && sub === "add") {
            const season = await getActiveSeason(modality.id);
            if (!season) return interaction.respond([]);
            return respondTeams(interaction, season, modality, query);
        }

        if (focused.name === "competencia") {
            const season = sub === "add"
                ? await getActiveSeason(modality.id)
                : await (async () => {
                    // En edit, la competencia debe pertenecer a la temporada del premio seleccionado
                    const awardIdRaw = interaction.options.getString("premio");
                    if (!awardIdRaw) return getActiveSeason(modality.id);
                    const award = await findAward(Number(awardIdRaw), modality.id) as (Award & { season: Season }) | null;
                    return award?.season ?? null;
                })();

            if (!season) return interaction.respond([]);

            const competitions = await Competition.findAll({
                where: { seasonId: season.id, ...(query ? { name: { [Op.like]: `%${query}%` } } : {}) },
                limit: 25,
            });
            return interaction.respond(competitions.map(c => ({ name: c.name, value: String(c.id) })));
        }
    },

    // ─── Execute ───────────────────────────────────────────────────────────────

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const sub          = interaction.options.getSubcommand() as "add" | "edit" | "delete";
        const modalityName = interaction.options.getString("modalidad", true);
        const member       = interaction.member as GuildMember | null;

        try {
            const modality = await Modality.findOne({ where: { name: modalityName, isActive: true } });
            if (!modality) {
                return void interaction.editReply({ embeds: [err("Modalidad no encontrada o inactiva.")] });
            }

            const settings = resolveSettings(modality.settings);
            if (!member || !isModalityAdmin(member, interaction.client, settings)) {
                return void interaction.editReply({ embeds: [new EmbedBuilder(DENIED_EMBED)] });
            }

            switch (sub) {
                case "add":    return void await handleAdd(interaction, modality);
                case "edit":   return void await handleEdit(interaction, modality);
                case "delete": return void await handleDelete(interaction, modality);
            }

        } catch (error) {
            logger.error(`/league-trophy ${sub} | user: ${interaction.user.id} | modalidad: ${modalityName}`, error);
            return void interaction.editReply({
                embeds: [err("No se pudo completar la operación. El equipo técnico fue notificado.")],
            });
        }
    },
};