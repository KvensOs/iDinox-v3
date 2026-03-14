import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  Collection,
  Client,
} from "discord.js";

interface CommandMeta {
  name: string;
  description: string;
  category: string;
  emoji: string;
  usage: string;
}

const CAT_TODOS = "📦 Todos";
const CAT_OTROS = "❔ Otros";
const COLOR = 0x5865f2;

function parseCategory(cat: string): { emoji: string | null; label: string } {
  const emoji = cat.match(/^\p{Emoji}/u)?.[0] ?? null;
  const label = cat.replace(/^\p{Emoji}\s*/u, "").trim() || "General";
  return { emoji, label };
}

function buildCategoryMenu(
  categories: string[],
  selected: string | null = null,
) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ayuda_category")
      .setPlaceholder("📂 Selecciona una categoría...")
      .addOptions(
        categories.map((cat) => {
          const { emoji, label } = parseCategory(cat);
          return {
            label,
            value: cat,
            ...(emoji ? { emoji } : {}),
            default: cat === selected,
          };
        }),
      ),
  );
}

function buildHomeButton(disabled = false) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ayuda_home")
      .setLabel("Inicio")
      .setEmoji("🏠")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

function buildHomeEmbed(totalCommands: number, totalCategories: number) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("📖 Centro de Ayuda · iDinox v3")
    .setDescription(
      "Selecciona una categoría del menú para explorar los comandos disponibles.\n\n" +
        "Usa los botones para navegar o volver al inicio.",
    )
    .addFields(
      { name: "Comandos", value: `\`${totalCommands}\``, inline: true },
      { name: "Categorías", value: `\`${totalCategories}\``, inline: true },
    )
    .setFooter({ text: "iDinox v3 · Solo visible para ti" })
    .setTimestamp();
}

function buildCategoryEmbed(category: string, commands: CommandMeta[]) {
  const lines = commands
    .map((c) => `${c.emoji} **${c.usage}**\n┗ ${c.description}`)
    .join("\n\n");

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`${category}`)
    .setDescription(lines || "_No hay comandos en esta categoría._")
    .setFooter({
      text: `${commands.length} comando${commands.length !== 1 ? "s" : ""} en esta categoría`,
    })
    .setTimestamp();
}

export default {
  category: "⚙️ Sistema",
  emoji: "📖",
  usage: "/ayuda",

  data: new SlashCommandBuilder()
    .setName("ayuda")
    .setDescription(
      "Centro de ayuda interactivo con todos los comandos de iDinox.",
    )
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const client = interaction.client as Client & {
      commands: Collection<string, Record<string, unknown>>;
    };

    const commandMap = new Map<string, CommandMeta[]>();
    const categorySet = new Set<string>([CAT_TODOS]);

    for (const [, cmd] of client.commands) {
      if (!cmd.data || typeof cmd.data !== "object") continue;
      const data = cmd.data as { name?: string; description?: string };
      if (!data.name || data.name === "ayuda") continue;

      const category = (cmd.category as string | undefined) ?? CAT_OTROS;
      categorySet.add(category);

      if (!commandMap.has(category)) commandMap.set(category, []);
      commandMap.get(category)!.push({
        name: data.name,
        description: data.description ?? "Sin descripción.",
        category,
        emoji: (cmd.emoji as string | undefined) ?? "🔹",
        usage: (cmd.usage as string | undefined) ?? `/${data.name}`,
      });
    }

    const categories = [
      CAT_TODOS,
      ...[...categorySet]
        .filter((c) => c !== CAT_TODOS && c !== CAT_OTROS)
        .sort(),
      ...(categorySet.has(CAT_OTROS) ? [CAT_OTROS] : []),
    ];

    const allCommands = [...commandMap.values()].flat();

    const homeEmbed = buildHomeEmbed(allCommands.length, categories.length - 1);

    const message = await interaction.editReply({
      embeds: [homeEmbed],
      components: [buildCategoryMenu(categories), buildHomeButton(true)],
    });

    const collector = message.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      time: 120_000,
      idle: 45_000,
    });

    collector.on("collect", async (i) => {
      if (i.customId === "ayuda_home") {
        await i.update({
          embeds: [homeEmbed],
          components: [buildCategoryMenu(categories), buildHomeButton(true)],
        });
        return;
      }

      if (i.customId === "ayuda_category" && i.isStringSelectMenu()) {
        const selected = i.values[0];
        const cmds =
          selected === CAT_TODOS
            ? allCommands
            : (commandMap.get(selected) ?? []);

        await i.update({
          embeds: [buildCategoryEmbed(selected, cmds)],
          components: [
            buildCategoryMenu(categories, selected),
            buildHomeButton(false),
          ],
        });
      }
    });

    collector.on("end", () => {
      interaction.editReply({ components: [] }).catch(() => null);
    });
  },
};
