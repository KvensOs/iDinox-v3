import { Events, Message, EmbedBuilder } from "discord.js";

function shouldIgnore(message: Message): boolean {
    return message.author.bot || !!message.webhookId || !message.guild;
}

function isBotMentioned(message: Message, botId: string): boolean {
    if (message.mentions.everyone) return false;
    if (message.mentions.roles.size > 0
        && !message.mentions.users.has(botId)) return false;

    return (
        message.mentions.users.has(botId) ||
        message.content.includes(`<@${botId}>`) ||
        message.content.includes(`<@!${botId}>`)
    );
}

export default {
    name: Events.MessageCreate,

    async execute(message: Message): Promise<void> {
        if (shouldIgnore(message)) return;

        const botId = message.client.user?.id;
        if (!botId || !isBotMentioned(message, botId)) return;

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle("👋 ¡Hola!")
            .setDescription(
                "Soy **iDinox v3**, el sistema de gestión de ligas.\n" +
                "Usa `/ayuda` para ver todos los comandos disponibles."
            )
            .addFields(
                { name: "Comandos", value: "`/ayuda`", inline: true },
                { name: "Registro", value: "`/start`", inline: true },
                { name: "Perfil", value: "`/perfil`", inline: true },
            )
            .setFooter({ text: "iDinox v3" })
            .setTimestamp();

        await message.reply({ embeds: [embed] }).catch(() => null);
    },
};