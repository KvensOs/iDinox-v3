"use strict";

import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  Op,
} from "sequelize";

import { sequelize } from "../../core/database.js";
import { Season } from "./Season.js";

export const COMPETITION_TYPES = [
  "league",
  "cup",
  "friendly",
  "other",
] as const;
export type CompetitionType = (typeof COMPETITION_TYPES)[number];

export class Competition extends Model<
  InferAttributes<Competition>,
  InferCreationAttributes<Competition>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare seasonId: ForeignKey<Season["id"]>;
  declare type: CreationOptional<CompetitionType>;
  declare isActive: CreationOptional<boolean>;
  declare canalEstadisticas: CreationOptional<string | null>;

  /**
   * Devuelve la liga activa de una temporada activa para una modalidad dada.
   * Retorna null si no hay temporada activa o liga activa.
   */
  static async getActiveLeague(
    modalityId: number,
  ): Promise<Competition | null> {
    const activeSeason = await Season.getActive(modalityId);
    if (!activeSeason) return null;

    return Competition.findOne({
      where: {
        seasonId: activeSeason.id,
        type: "league",
        isActive: true,
      },
    });
  }

  /**
   * Activa una liga dentro de su temporada, desactivando cualquier otra liga
   * activa en la misma temporada. Usa transacción para garantizar consistencia.
   */
  static async setActiveLeague(competitionId: number): Promise<void> {
    await sequelize.transaction(async (t) => {
      const competition = await Competition.findByPk(competitionId, {
        transaction: t,
      });
      if (!competition) throw new Error("Competition no encontrada.");

      if (competition.type !== "league") {
        throw new Error(
          "Solo competitions de tipo 'league' pueden ser la liga activa.",
        );
      }

      await Competition.update(
        { isActive: false },
        {
          where: {
            seasonId: competition.seasonId,
            type: "league",
            id: { [Op.ne]: competition.id },
          },
          transaction: t,
        },
      );

      await competition.update({ isActive: true }, { transaction: t });
    });
  }
}

Competition.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [3, 120],
      },
    },

    seasonId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "seasons", key: "id" },
    },

    type: {
      type: DataTypes.ENUM(...COMPETITION_TYPES),
      allowNull: false,
      defaultValue: "league",
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    // ID del canal de Discord para publicar estadísticas (uso futuro)
    canalEstadisticas: {
      type: DataTypes.STRING(30),
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    sequelize,
    tableName: "competitions",

    indexes: [
      { fields: ["seasonId"] },
      { fields: ["type"] },
      { fields: ["isActive"] },
      { unique: true, fields: ["seasonId", "name"] },
    ],

    hooks: {
      beforeValidate(competition) {
        if (competition.name) competition.name = competition.name.trim();
      },

      /**
       * Si se está activando una liga, desactiva las demás de la misma
       * temporada dentro de la misma transacción del save.
       * Solo actúa cuando isActive cambia a true en una league.
       */
      async beforeSave(competition, { transaction }) {
        if (
          competition.changed("isActive") &&
          competition.isActive &&
          competition.type === "league"
        ) {
          await Competition.update(
            { isActive: false },
            {
              where: {
                seasonId: competition.seasonId,
                type: "league",
                id: { [Op.ne]: competition.id ?? 0 },
              },
              transaction,
            },
          );
        }
      },
    },
  },
);
