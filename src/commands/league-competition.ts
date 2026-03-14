import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  GuildMember,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  AutocompleteInteraction,
  ChannelType,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";

import { Op, UniqueConstraintError } from "sequelize";
import {
  Competition,
  CompetitionType,
} from "../database/models/Competition.js";
import { Stat } from "../database/models/Stat.js";
import { Season } from "../database/models/Season.js";
import { Modality } from "../database/models/Modality.js";
import { isAdmin, DENIED_EMBED } from "../utils/permissions.js";
import { logger } from "../utils/logger.js";
import { autocompleteModality } from "../utils/modalityAutocomplete.js";

const COMPETITION_TYPES: { name: string; value: CompetitionType }[] = [
  { name: "Liga", value: "league" },
  { name: "Copa", value: "cup" },
  { name: "Amistoso", value: "friendly" },
  { name: "Otro", value: "other" },
];

const TYPE_LABELS: Record<CompetitionType, string> = {
  league: "Liga",
  cup: "Copa",
  friendly: "Amistoso",
  other: "Otro",
};

function getTypeLabel(type: CompetitionType | undefined | null): string {
  return TYPE_LABELS[type ?? "other"] ?? "Otro";
}

async function getActiveSeason(modalityId: number): Promise<Season | null> {
  return Season.findOne({ where: { modalityId, isActive: true } });
}

async function findCompetition(
  seasonId: number,
  name: string,
): Promise<Competition | null> {
  return Competition.findOne({ where: { seasonId, name } });
}

async function configureStatsChannel(
  channel: TextChannel,
  modality: Modality,
): Promise<void> {
  const guild = channel.guild;
  const { rol_estadistiquero, rol_admin } = modality.settings;

  await channel.permissionOverwrites.edit(guild.roles.everyone, {
    SendMessages: false,
  });

  if (rol_estadistiquero) {
    const role = guild.roles.cache.get(rol_estadistiquero);
    if (role) {
      await channel.permissionOverwrites.edit(role, { SendMessages: true });
    }
  }

  if (rol_admin) {
    const role = guild.roles.cache.get(rol_admin);
    if (role) {
      await channel.permissionOverwrites.edit(role, { SendMessages: true });
    }
  }
}

async function createStatsChannel(
  interaction: ChatInputCommandInteraction,
  modality: Modality,
  competitionName: string,
): Promise<TextChannel | null> {
  const guild = interaction.guild!;

  const safeName = `stats-${competitionName}-${modality.name}`
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 100);

  const channel = await guild.channels.create({
    name: safeName,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.SendMessages],
      },
    ],
  });

  await configureStatsChannel(channel, modality);
  return channel;
}

