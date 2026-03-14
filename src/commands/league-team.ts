import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  GuildMember,
  Guild,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  AutocompleteInteraction,
} from "discord.js";

import { Op } from "sequelize";
import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { Team } from "../database/models/Team.js";
import { Player } from "../database/models/Player.js";
import { Participant } from "../database/models/Participant.js";
import {
  Modality,
  ModalitySettings,
  DEFAULT_SETTINGS,
} from "../database/models/Modality.js";
import { Season } from "../database/models/Season.js";
import { isAdmin, DENIED_EMBED } from "../utils/permissions.js";
import { logger } from "../utils/logger.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGOS_DIR = path.join(__dirname, "../../logos");
const REGEX_COLORS = /^\/colors\b/i;

type ParticipantWithPlayer = Participant & { player: Player };

const resolveSettings = (
  raw: Partial<ModalitySettings> | null,
): ModalitySettings => ({ ...DEFAULT_SETTINGS, ...raw });

async function ensureLogosDir(): Promise<void> {
  await fs.mkdir(LOGOS_DIR, { recursive: true });
}

async function downloadLogo(url: string, filename: string): Promise<string> {
  await ensureLogosDir();
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`No se pudo descargar el logo: ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const logoPath = path.join(LOGOS_DIR, filename);
  await fs.writeFile(logoPath, buffer);
  return logoPath;
}

async function deleteLogo(logoPath: string | null): Promise<void> {
  if (!logoPath) return;
  const fullPath = path.isAbsolute(logoPath)
    ? logoPath
    : path.join(LOGOS_DIR, logoPath);
  await fs.unlink(fullPath).catch(() => null);
}

function getLogoFilename(abbreviation: string, originalName: string): string {
  const ext = originalName.split(".").pop() ?? "png";
  return `${abbreviation.toUpperCase()}.${ext}`;
}

function validateUniform(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value && !REGEX_COLORS.test(value)) {
    return `El uniforme ${label} debe iniciar con \`/colors\`.`;
  }
  return null;
}

async function setMemberNickname(
  guild: Guild,
  discordId: string,
  abbreviation: string,
  isDT: boolean,
): Promise<void> {
  const gm = await guild.members.fetch(discordId).catch(() => null);
  if (!gm) return;
  const displayName = gm.user.globalName ?? gm.user.username;
  const nick = isDT
    ? `#${abbreviation} DT ${displayName}`.slice(0, 32)
    : `#${abbreviation} ${displayName}`.slice(0, 32);
  await gm.setNickname(nick).catch(() => null);
}

async function loadActiveParticipants(
  teamId: number,
): Promise<ParticipantWithPlayer[]> {
  return Participant.findAll({
    where: { teamId, isActive: true },
    include: [{ model: Player, as: "player", required: true }],
  }) as Promise<ParticipantWithPlayer[]>;
}

async function refreshTeamNicknames(
  guild: Guild,
  participants: ParticipantWithPlayer[],
  abbreviation: string,
  settings: ModalitySettings,
): Promise<void> {
  await Promise.allSettled(
    participants.map((p) => {
      const isDT = !!(
        settings.rol_dt &&
        p.player.discordId &&
        guild.members.cache
          .get(p.player.discordId)
          ?.roles.cache.has(settings.rol_dt)
      );
      return setMemberNickname(guild, p.player.discordId, abbreviation, isDT);
    }),
  );
}

