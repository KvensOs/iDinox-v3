import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";

export default {
  category: "⚙️ Sistema",
  emoji: "🏓",
  usage: "/ping",
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Muestra la latencia del bot y el estado de la conexión."),

  async execute(interaction: ChatInputCommandInteraction) {
    const { resource } = await interaction.deferReply({ withResponse: true });

    const wsLatency = interaction.client.ws.ping;
    const apiLatency = resource!.message!.createdTimestamp - interaction.createdTimestamp;

    const getColor = (ms: number) =>
      ms < 100 ? "#2ECC71" : ms < 200 ? "#F1C40F" : "#E74C3C";

    const getStatus = (ms: number) =>
      ms < 100 ? "🟢 Excelente" : ms < 200 ? "🟡 Normal" : "🔴 Alto";

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(getColor(wsLatency))
          .setTitle("🏓 Pong!")
          .addFields(
            { name: "Latencia API", value: `\`${apiLatency}ms\` ${getStatus(apiLatency)}`, inline: true },
            { name: "Latencia WebSocket", value: `\`${wsLatency}ms\` ${getStatus(wsLatency)}`, inline: true },
            { name: "Uptime", value: `\`${formatUptime(interaction.client.uptime)}\``, inline: true },
          )
          .setTimestamp(),
      ],
    });
  },
};

function formatUptime(ms: number | null): string {
  if (!ms) return "N/A";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);

  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}