export default {
  category: "🏆 Competencias",
  emoji: "🏆",
  usage: "/league-competition new | edit | close | delete",

  data: new SlashCommandBuilder()
    .setName("league-competition")
    .setDescription("Gestiona las competencias de una temporada.")
    .setDMPermission(false)

    .addSubcommand((sub) =>
      sub
        .setName("new")
        .setDescription("Crea una nueva competencia en la temporada activa.")
        .addStringOption((opt) =>
          opt
            .setName("modalidad")
            .setDescription("Modalidad.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("nombre")
            .setDescription("Nombre de la competencia.")
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(120),
        )
        .addStringOption((opt) =>
          opt
            .setName("tipo")
            .setDescription("Tipo de competencia.")
            .setRequired(true)
            .addChoices(...COMPETITION_TYPES),
        )
        .addChannelOption((opt) =>
          opt
            .setName("canal_estadisticas")
            .setDescription(
              "Canal donde se cargarán las stats. Deja vacío para crear uno automáticamente.",
            )
            .addChannelTypes(ChannelType.GuildText),
        )
        .addBooleanOption((opt) =>
          opt
            .setName("crear_canal")
            .setDescription("Crear un canal de estadísticas automáticamente."),
        ),
    )

    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edita una competencia existente.")
        .addStringOption((opt) =>
          opt
            .setName("modalidad")
            .setDescription("Modalidad.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("competencia")
            .setDescription("Competencia a editar.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("nombre")
            .setDescription("Nuevo nombre.")
            .setMinLength(3)
            .setMaxLength(120),
        )
        .addStringOption((opt) =>
          opt
            .setName("tipo")
            .setDescription("Nuevo tipo.")
            .addChoices(...COMPETITION_TYPES),
        )
        .addChannelOption((opt) =>
          opt
            .setName("canal_estadisticas")
            .setDescription("Nuevo canal de stats (selecciona uno existente).")
            .addChannelTypes(ChannelType.GuildText),
        )
        .addBooleanOption((opt) =>
          opt
            .setName("crear_canal")
            .setDescription(
              "Crear un nuevo canal de estadísticas automáticamente.",
            ),
        ),
    )

    .addSubcommand((sub) =>
      sub
        .setName("close")
        .setDescription("Cierra una competencia activa (sin eliminarla).")
        .addStringOption((opt) =>
          opt
            .setName("modalidad")
            .setDescription("Modalidad.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("competencia")
            .setDescription("Competencia a cerrar.")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )

    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Elimina una competencia permanentemente.")
        .addStringOption((opt) =>
          opt
            .setName("modalidad")
            .setDescription("Modalidad.")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("competencia")
            .setDescription("Competencia a eliminar.")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused(true);

    if (focused.name === "modalidad") {
      return autocompleteModality(interaction);
    }

    if (focused.name === "competencia") {
      const modalityName = interaction.options.getString("modalidad");
      if (!modalityName) return interaction.respond([]);

      const modality = await Modality.findOne({
        where: { name: modalityName, isActive: true },
      });
      if (!modality) return interaction.respond([]);

      const season = await getActiveSeason(modality.id);
      if (!season) return interaction.respond([]);

      const subcommand = interaction.options.getSubcommand(false);
      const query = focused.value.toLowerCase();
      const whereExtra = subcommand === "close" ? { isActive: true } : {};

      const competitions = await Competition.findAll({
        where: {
          seasonId: season.id,
          name: { [Op.like]: `%${query}%` },
          ...whereExtra,
        },
        limit: 25,
      });

      return interaction.respond(
        competitions.map((c) => ({
          name: `${c.isActive ? "🟢" : "🔴"} ${c.name} · ${getTypeLabel(c.type)}`,
          value: c.name,
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

      const season = await getActiveSeason(modality.id);
      if (!season) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe67e22)
              .setTitle("Sin temporada activa")
              .setDescription(
                `No hay una temporada activa en **${modality.displayName}**. Crea una primero.`,
              ),
          ],
        });
        return;
      }

      if (sub === "new") return await handleNew(interaction, modality, season);
      if (sub === "edit")
        return await handleEdit(interaction, modality, season);
      if (sub === "close")
        return await handleClose(interaction, modality, season);
      if (sub === "delete")
        return await handleDelete(interaction, modality, season);
    } catch (error) {
      logger.error(
        `/league-competition ${sub} | user: ${interaction.user.id} | modalidad: ${modalityName}`,
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

async function handleNew(
  interaction: ChatInputCommandInteraction,
  modality: Modality,
  season: Season,
): Promise<void> {
  const nombre = interaction.options.getString("nombre", true).trim();
  const tipo = interaction.options.getString("tipo", true) as CompetitionType;
  const crearCanal = interaction.options.getBoolean("crear_canal") ?? false;

  const canalOptRaw = interaction.options.getChannel("canal_estadisticas");
  const canalOpt = canalOptRaw
    ? ((interaction.guild!.channels.cache.get(canalOptRaw.id) as
        | TextChannel
        | undefined) ?? null)
    : null;

  let statsChannel: TextChannel | null = null;

  if (canalOpt) {
    statsChannel = canalOpt;
    await configureStatsChannel(statsChannel, modality);
  } else if (crearCanal) {
    statsChannel = await createStatsChannel(interaction, modality, nombre);
  }

  const competition = await Competition.create({
    name: nombre,
    seasonId: season.id,
    type: tipo,
    isActive: true,
    canalEstadisticas: statsChannel?.id ?? null,
  }).catch((err: unknown) => {
    if (err instanceof UniqueConstraintError) return null;
    throw err;
  });

  if (!competition) {
    await interaction.editReply({
      content: `Ya existe una competencia llamada **${nombre}** en la temporada **${season.name}**.`,
    });
    return;
  }

  logger.success(
    `/league-competition new | ${interaction.user.username} creó **${nombre}** (${tipo}) en ${modality.displayName} · ${season.name}`,
  );

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Tipo", value: getTypeLabel(tipo), inline: true },
    { name: "Temporada", value: `\`${season.name}\``, inline: true },
    { name: "Estado", value: "🟢 Activa", inline: true },
  ];

  if (statsChannel) {
    fields.push({
      name: "Canal de stats",
      value: statsChannel.toString(),
      inline: true,
    });
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("Competencia creada")
        .setDescription(
          `**${nombre}** ha sido añadida a **${modality.displayName}**.`,
        )
        .addFields(fields)
        .setFooter({
          text: `iDinox v3 · Creada por ${interaction.user.username}`,
        })
        .setTimestamp(),
    ],
  });
}

async function handleEdit(
  interaction: ChatInputCommandInteraction,
  modality: Modality,
  season: Season,
): Promise<void> {
  const compName = interaction.options.getString("competencia", true);
  const newNombre = interaction.options.getString("nombre")?.trim();
  const newTipo = interaction.options.getString(
    "tipo",
  ) as CompetitionType | null;
  const canalOptRaw = interaction.options.getChannel("canal_estadisticas");
  const canalOpt = canalOptRaw
    ? ((interaction.guild!.channels.cache.get(canalOptRaw.id) as
        | TextChannel
        | undefined) ?? null)
    : null;
  const crearCanal = interaction.options.getBoolean("crear_canal") ?? false;

  const competition = await findCompetition(season.id, compName);
  if (!competition) {
    await interaction.editReply({
      content: `No se encontró la competencia **${compName}** en la temporada activa.`,
    });
    return;
  }

  let newStatsChannel: TextChannel | null = null;

  if (canalOpt) {
    newStatsChannel = canalOpt;
    await configureStatsChannel(newStatsChannel, modality);
  } else if (crearCanal) {
    newStatsChannel = await createStatsChannel(
      interaction,
      modality,
      competition.name,
    );
  }

  const cambios: string[] = [];

  if (newNombre && newNombre !== competition.name) {
    const duplicado = await Competition.findOne({
      where: { seasonId: season.id, name: newNombre },
    });
    if (duplicado) {
      await interaction.editReply({
        content: `Ya existe una competencia llamada **${newNombre}** en esta temporada.`,
      });
      return;
    }
    cambios.push(`Nombre: \`${competition.name}\` → \`${newNombre}\``);
    competition.name = newNombre;
  }

  if (newTipo && newTipo !== competition.type) {
    cambios.push(
      `Tipo: \`${getTypeLabel(competition.type)}\` → \`${getTypeLabel(newTipo)}\``,
    );
    competition.type = newTipo;
  }

  if (newStatsChannel) {
    const anterior = competition.canalEstadisticas
      ? `<#${competition.canalEstadisticas}>`
      : "_ninguno_";
    cambios.push(`Canal de stats: ${anterior} → ${newStatsChannel.toString()}`);
    competition.canalEstadisticas = newStatsChannel.id;
  }

  if (cambios.length === 0) {
    await interaction.editReply({
      content: "Los valores indicados son iguales a los actuales. Sin cambios.",
    });
    return;
  }

  await competition.save();

  logger.success(
    `/league-competition edit | ${interaction.user.username} editó **${competition.name}** en ${modality.displayName}`,
  );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("Competencia actualizada")
        .setDescription(
          `**${competition.name}** ha sido modificada en **${modality.displayName}**.`,
        )
        .addFields({ name: "Cambios", value: cambios.join("\n") })
        .setFooter({
          text: `iDinox v3 · Editada por ${interaction.user.username}`,
        })
        .setTimestamp(),
    ],
  });
}

async function handleClose(
  interaction: ChatInputCommandInteraction,
  modality: Modality,
  season: Season,
): Promise<void> {
  const compName = interaction.options.getString("competencia", true);
  const competition = await findCompetition(season.id, compName);

  if (!competition) {
    await interaction.editReply({
      content: `No se encontró la competencia **${compName}** en la temporada activa.`,
    });
    return;
  }
  if (!competition.isActive) {
    await interaction.editReply({
      content: `**${competition.name}** ya está cerrada.`,
    });
    return;
  }

  competition.isActive = false;
  await competition.save();

  logger.success(
    `/league-competition close | ${interaction.user.username} cerró **${competition.name}** en ${modality.displayName}`,
  );

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle("Competencia cerrada")
        .setDescription(
          `**${competition.name}** ha sido cerrada en **${modality.displayName}**.`,
        )
        .addFields(
          { name: "Temporada", value: `\`${season.name}\``, inline: true },
          { name: "Tipo", value: getTypeLabel(competition.type), inline: true },
        )
        .setFooter({
          text: `iDinox v3 · Cerrada por ${interaction.user.username}`,
        })
        .setTimestamp(),
    ],
  });
}

