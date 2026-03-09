// src/database/associations.ts

import { sequelize } from "../core/database.js";
import { Modality } from "./models/Modality.js";
import { Season } from "./models/Season.js";
import { Team } from "./models/Team.js";
import { Player } from "./models/Player.js";
import { Participant } from "./models/Participant.js";
import { Competition } from "./models/Competition.js";
import { Stat } from "./models/Stat.js";
import { Award } from "./models/Award.js";
import { AwardWinner } from "./models/AwardWinner.js";
import { logger } from "../utils/logger.js";

//
// ─────────────────────────────────────────────────────────────────────────────
//
//  Árbol de dependencias:
//
//  Modality ──► Season ──► Participant ──► Stat
//          │          │         (unique: playerId+seasonId+modalityId)
//          │          ├──► Competition ──► Stat
//          │          │              └──► Award (opcional, SET NULL al borrar)
//          │          └──► Award ──► AwardWinner ──► Player
//          └──► Team ──► Participant        └──────► Team
//
//  Award.modality  → Award → Season → Modality  (sin FK duplicada)
//  Award.competition → nullable, el premio sobrevive si se borra la competición
//
//  RESTRICT  → protege historial (padre no se puede borrar si tiene hijos)
//  CASCADE   → borra dependientes cuando se borra el padre
//  SET NULL  → el hijo sobrevive sin padre
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fk = (name: string) => ({ name, allowNull: false });
const fkOpt = (name: string) => ({ name, allowNull: true });

// ─── MODALITY ─────────────────────────────────────────────────────────────────

Modality.hasMany(Season, {
    foreignKey: fk("modalityId"),
    as: "seasons",
    onDelete: "RESTRICT",
    onUpdate: "CASCADE",
});
Season.belongsTo(Modality, {
    foreignKey: fk("modalityId"),
    as: "modality",
});

Modality.hasMany(Team, {
    foreignKey: fk("modalityId"),
    as: "teams",
    onDelete: "RESTRICT",
    onUpdate: "CASCADE",
});
Team.belongsTo(Modality, {
    foreignKey: fk("modalityId"),
    as: "modality",
});

// ─── SEASON ───────────────────────────────────────────────────────────────────

Season.hasMany(Competition, {
    foreignKey: fk("seasonId"),
    as: "competitions",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
});
Competition.belongsTo(Season, {
    foreignKey: fk("seasonId"),
    as: "season",
});

Season.hasMany(Participant, {
    foreignKey: fk("seasonId"),
    as: "participants",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
});
Participant.belongsTo(Season, {
    foreignKey: fk("seasonId"),
    as: "season",
});

Season.hasMany(Award, {
    foreignKey: fk("seasonId"),
    as: "awards",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
});
Award.belongsTo(Season, {
    foreignKey: fk("seasonId"),
    as: "season",
});

// ─── PLAYER ───────────────────────────────────────────────────────────────────

Player.hasMany(Participant, {
    foreignKey: fk("playerId"),
    as: "participations",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
});
Participant.belongsTo(Player, {
    foreignKey: fk("playerId"),
    as: "player",
});

// ─── TEAM ─────────────────────────────────────────────────────────────────────
// teamId nullable → agente libre cuando teamId = null

Team.hasMany(Participant, {
    foreignKey: fkOpt("teamId"),
    as: "participants",
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
});
Participant.belongsTo(Team, {
    foreignKey: fkOpt("teamId"),
    as: "team",
});

// ─── STATS ────────────────────────────────────────────────────────────────────

Participant.hasMany(Stat, {
    foreignKey: fk("participantId"),
    as: "stats",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
});
Stat.belongsTo(Participant, {
    foreignKey: fk("participantId"),
    as: "participant",
});

Competition.hasMany(Stat, {
    foreignKey: fk("competitionId"),
    as: "stats",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
});
Stat.belongsTo(Competition, {
    foreignKey: fk("competitionId"),
    as: "competition",
});

// ─── AWARDS ───────────────────────────────────────────────────────────────────
//
//  Award ──► AwardWinner ──► Player  (premio individual o jugadores de un equipo)
//                       └──► Team    (premio de equipo)
//
//  Competition ──► Award  (opcional — premio asociado a una competición concreta)
//    SET NULL al borrar competition: el historial del premio se preserva
//
//  Consultas útiles:
//    award.getWinners({ include: [Player, Team] })
//    player.getAwardWins({ include: [Award] })
//    competition.getAwards()

Competition.hasMany(Award, {
    foreignKey: fkOpt("competitionId"),
    as: "awards",
    onDelete: "SET NULL",
    onUpdate: "CASCADE",
});
Award.belongsTo(Competition, {
    foreignKey: fkOpt("competitionId"),
    as: "competition",
});

Award.hasMany(AwardWinner, {
    foreignKey: fk("awardId"),
    as: "winners",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
});
AwardWinner.belongsTo(Award, {
    foreignKey: fk("awardId"),
    as: "award",
});

Player.hasMany(AwardWinner, {
    foreignKey: fkOpt("playerId"),
    as: "awardWins",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
});
AwardWinner.belongsTo(Player, {
    foreignKey: fkOpt("playerId"),
    as: "player",
});

Team.hasMany(AwardWinner, {
    foreignKey: fkOpt("teamId"),
    as: "awardWins",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
});
AwardWinner.belongsTo(Team, {
    foreignKey: fkOpt("teamId"),
    as: "team",
});

// ─── SINCRONIZACIÓN CONTROLADA ────────────────────────────────────────────────

export interface SyncOptions {
    alter?: boolean;
    force?: boolean;
}

export async function syncModels(options: SyncOptions = {}): Promise<void> {
    const env = process.env.NODE_ENV ?? "development";
    const ENABLE_SYNC = process.env.DB_SYNC === "true";

    if (!ENABLE_SYNC) {
        logger.warn("DB_SYNC is disabled — sequelize.sync() skipped.");
        return;
    }

    if ((options.force || options.alter) && env === "production") {
        throw new Error("force/alter are blocked in production — use migrations.");
    }

    logger.info(`Syncing DB… [env: ${env}] [alter: ${options.alter ?? false}] [force: ${options.force ?? false}]`);

    try {
        await sequelize.sync(options);
        logger.success("Database synced successfully.");
    } catch (error) {
        logger.fatal("Failed to sync database.", error);
        throw error;
    }
}