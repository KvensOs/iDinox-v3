import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  GuildMember,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  AutocompleteInteraction,
} from "discord.js";

import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { Participant, Position } from "../database/models/Participant.js";
import { Player } from "../database/models/Player.js";
import { Team } from "../database/models/Team.js";
import { Season } from "../database/models/Season.js";
import {
  Modality,
  ModalitySettings,
  DEFAULT_SETTINGS,
} from "../database/models/Modality.js";
import { SignOffer } from "../database/models/SignOffer.js";
import { logger } from "../utils/logger.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGOS_DIR = path.join(__dirname, "../../logos");
const FONDO_PATH = path.join(LOGOS_DIR, "fondo_fichajes.png");
const OFFER_TTL_MS = 24 * 60 * 60 * 1_000; // 24 h en ms
const OFFER_TTL_LABEL = "24 horas";

const POSITIONS: { name: string; value: Position }[] = [
  { name: "GK   — Portero", value: "GK" },
  { name: "DEF  — Defensa", value: "DEF" },
  { name: "MID  — Mediocampista", value: "MID" },
  { name: "DFWD — Defensa-Delantero", value: "DFWD" },
  { name: "FWD  — Delantero", value: "FWD" },
];

type ParticipantWithTeam = Participant & { team: Team | null };

const resolveSettings = (
  raw: Partial<ModalitySettings> | null,
): ModalitySettings => ({ ...DEFAULT_SETTINGS, ...raw });

const isDTorSubDT = (member: GuildMember, s: ModalitySettings): boolean =>
  !!(
    (s.rol_dt && member.roles.cache.has(s.rol_dt)) ||
    (s.rol_sub_dt && member.roles.cache.has(s.rol_sub_dt))
  );

const isDT = (member: GuildMember, s: ModalitySettings): boolean =>
  !!(s.rol_dt && member.roles.cache.has(s.rol_dt));

const fileExists = (p: string): Promise<boolean> =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false);