async function handleDelete(
  interaction: ChatInputCommandInteraction,
  modality: Modality,
  season: Season,
): Promise<void> {
  const compName = interaction.options.getString("competencia", true);
  const competition = await findCompetition(season.id, compName);

  if (!competition) {
    await interaction.editReply({
      content: `No se encontró la competencia **${compName}** en la temporada activa.`,
    });
    return;
  }

  const totalStats = await Stat.count({
    where: { competitionId: competition.id },
  });

  const confirmEmbed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`Eliminar competencia: ${competition.name}`)
    .setDescription(
      totalStats > 0
        ? `Esta competencia tiene **${totalStats} registros de estadísticas** que también serán eliminados. Esta acción es irreversible.`
        : "Esta competencia no tiene estadísticas vinculadas. Esta acción es irreversible.",
    )
    .addFields(
      { name: "Nombre", value: `\`${competition.name}\``, inline: true },
      { name: "Tipo", value: getTypeLabel(competition.type), inline: true },
      { name: "Temporada", value: `\`${season.name}\``, inline: true },
    )
    .setFooter({ text: "Tienes 20 segundos para confirmar." });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("confirm_delete_comp")
      .setLabel("Eliminar definitivamente")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("cancel_delete_comp")
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
    if (i.customId === "cancel_delete_comp") {
      await i.update({
        content: "Operación cancelada.",
        embeds: [],
        components: [],
      });
      return;
    }

    await i.update({ content: "Procesando...", embeds: [], components: [] });
    await competition.destroy();

    logger.success(
      `/league-competition delete | ${interaction.user.username} eliminó **${competition.name}** en ${modality.displayName} | ${totalStats} stats eliminadas`,
    );

    await interaction.editReply({
      content: `**${competition.name}** ha sido eliminada permanentemente.${totalStats > 0 ? ` (${totalStats} stats eliminadas)` : ""}`,
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
