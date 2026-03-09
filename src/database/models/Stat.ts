"use strict";

import {
    DataTypes,
    Model,
    InferAttributes,
    InferCreationAttributes,
    CreationOptional,
    ForeignKey,
} from "sequelize";

import { sequelize } from "../../core/database.js";
import { Participant } from "./Participant.js";
import { Competition } from "./Competition.js";
import { logger } from "../../utils/logger.js";

export interface StatValues {
    goles: number;
    asistencias: number;
    vallas: number;
    autogoles: number;
    [key: string]: number;
}

export const DEFAULT_STATS: StatValues = {
    goles: 0,
    asistencias: 0,
    vallas: 0,
    autogoles: 0,
};

export class Stat extends Model<
    InferAttributes<Stat>,
    InferCreationAttributes<Stat>
> {
    declare id: CreationOptional<number>;
    declare participantId: ForeignKey<Participant["id"]>;
    declare competitionId: ForeignKey<Competition["id"]>;
    declare values: CreationOptional<StatValues>;

    /*
    |--------------------------------------------------------------------------
    | addStats — acumula estadísticas de forma atómica
    |--------------------------------------------------------------------------
    |
    | Crea el registro si aún no existe (findOrCreate) y suma los valores
    | recibidos a las estadísticas actuales.
    |
    | Los valores negativos se ignoran y se muestra un warning.
    | Las claves desconocidas se permiten para que cada liga pueda
    | tener estadísticas personalizadas.
    |
    */

    static async addStats(
        participantId: number,
        competitionId: number,
        toAdd: Partial<StatValues>
    ): Promise<Stat> {
        return sequelize.transaction(async (t) => {
            const [stat] = await Stat.findOrCreate({
                where: { participantId, competitionId },
                defaults: {
                    participantId,
                    competitionId,
                    values: { ...DEFAULT_STATS },
                },
                transaction: t,
                lock: t.LOCK.UPDATE,
            });

            const current: StatValues = { ...DEFAULT_STATS, ...(stat.values ?? {}) };
            const updated: StatValues = { ...current };

            for (const key of Object.keys(toAdd)) {
                const raw = toAdd[key];

                if (typeof raw !== "number" || Number.isNaN(raw)) {
                    throw new Error(`Stat inválida: "${key}" debe ser un número.`);
                }

                if (raw < 0) {
                    logger.warn(`⚠️ Valor negativo ignorado en stat "${key}": ${raw}`);
                    continue;
                }

                updated[key] = (updated[key] ?? 0) + raw;
            }

            stat.values = updated;
            stat.changed("values", true);

            return stat.save({ transaction: t });
        });
    }
}

Stat.init(
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },

        participantId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: "participants", key: "id" },
        },

        competitionId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: "competitions", key: "id" },
        },

        values: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: () => ({ ...DEFAULT_STATS }),
        },
    },
    {
        sequelize,
        tableName: "stats",

        indexes: [
            { fields: ["participantId"] },
            { fields: ["competitionId"] },
            // un participant solo tiene un registro de stats por competition
            {
                unique: true,
                name: "uq_stat_participant_competition",
                fields: ["participantId", "competitionId"],
            },
        ],

        hooks: {
            /**
             * Antes de guardar, comprobamos que el participant y la competition existan
             * y que ambos pertenezcan a la misma temporada.
             * Solo lo hacemos cuando el registro es nuevo para evitar consultas extra
             * en cada actualización.
             */
            async beforeSave(stat, { transaction }) {
                if (!stat.isNewRecord) return;

                const [participant, competition] = await Promise.all([
                    Participant.findByPk(stat.participantId, { transaction }),
                    Competition.findByPk(stat.competitionId, { transaction }),
                ]);

                if (!participant) throw new Error("El participant especificado no existe.");
                if (!competition) throw new Error("La competition especificada no existe.");

                if (participant.seasonId !== competition.seasonId) {
                    throw new Error(
                        "El participant y la competition no pertenecen a la misma temporada."
                    );
                }
            },
        },
    }
);