export default {
  category: "💰 Mercado & Fichajes",
  emoji: "✍️",
  usage: "/market sign [modalidad] [jugador] [posicion]",

  data: new SlashCommandBuilder()
    .setName("market-sign")
    .setDescription("Envía una oferta de fichaje a un jugador.")
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt
        .setName("modalidad")
        .setDescription("Modalidad en la que fichas.")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addUserOption((opt) =>
      opt
        .setName("jugador")
        .setDescription("Jugador al que quieres fichar.")
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("posicion")
        .setDescription("Posición asignada (opcional).")
        .addChoices(...POSITIONS),
    ),

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await autocompleteModality(interaction);
  },

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = interaction.member as GuildMember | null;
    const modalityName = interaction.options.getString("modalidad", true);
    const targetUser = interaction.options.getUser("jugador", true);
    const posicion = interaction.options.getString(
      "posicion",
    ) as Position | null;

    if (!member) {
      await interaction.editReply({
        content: "No se pudo verificar tu identidad.",
      });
      return;
    }
    if (targetUser.id === interaction.user.id) {
      await interaction.editReply({
        content: "No puedes enviarte una oferta a ti mismo.",
      });
      return;
    }
    if (targetUser.bot) {
      await interaction.editReply({ content: "No puedes fichar a un bot." });
      return;
    }

    try {
      const modality = await Modality.findOne({
        where: { name: modalityName, isActive: true },
      });
      if (!modality) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("Modalidad no encontrada")
              .setDescription(
                `La modalidad **${modalityName.toUpperCase()}** no existe o no está activa.`,
              ),
          ],
        });
        return;
      }

      const settings = resolveSettings(modality.settings);

      if (!isDTorSubDT(member, settings)) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("Sin permisos")
              .setDescription(
                "Solo los **Directores Técnicos** y **Sub-DT** pueden realizar fichajes.",
              ),
          ],
        });
        return;
      }

      if (!settings.marketOpen) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("Mercado cerrado")
              .setDescription(
                `El mercado de **${modality.displayName}** está cerrado actualmente.`,
              ),
          ],
        });
        return;
      }

      const season = await Season.findOne({
        where: { modalityId: modality.id, isActive: true },
      });
      if (!season) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe67e22)
              .setTitle("Sin temporada activa")
              .setDescription(
                `No hay una temporada activa en **${modality.displayName}**.`,
              ),
          ],
        });
        return;
      }

      const [[dtPlayer], [targetPlayer]] = await Promise.all([
        Player.findOrCreate({
          where: { discordId: interaction.user.id },
          defaults: {
            discordId: interaction.user.id,
            username: interaction.user.username,
            globalName: interaction.user.globalName ?? null,
          },
        }),
        Player.findOrCreate({
          where: { discordId: targetUser.id },
          defaults: {
            discordId: targetUser.id,
            username: targetUser.username,
            globalName: targetUser.globalName ?? null,
          },
        }),
      ]);

      const [dtParticipant, targetParticipant] = await Promise.all([
        Participant.findOne({
          where: {
            playerId: dtPlayer.id,
            seasonId: season.id,
            modalityId: modality.id,
          },
        }),
        Participant.findOne({
          where: {
            playerId: targetPlayer.id,
            seasonId: season.id,
            modalityId: modality.id,
          },
          include: [{ model: Team, as: "team", required: false }],
        }) as Promise<ParticipantWithTeam | null>,
      ]);

      if (!dtParticipant?.teamId) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("Sin equipo")
              .setDescription(
                `No estás asignado a ningún equipo en **${modality.displayName}** esta temporada.`,
              ),
          ],
        });
        return;
      }

      if (targetParticipant?.teamId) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("Jugador no disponible")
              .setDescription(
                `**${targetUser.globalName ?? targetUser.username}** ya pertenece a ` +
                  `**${targetParticipant.team?.name ?? "otro equipo"}** esta temporada.`,
              ),
          ],
        });
        return;
      }

      const [team, plantillaActual, ofertaExistente] = await Promise.all([
        Team.findOne({ where: { id: dtParticipant.teamId, isActive: true } }),
        Participant.count({
          where: {
            teamId: dtParticipant.teamId,
            seasonId: season.id,
            isActive: true,
          },
        }),
        SignOffer.findOne({
          where: {
            targetDiscordId: targetUser.id,
            modalityId: modality.id,
            status: "pending",
          },
        }),
      ]);

      if (!team) {
        await interaction.editReply({
          content: "No se encontró tu equipo en el sistema.",
        });
        return;
      }

      if (plantillaActual >= modality.playersPerTeam) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("Plantilla completa")
              .setDescription(
                `**${team.name}** ya tiene el máximo de jugadores permitidos ` +
                  `(**${plantillaActual}/${modality.playersPerTeam}**).`,
              ),
          ],
        });
        return;
      }

      if (ofertaExistente) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe67e22)
              .setTitle("Oferta ya enviada")
              .setDescription(
                `**${targetUser.globalName ?? targetUser.username}** ya tiene una oferta pendiente ` +
                  `en **${modality.displayName}**.\n` +
                  `Espera a que la acepte, rechace o venza antes de enviar otra.`,
              ),
          ],
        });
        return;
      }

      const canalId = settings.canal_mercado_fichajes;
      if (!canalId) {
        await interaction.editReply({
          content:
            "El canal de fichajes no está configurado. Usa `/setup` para configurarlo.",
        });
        return;
      }

      const canal = interaction.guild?.channels.cache.get(canalId) as
        | TextChannel
        | undefined;
      if (!canal) {
        await interaction.editReply({
          content: "No se encontró el canal de fichajes configurado.",
        });
        return;
      }

      const resolvedLogoFilename = team.logoPath
        ? path.basename(team.logoPath)
        : null;
      const logoFullPath = resolvedLogoFilename
        ? path.join(LOGOS_DIR, resolvedLogoFilename)
        : null;

      const [logoExists, fondoExists] = await Promise.all([
        logoFullPath ? fileExists(logoFullPath) : Promise.resolve(false),
        fileExists(FONDO_PATH),
      ]);

      const files: AttachmentBuilder[] = [];
      if (logoExists && logoFullPath && resolvedLogoFilename) {
        files.push(
          new AttachmentBuilder(logoFullPath, { name: resolvedLogoFilename }),
        );
      }
      if (fondoExists) {
        files.push(
          new AttachmentBuilder(FONDO_PATH, { name: "fondo_fichajes.png" }),
        );
      }

      const dtIsMainDT = isDT(member, settings);
      const posicionFinal = posicion ?? "N/A";
      const displayTarget = targetUser.globalName ?? targetUser.username;
      const displayDT =
        interaction.user.globalName ?? interaction.user.username;
      const plantillaTag = `${plantillaActual + 1}/${modality.playersPerTeam}`;
      const rolEquipo = interaction.guild?.roles.cache.get(team.roleId);
      const colorEmbed =
        rolEquipo?.color && rolEquipo.color !== 0 ? rolEquipo.color : 0x1e90ff;
      const customIdBase = `${modality.id}_${team.id}_${targetUser.id}_${interaction.user.id}_${dtIsMainDT ? "1" : "0"}_${posicionFinal}`;

      const ofertaEmbed = new EmbedBuilder()
        .setColor(colorEmbed)
        .setAuthor({
          name: `Fichaje · ${modality.displayName}`,
          iconURL:
            interaction.guild?.iconURL({ extension: "png" }) ?? undefined,
        })
        .setTitle(`${team.name} te ha enviado una propuesta`)
        .setDescription(
          `<@${targetUser.id}>, el cuerpo técnico de **${team.name}** quiere contar contigo esta temporada.\n` +
            `¿Aceptas el reto?`,
        )
        .addFields(
          { name: "🛡️ Equipo", value: `\`${team.name}\``, inline: true },
          { name: "👤 DT", value: `<@${interaction.user.id}>`, inline: true },
          { name: "👥 Plantilla", value: `\`${plantillaTag}\``, inline: true },
          { name: "📍 Posición", value: `\`${posicionFinal}\``, inline: true },
          { name: "📅 Temporada", value: `\`${season.name}\``, inline: true },
          { name: "📋 Estado", value: "⏳ En espera", inline: true },
        )
        .setFooter({
          text: `Tienes ${OFFER_TTL_LABEL} para decidir · iDinox v3 · ${modality.displayName}`,
        })
        .setTimestamp();

      if (logoExists && resolvedLogoFilename)
        ofertaEmbed.setThumbnail(`attachment://${resolvedLogoFilename}`);
      if (fondoExists) ofertaEmbed.setImage("attachment://fondo_fichajes.png");

      const botones = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`sign_accept_${customIdBase}`)
          .setLabel("Aceptar")
          .setEmoji("✍️")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`sign_reject_${customIdBase}`)
          .setLabel("Rechazar")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`sign_cancel_${customIdBase}`)
          .setLabel("Retirar oferta")
          .setStyle(ButtonStyle.Danger),
      );

      const [msg] = await Promise.all([
        canal.send({
          content: `<@${targetUser.id}>`,
          embeds: [ofertaEmbed],
          components: [botones],
          files,
        }),
        targetUser
          .send({
            embeds: [
              new EmbedBuilder()
                .setColor(colorEmbed)
                .setTitle("📨 Tienes una oferta de fichaje")
                .setDescription(
                  `**${team.name}** de **iDinox ${modality.displayName}** quiere ficharte.\n\n` +
                    `Ve al canal de fichajes para aceptar o rechazar la propuesta.`,
                )
                .addFields(
                  {
                    name: "🛡️ Equipo",
                    value: `\`${team.name}\``,
                    inline: true,
                  },
                  { name: "👤 DT", value: `\`${displayDT}\``, inline: true },
                  {
                    name: "📍 Posición",
                    value: `\`${posicionFinal}\``,
                    inline: true,
                  },
                )
                .setFooter({
                  text: `Tienes ${OFFER_TTL_LABEL} para decidir · iDinox v3`,
                })
                .setTimestamp(),
            ],
          })
          .catch(() => null),
      ]);

      await SignOffer.create({
        dtDiscordId: interaction.user.id,
        targetDiscordId: targetUser.id,
        modalityId: modality.id,
        seasonId: season.id,
        teamId: team.id,
        channelId: canal.id,
        messageId: msg.id,
        position: posicionFinal,
        dtIsMain: dtIsMainDT,
        expiresAt: new Date(Date.now() + OFFER_TTL_MS),
      });

      const msgLink = `https://discord.com/channels/${interaction.guildId}/${canal.id}/${msg.id}`;
      targetUser
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(colorEmbed)
              .setDescription(
                `🔗 [Ver oferta en el canal de fichajes](${msgLink})`,
              ),
          ],
        })
        .catch(() => null);

      logger.success(
        `/market sign | ${interaction.user.username} → **${displayTarget}** a **${team.name}** en ${modality.displayName}`,
      );

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("✅ Oferta enviada")
            .setDescription(
              `La oferta para **${displayTarget}** ha sido enviada en <#${canalId}>.\n` +
                `El jugador tiene **${OFFER_TTL_LABEL}** para responder.`,
            )
            .addFields(
              { name: "Jugador", value: `<@${targetUser.id}>`, inline: true },
              { name: "Posición", value: `\`${posicionFinal}\``, inline: true },
              { name: "Plantilla", value: `\`${plantillaTag}\``, inline: true },
            )
            .setTimestamp(),
        ],
      });
    } catch (error) {
      logger.error(
        `/market sign | user: ${interaction.user.id} | target: ${targetUser.id} | modalidad: ${modalityName}`,
        error,
      );
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("Algo salió mal")
            .setDescription(
              "No se pudo enviar la oferta. El equipo técnico fue notificado.",
            ),
        ],
      });
    }
  },
};
