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
import { Modality } from "./Modality.js";

export class Team extends Model<
  InferAttributes<Team>,
  InferCreationAttributes<Team>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare abbreviation: string;
  declare logoPath: CreationOptional<string | null>;
  declare modalityId: ForeignKey<Modality["id"]>;
  declare roleId: string;
  declare uniformHome: CreationOptional<string | null>;
  declare uniformAway: CreationOptional<string | null>;
  declare emergencySigns: CreationOptional<number>;
  declare isActive: CreationOptional<boolean>;
}

Team.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    name: {
      type: DataTypes.STRING(80),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [2, 80],
      },
    },

    abbreviation: {
      type: DataTypes.STRING(6),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [2, 6],
      },
    },

    logoPath: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: null,
    },

    modalityId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "modalities", key: "id" },
    },

    roleId: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
      },
    },

    uniformHome: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: null,
    },

    uniformAway: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: null,
    },

    emergencySigns: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2,
      validate: {
        min: 0,
      },
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: "teams",

    indexes: [
      { fields: ["modalityId"] },
      { fields: ["name"] },
      { unique: true, fields: ["roleId"] },
      // nombre único por modalidad (puede haber equipos con mismo nombre en otra modalidad)
      { unique: true, fields: ["name", "modalityId"] },
    ],

    hooks: {
      beforeValidate(team) {
        if (team.name) team.name = team.name.trim();
        if (team.abbreviation)
          team.abbreviation = team.abbreviation.trim().toUpperCase();
      },
    },
  },
);
