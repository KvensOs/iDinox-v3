import { GuildMember, Client } from "discord.js";
import { createRequire } from "node:module";
import { ModalitySettings } from "../database/models/Modality.js";

const require = createRequire(import.meta.url);
const config = require("../data/config.json");

export function isAdmin(member: GuildMember, client: Client): boolean {
  const appOwner = client.application?.owner;
  const ownerId = appOwner && "id" in appOwner ? appOwner.id : null;

  if (ownerId && member.id === ownerId) return true;
  if (member.id === member.guild.ownerId) return true;
  if (
    config.rol_administrador &&
    member.roles.cache.has(config.rol_administrador)
  )
    return true;
  return false;
}

export function isModalityAdmin(
  member: GuildMember,
  client: Client,
  settings: ModalitySettings,
): boolean {
  if (isAdmin(member, client)) return true;
  if (settings.rol_admin && member.roles.cache.has(settings.rol_admin))
    return true;
  return false;
}

export const DENIED_EMBED = {
  color: 0xe74c3c,
  title: "🔒 Sin permisos",
  description: "No tienes permisos para ejecutar este comando.",
} as const;
