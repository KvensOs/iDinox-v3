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
import { Season } from "./Season.js";
import { Competition } from "./Competition.js";

export const AWARD_TYPES = ["team", "individual"] as const;
export type AwardType = (typeof AWARD_TYPES)[number];

export class Award extends Model<
  InferAttributes<Award>,
  InferCreationAttributes<Award>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare type: AwardType;
  declare seasonId: ForeignKey<Season["id"]>;
  declare competitionId: CreationOptional<ForeignKey<Competition["id"]> | null>;
  declare notes: CreationOptional<string | null>;
}

Award.init(
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
        len: [2, 120],
      },
    },

    type: {
      type: DataTypes.ENUM(...AWARD_TYPES),
      allowNull: false,
    },

    seasonId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "seasons", key: "id" },
    },

    competitionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      references: { model: "competitions", key: "id" },
    },

    notes: {
      type: DataTypes.STRING(500),
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    sequelize,
    tableName: "awards",

    indexes: [
      { fields: ["seasonId"] },
      { fields: ["competitionId"] },
      { fields: ["type"] },
      // nombre único por temporada → no puede haber dos "MVP" en la misma season
      { unique: true, fields: ["seasonId", "name"] },
    ],

    hooks: {
      beforeValidate(award) {
        if (award.name) award.name = award.name.trim();
        if (award.notes) award.notes = award.notes.trim();
      },

      /**
       * Si el award está asociado a una competición, verifica que
       * esa competición pertenezca a la misma temporada del premio.
       */
      async beforeSave(award) {
        if (award.competitionId) {
          const competition = await Competition.findByPk(award.competitionId);
          if (!competition) {
            throw new Error("La competición especificada no existe.");
          }
          if (competition.seasonId !== award.seasonId) {
            throw new Error(
              "La competición no pertenece a la temporada del premio.",
            );
          }
        }
      },
    },
  },
);