export default {
  category: "👥 Gestión de Equipos",
  emoji: "🛡️",
  usage: "/league-team add | edit | delete",

  data: new SlashCommandBuilder()
    .setName("league-team")
    .setDescription("Gestiona los equipos de iDinox.")
    .setDMPermission(false)

    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Registra un nuevo equipo.")
        .addStringOption((opt) =>
          opt
            .setName("modalidad")
            .setDescription("Modalidad del equipo.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addRoleOption((opt) =>
          opt
            .setName("rol")
            .setDescription("Rol de Discord del equipo.")
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("abreviacion")
            .setDescription("Abreviación del equipo (máx. 5 letras).")
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(5),
        )
        .addAttachmentOption((opt) =>
          opt
            .setName("logo")
            .setDescription("Logo oficial del equipo (imagen).")
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("uniforme_local")
            .setDescription("Uniforme local. Debe iniciar con /colors.")
            .setRequired(true),
        )
        .addUserOption((opt) =>
          opt
            .setName("dt")
            .setDescription("Director Técnico del equipo.")
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("nombre")
            .setDescription(
              "Nombre oficial (por defecto usa el nombre del rol).",
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName("uniforme_visitante")
            .setDescription("Uniforme visitante. Debe iniciar con /colors."),
        ),
    )

    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edita la información de un equipo.")
        .addStringOption((opt) =>
          opt
            .setName("modalidad")
            .setDescription("Modalidad del equipo.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("equipo")
            .setDescription("Abreviación del equipo.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt.setName("nombre").setDescription("Nuevo nombre oficial."),
        )
        .addStringOption((opt) =>
          opt
            .setName("abreviacion")
            .setDescription("Nueva abreviación (máx. 5 letras).")
            .setMinLength(2)
            .setMaxLength(5),
        )
        .addRoleOption((opt) =>
          opt.setName("rol").setDescription("Nuevo rol de Discord."),
        )
        .addAttachmentOption((opt) =>
          opt.setName("logo").setDescription("Nuevo logo oficial (imagen)."),
        )
        .addStringOption((opt) =>
          opt
            .setName("uniforme_local")
            .setDescription("Nuevo uniforme local (/colors)."),
        )
        .addStringOption((opt) =>
          opt
            .setName("uniforme_visitante")
            .setDescription("Nuevo uniforme visitante (/colors)."),
        ),
    )

    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Elimina un equipo de forma permanente.")
        .addStringOption((opt) =>
          opt
            .setName("modalidad")
            .setDescription("Modalidad del equipo.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("equipo")
            .setDescription("Abreviación del equipo.")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused(true);

    if (focused.name === "modalidad") return autocompleteModality(interaction);

    if (focused.name === "equipo") {
      const modalityName = interaction.options.getString("modalidad");
      if (!modalityName) return interaction.respond([]);

      const modality = await Modality.findOne({
        where: { name: modalityName, isActive: true },
      });
      if (!modality) return interaction.respond([]);

      const query = focused.value.toLowerCase();
      const teams = await Team.findAll({
        where: {
          modalityId: modality.id,
          isActive: true,
          [Op.or]: [
            { name: { [Op.like]: `%${query}%` } },
            { abbreviation: { [Op.like]: `%${query}%` } },
          ],
        },
        limit: 25,
      });

      return interaction.respond(
        teams.map((t) => ({
          name: `🛡️ ${t.name} [${t.abbreviation}]`,
          value: t.abbreviation,
        })),
      );
    }
  },

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = interaction.member as GuildMember | null;
    if (!member || !isAdmin(member, interaction.client)) {
      await interaction.editReply({ embeds: [new EmbedBuilder(DENIED_EMBED)] });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const modalityName = interaction.options.getString("modalidad", true);

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

      if (sub === "add") return await handleAdd(interaction, modality);
      if (sub === "edit") return await handleEdit(interaction, modality);
      if (sub === "delete") return await handleDelete(interaction, modality);
    } catch (error) {
      logger.error(
        `/league-team ${sub} | user: ${interaction.user.id} | modalidad: ${modalityName}`,
        error,
      );
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("Algo salió mal")
            .setDescription(
              "No se pudo completar la operación. El equipo técnico fue notificado.",
            ),
        ],
      });
    }
  },
};

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  modality: Modality,
): Promise<void> {
  const rol = interaction.options.getRole("rol", true);
  const abreviacion = interaction.options
    .getString("abreviacion", true)
    .toUpperCase()
    .trim();
  const logoAttach = interaction.options.getAttachment("logo", true);
  const uniLocal = interaction.options.getString("uniforme_local", true).trim();
  const dtUser = interaction.options.getUser("dt", true);
  const nombre = interaction.options.getString("nombre")?.trim() ?? rol.name;
  const uniVisit =
    interaction.options.getString("uniforme_visitante")?.trim() ?? null;

  if (!logoAttach.contentType?.startsWith("image/")) {
    await interaction.editReply({
      content: "El logo debe ser una imagen (jpg, png, webp).",
    });
    return;
  }

  const uniError =
    validateUniform(uniLocal, "local") ??
    validateUniform(uniVisit, "visitante");
  if (uniError) {
    await interaction.editReply({ content: uniError });
    return;
  }

  const duplicado = await Team.findOne({
    where: {
      modalityId: modality.id,
      [Op.or]: [
        { name: nombre },
        { abbreviation: abreviacion },
        { roleId: rol.id },
      ],
    },
  });
  if (duplicado) {
    await interaction.editReply({
      content:
        "Ya existe un equipo con ese nombre, abreviación o rol en esta modalidad.",
    });
    return;
  }

  const season = await Season.findOne({
    where: { modalityId: modality.id, isActive: true },
  });
  if (!season) {
    await interaction.editReply({
      content: "No hay una temporada activa en esta modalidad.",
    });
    return;
  }

  const logoFilename = getLogoFilename(abreviacion, logoAttach.name);
  const logoPath = await downloadLogo(logoAttach.url, logoFilename);

  const team = await Team.create({
    name: nombre,
    abbreviation: abreviacion,
    logoPath: `logos/${logoFilename}`,
    modalityId: modality.id,
    roleId: rol.id,
    uniformHome: uniLocal,
    uniformAway: uniVisit,
  });

  const [dtPlayer] = await Player.findOrCreate({
    where: { discordId: dtUser.id },
    defaults: {
      discordId: dtUser.id,
      username: dtUser.username,
      globalName: dtUser.globalName ?? null,
    },
  });

  const [dtParticipant, created] = await Participant.findOrCreate({
    where: {
      playerId: dtPlayer.id,
      seasonId: season.id,
      modalityId: modality.id,
    },
    defaults: {
      playerId: dtPlayer.id,
      seasonId: season.id,
      modalityId: modality.id,
      teamId: team.id,
      isActive: true,
    },
  });

  if (!created) {
    dtParticipant.teamId = team.id!;
    dtParticipant.isActive = true;
    await dtParticipant.save();
  }

  await setMemberNickname(interaction.guild!, dtUser.id, abreviacion, true);

  logger.success(
    `/league-team add | ${interaction.user.username} creó **${nombre}** [${abreviacion}] en ${modality.displayName}`,
  );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("🆕 Equipo registrado")
        .setDescription(
          `**${nombre}** ha sido añadido a **iDinox ${modality.displayName}**.`,
        )
        .setThumbnail(`attachment://${logoFilename}`)
        .addFields(
          { name: "Nombre", value: `\`${nombre}\``, inline: true },
          { name: "Abreviación", value: `\`${abreviacion}\``, inline: true },
          { name: "Rol", value: `<@&${rol.id}>`, inline: true },
          { name: "DT", value: `${dtUser}`, inline: true },
          { name: "Temporada", value: `\`${season.name}\``, inline: true },
          {
            name: "Uniformes",
            value: `🏠 \`${uniLocal}\`\n✈️ \`${uniVisit ?? "N/A"}\``,
          },
        )
        .setFooter({
          text: `iDinox v3 · Registrado por ${interaction.user.username}`,
        })
        .setTimestamp(),
    ],
    files: [new AttachmentBuilder(logoPath, { name: logoFilename })],
  });
}

