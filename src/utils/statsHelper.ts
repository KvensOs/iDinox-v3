import {
  EmbedBuilder,
  GuildMember,
  TextChannel,
  Message,
  ChatInputCommandInteraction,
} from "discord.js";
import { sequelize } from "../core/database.js";
import { Modality } from "../database/models/Modality.js";
import { Season } from "../database/models/Season.js";
import { Competition } from "../database/models/Competition.js";
import { Player } from "../database/models/Player.js";
import { Participant } from "../database/models/Participant.js";
import { Stat, StatValues, DEFAULT_STATS } from "../database/models/Stat.js";
import { logger } from "./logger.js";

export interface ParseResult {
  deltas: Partial<Record<keyof StatValues, number>>;
  errors: string[];
}

export type StatsContext =
  | { type: "interaction"; source: ChatInputCommandInteraction }
  | { type: "message"; source: Message };

export const STAT_KEYS: Record<string, keyof StatValues> = {
  g: "goles",
  a: "asistencias",
  cs: "vallas",
  og: "autogoles",
};

export const STAT_LABELS: Record<keyof StatValues, string> = {
  goles: "Goles",
  asistencias: "Asistencias",
  vallas: "Vallas invictas",
  autogoles: "Autogoles",
};

export function parseStats(input: string): ParseResult {
  const deltas: Partial<Record<keyof StatValues, number>> = {};
  const errors: string[] = [];

  const tokens = input.trim().toLowerCase().split(/\s+/);

  for (const token of tokens) {
    const match = token.match(/^([a-z]+)(-?\d+)$/);
    if (!match) {
      errors.push(`Token inválido: \`${token}\``);
      continue;
    }

    const [, code, rawNum] = match;
    const key = STAT_KEYS[code];

    if (!key) {
      errors.push(`Código desconocido: \`${code}\` (válidos: g, a, cs, og)`);
      continue;
    }

    const amount = parseInt(rawNum, 10);

    if (isNaN(amount) || amount === 0) {
      errors.push(`Valor inválido en \`${code}\`: debe ser distinto de 0.`);
      continue;
    }

    deltas[key] = (deltas[key] ?? 0) + amount;
  }

  return { deltas, errors };
}

export interface ApplyStatsResult {
  success: boolean;
  appliedChanges: string[];
  clampedKeys: string[];
  errorMessage?: string;
}

export async function applyStats(
  modality: Modality,
  competition: Competition,
  targetPlayer: Player,
  season: Season,
  deltas: Partial<Record<keyof StatValues, number>>,
): Promise<ApplyStatsResult> {
  const participant = await Participant.findOne({
    where: {
      playerId: targetPlayer.id,
      seasonId: season.id,
      modalityId: modality.id,
    },
  });

  if (!participant) {
    return {
      success: false,
      appliedChanges: [],
      clampedKeys: [],
      errorMessage:
        `**${targetPlayer.username}** no tiene ficha en **${modality.displayName}** esta temporada.\n` +
        `Debe usar \`/start\` primero.`,
    };
  }

  const [stat] = await Stat.findOrCreate({
    where: { participantId: participant.id, competitionId: competition.id },
    defaults: {
      participantId: participant.id,
      competitionId: competition.id,
      values: { ...DEFAULT_STATS },
    },
  });

  const current: StatValues = { ...DEFAULT_STATS, ...(stat.values ?? {}) };
  const updated: StatValues = { ...current };
  const appliedChanges: string[] = [];
  const clampedKeys: string[] = [];

  for (const [k, delta] of Object.entries(deltas) as [
    keyof StatValues,
    number,
  ][]) {
    if (delta === 0) continue;

    const before = updated[k] ?? 0;
    const raw = before + delta;
    const after = Math.max(0, raw);

    if (raw < 0) clampedKeys.push(STAT_LABELS[k]);

    updated[k] = after;

    const sign = delta > 0 ? `+${delta}` : `${delta}`;
    appliedChanges.push(
      `**${STAT_LABELS[k]}**: ${before} → **${after}** (\`${sign}\`)`,
    );
  }

  const hasChanges = (Object.keys(deltas) as (keyof StatValues)[]).some(
    (k) => updated[k] !== current[k],
  );

  if (!hasChanges) {
    return {
      success: false,
      appliedChanges: [],
      clampedKeys: [],
      errorMessage:
        "Los valores resultantes no cambian respecto al estado actual.",
    };
  }

  await sequelize.transaction(async (t) => {
    stat.values = updated;
    stat.changed("values", true);
    await stat.save({ transaction: t });
  });

  return { success: true, appliedChanges, clampedKeys };
}

export async function sendStatsLog(
  client: import("discord.js").Client,
  modality: Modality,
  competition: Competition,
  targetPlayer: Player,
  editorMember: GuildMember,
  appliedChanges: string[],
  clampedKeys: string[],
): Promise<void> {
  const { canal_logs } = modality.settings;

  if (!canal_logs) {
    logger.warn(
      `stats-log · canal_logs no configurado en "${modality.name}" — log omitido.`,
    );
    return;
  }

  const rawChannel = client.channels.cache.get(canal_logs);

  if (!rawChannel?.isTextBased()) {
    logger.warn(
      `stats-log · canal_logs "${canal_logs}" no encontrado o no es de texto en "${modality.name}".`,
    );
    return;
  }

  const logChannel = rawChannel as TextChannel;

  const logEmbed = new EmbedBuilder()
    .setColor(0x3b9eff)
    .setTitle("Stats actualizadas")
    .addFields(
      { name: "Jugador", value: `\`${targetPlayer.username}\``, inline: true },
      { name: "Competicion", value: `\`${competition.name}\``, inline: true },
      { name: "Modalidad", value: `\`${modality.displayName}\``, inline: true },
      { name: "Cambios", value: appliedChanges.join("\n") || "_Ninguno_" },
      { name: "Editado por", value: editorMember.toString(), inline: true },
    )
    .setTimestamp();

  if (clampedKeys.length)
    logEmbed.setFooter({
      text: `Clamp aplicado en: ${clampedKeys.join(", ")}`,
    });

  await logChannel.send({ embeds: [logEmbed] }).catch((err: unknown) => {
    logger.warn(`stats-log · error al enviar al canal_logs: ${err}`);
  });
}
