import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    EmbedBuilder,
} from "discord.js";

import { Op }          from "sequelize";
import { Modality }    from "../database/models/Modality.js";
import { Season }      from "../database/models/Season.js";
import { Award }       from "../database/models/Award.js";
import { AwardWinner } from "../database/models/AwardWinner.js";
import { Player }      from "../database/models/Player.js";
import { Team }        from "../database/models/Team.js";
import { Competition } from "../database/models/Competition.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";
import { logger }      from "../utils/logger.js";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type AwardWinnerFull = AwardWinner & { player: Player | null; team: Team | null };
type AwardFull       = Award & { winners: AwardWinnerFull[]; competition?: Competition | null };

// ─── Formato ──────────────────────────────────────────────────────────────────

function formatTeamAward(award: AwardFull): string {
    const teamRow = award.winners.find(w => w.teamId !== null);
    const players = award.winners.filter(w => w.playerId !== null && w.teamId === null);

    const teamLine    = teamRow?.team ? `**${teamRow.team.name}**` : "_Equipo desconocido_";
    const compLine    = award.competition ? `  ·  _${award.competition.name}_` : "";
    const playerLines = players.length
        ? players.map(w => `· <@${w.player!.discordId}>`).join("\n")
        : "_Sin jugadores registrados_";

    return `**${award.name}**${compLine}\n${teamLine}\n${playerLines}`;
}

function formatIndivAward(award: AwardFull): string {
    const winner   = award.winners.find(w => w.playerId !== null);
    const compLine = award.competition ? `  ·  _${award.competition.name}_` : "";
    const player   = winner?.player
        ? `<@${winner.player.discordId}>  \`${winner.player.username}\``
        : "_Sin ganador registrado_";

    return `**${award.name}**${compLine}\n${player}`;
}

// ─── Comando ──────────────────────────────────────────────────────────────────

export default {
    category: "📊 Carrera & Estadísticas",
    emoji:    "📜",
    usage:    "/league-history modalidad:[mod] temporada:[temp]",

    data: new SlashCommandBuilder()
        .setName("league-history")
        .setDescription("Palmarés completo de una temporada: títulos y premios individuales.")
        .setDMPermission(false)
        .addStringOption(opt =>
            opt.setName("modalidad")
                .setDescription("Modalidad.")
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(opt =>
            opt.setName("temporada")
                .setDescription("Temporada a consultar.")
                .setRequired(true)
                .setAutocomplete(true)
        ),

    async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
        const focused      = interaction.options.getFocused(true);
        const modalityName = interaction.options.getString("modalidad");

        if (focused.name === "modalidad") return autocompleteModality(interaction);

        if (focused.name === "temporada") {
            if (!modalityName) return interaction.respond([]);

            const modality = await Modality.findOne({ where: { name: modalityName, isActive: true } });
            if (!modality)  return interaction.respond([]);

            const query   = focused.value.toLowerCase();
            const seasons = await Season.findAll({
                where: {
                    modalityId: modality.id,
                    ...(query ? { name: { [Op.like]: `%${query}%` } } : {}),
                },
                order: [["id", "DESC"]],
                limit: 25,
            });

            return interaction.respond(
                seasons.map(s => ({ name: `${s.isActive ? "🟢" : "🔴"} ${s.name}`, value: String(s.id) }))
            );
        }
    },

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply();

        const modalityName = interaction.options.getString("modalidad", true);
        const seasonIdRaw  = interaction.options.getString("temporada", true);

        try {
            const [modality, season] = await Promise.all([
                Modality.findOne({ where: { name: modalityName, isActive: true } }),
                Season.findOne({ where: { id: Number(seasonIdRaw) } }),
            ]);

            if (!modality) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setDescription("Modalidad no encontrada o inactiva.")],
                });
                return;
            }
            if (!season || season.modalityId !== modality.id) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE74C3C).setDescription("Temporada no encontrada.")],
                });
                return;
            }

            const awards = await Award.findAll({
                where:   { seasonId: season.id },
                include: [
                    {
                        model:    AwardWinner,
                        as:       "winners",
                        required: false,
                        include:  [
                            { model: Player, as: "player", required: false },
                            { model: Team,   as: "team",   required: false },
                        ],
                    },
                    { model: Competition, as: "competition", required: false },
                ],
                order: [["name", "ASC"]],
            }) as AwardFull[];

            if (!awards.length) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xE67E22)
                        .setDescription(`No hay premios registrados en **${season.name}** · **${modality.displayName}**.`)],
                });
                return;
            }

            const teamAwards  = awards.filter(a => a.type === "team");
            const indivAwards = awards.filter(a => a.type === "individual");

            const embed = new EmbedBuilder()
                .setColor(0xF1C40F)
                .setAuthor({ name: `${modality.displayName}  ·  ${season.name}` })
                .setTitle("Palmarés")
                .setFooter({ text: "iDinox v3" })
                .setTimestamp();

            if (teamAwards.length) {
                embed.addFields({
                    name:  "🏆 Títulos de equipo",
                    value: teamAwards.map(formatTeamAward).join("\n\n"),
                });
            }

            if (indivAwards.length) {
                embed.addFields({
                    name:  "🎖️ Premios individuales",
                    value: indivAwards.map(formatIndivAward).join("\n\n"),
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error(`/league-history | modalidad: ${modalityName} | temporada: ${seasonIdRaw}`, error);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xE74C3C)
                    .setDescription("No se pudo cargar el palmarés. El equipo técnico fue notificado.")],
            });
        }
    },
};