async function handleEdit(
  interaction: ChatInputCommandInteraction,
  modality: Modality,
): Promise<void> {
  const equipoInput = interaction.options
    .getString("equipo", true)
    .toUpperCase();
  const nuevoNombre = interaction.options.getString("nombre")?.trim();
  const nuevaAbrev = interaction.options
    .getString("abreviacion")
    ?.toUpperCase()
    .trim();
  const nuevoRol = interaction.options.getRole("rol");
  const nuevoLogo = interaction.options.getAttachment("logo");
  const nuevoUniHome = interaction.options.getString("uniforme_local")?.trim();
  const nuevoUniAway =
    interaction.options.getString("uniforme_visitante")?.trim() ?? null;

  const uniError =
    validateUniform(nuevoUniHome, "local") ??
    validateUniform(nuevoUniAway, "visitante");
  if (uniError) {
    await interaction.editReply({ content: uniError });
    return;
  }

  const team = await Team.findOne({
    where: {
      modalityId: modality.id,
      abbreviation: equipoInput,
      isActive: true,
    },
  });
  if (!team) {
    await interaction.editReply({
      content: `No se encontró el equipo **${equipoInput}** en ${modality.displayName}.`,
    });
    return;
  }

  const cambios: string[] = [];
  const settings = resolveSettings(modality.settings);

  if (nuevaAbrev && nuevaAbrev !== team.abbreviation) {
    if (team.logoPath) {
      const ext = team.logoPath.split(".").pop() ?? "png";
      const newFilename = `${nuevaAbrev}.${ext}`;
      await fs
        .rename(
          path.join(LOGOS_DIR, path.basename(team.logoPath)),
          path.join(LOGOS_DIR, newFilename),
        )
        .catch(() => null);
      team.logoPath = `logos/${newFilename}`;
    }

    const participants = await loadActiveParticipants(team.id);
    await refreshTeamNicknames(
      interaction.guild!,
      participants,
      nuevaAbrev,
      settings,
    );

    cambios.push(`Abreviación: \`${team.abbreviation}\` → \`${nuevaAbrev}\``);
    team.abbreviation = nuevaAbrev;
  }

  if (nuevoLogo) {
    if (!nuevoLogo.contentType?.startsWith("image/")) {
      await interaction.editReply({ content: "El logo debe ser una imagen." });
      return;
    }
    await deleteLogo(team.logoPath ?? null);
    const logoFilename = getLogoFilename(team.abbreviation, nuevoLogo.name);
    await downloadLogo(nuevoLogo.url, logoFilename);
    team.logoPath = `logos/${logoFilename}`;
    cambios.push("Logo actualizado");
  }

  if (nuevoRol && nuevoRol.id !== team.roleId) {
    const [oldRole, newRole] = await Promise.all([
      interaction.guild!.roles.fetch(team.roleId).catch(() => null),
      interaction.guild!.roles.fetch(nuevoRol.id).catch(() => null),
    ]);
    if (oldRole && newRole) {
      await Promise.allSettled(
        [...oldRole.members.values()].map((gm) =>
          gm.roles
            .add(newRole)
            .then(() => gm.roles.remove(oldRole))
            .catch(() => null),
        ),
      );
    }
    cambios.push(`Rol: <@&${team.roleId}> → <@&${nuevoRol.id}>`);
    team.roleId = nuevoRol.id;
  }

  if (nuevoNombre && nuevoNombre !== team.name) {
    cambios.push(`Nombre: \`${team.name}\` → \`${nuevoNombre}\``);
    team.name = nuevoNombre;
  }
  if (nuevoUniHome && nuevoUniHome !== team.uniformHome) {
    cambios.push("Uniforme local actualizado");
    team.uniformHome = nuevoUniHome;
  }
  if (nuevoUniAway != null && nuevoUniAway !== team.uniformAway) {
    cambios.push("Uniforme visitante actualizado");
    team.uniformAway = nuevoUniAway;
  }

  if (cambios.length === 0) {
    await interaction.editReply({
      content: "Los valores indicados son iguales a los actuales. Sin cambios.",
    });
    return;
  }

  await team.save();

  logger.success(
    `/league-team edit | ${interaction.user.username} editó **${team.name}** en ${modality.displayName}`,
  );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("✏️ Equipo actualizado")
        .setDescription(
          `**${team.name}** ha sido modificado en **iDinox ${modality.displayName}**.`,
        )
        .addFields({ name: "Cambios", value: cambios.join("\n") })
        .setFooter({
          text: `iDinox v3 · Editado por ${interaction.user.username}`,
        })
        .setTimestamp(),
    ],
  });
}

async function handleDelete(
  interaction: ChatInputCommandInteraction,
  modality: Modality,
): Promise<void> {
  const equipoInput = interaction.options
    .getString("equipo", true)
    .toUpperCase();

  const team = await Team.findOne({
    where: {
      modalityId: modality.id,
      abbreviation: equipoInput,
      isActive: true,
    },
  });
  if (!team) {
    await interaction.editReply({
      content: `No se encontró el equipo **${equipoInput}** en ${modality.displayName}.`,
    });
    return;
  }

  const participants = await loadActiveParticipants(team.id);
  const totalJugadores = participants.length;

  const confirmEmbed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`⚠️ Eliminar equipo: ${team.name}`)
    .setDescription(
      "Esta acción es irreversible. El equipo será desactivado y todos sus jugadores quedarán como agentes libres.",
    )
    .addFields(
      {
        name: "Equipo",
        value: `\`${team.name}\` [\`${team.abbreviation}\`]`,
        inline: true,
      },
      { name: "Rol", value: `<@&${team.roleId}>`, inline: true },
      {
        name: "Jugadores",
        value: `\`${totalJugadores}\` serán liberados`,
        inline: true,
      },
    )
    .setFooter({ text: "Tienes 20 segundos para confirmar." });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("confirm_delete")
      .setLabel("Eliminar definitivamente")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("cancel_delete")
      .setLabel("Cancelar")
      .setStyle(ButtonStyle.Secondary),
  );

  const msg = await interaction.editReply({
    embeds: [confirmEmbed],
    components: [row],
  });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === interaction.user.id,
    time: 20_000,
    max: 1,
  });

  collector.on("collect", async (i) => {
    if (i.customId === "cancel_delete") {
      await i.update({
        content: "Operación cancelada.",
        embeds: [],
        components: [],
      });
      return;
    }

    await i.update({ content: "⏳ Procesando...", embeds: [], components: [] });

    await Promise.allSettled(
      participants.map((p) => {
        const displayName = p.player.globalName ?? p.player.username;
        return interaction
          .guild!.members.fetch(p.player.discordId)
          .then((gm) => gm.setNickname(displayName.slice(0, 32)))
          .catch(() => null);
      }),
    );

    await Participant.update({ teamId: null }, { where: { teamId: team.id } });

    team.roleId = `deleted_${team.id}`;
    team.isActive = false;
    await team.save();

    await deleteLogo(team.logoPath ?? null);

    logger.success(
      `/league-team delete | ${interaction.user.username} eliminó **${team.name}** en ${modality.displayName} | ${totalJugadores} jugadores liberados`,
    );

    await interaction.editReply({
      content: `**${team.name}** ha sido eliminado. ${totalJugadores} jugadores quedaron como agentes libres.`,
      embeds: [],
      components: [],
    });
  });

  collector.on("end", (collected) => {
    if (collected.size === 0) {
      interaction
        .editReply({
          content: "Tiempo agotado. Operación cancelada.",
          embeds: [],
          components: [],
        })
        .catch(() => null);
    }
  });
}
