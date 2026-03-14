"use strict";

import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";

import { sequelize } from "../../core/database.js";

/*
|--------------------------------------------------------------------------
| Types
|--------------------------------------------------------------------------
*/

export interface ModalitySettings {
  marketOpen: boolean;
  rol_dt: string | null;
  rol_sub_dt: string | null;
  rol_admin: string | null;
  rol_estadistiquero: string | null;
  canal_mercado_fichajes: string | null;
  canal_mercado_bajas: string | null;
  canal_resultados: string | null;
  canal_logs: string | null;
}

export const DEFAULT_SETTINGS: ModalitySettings = {
  marketOpen: false,
  rol_dt: null,
  rol_sub_dt: null,
  rol_admin: null,
  rol_estadistiquero: null,
  canal_mercado_fichajes: null,
  canal_mercado_bajas: null,
  canal_resultados: null,
  canal_logs: null,
};

/*
|--------------------------------------------------------------------------
| Model
|--------------------------------------------------------------------------
*/

export class Modality extends Model<
  InferAttributes<Modality>,
  InferCreationAttributes<Modality>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare displayName: string;
  declare playersPerTeam: number;
  declare settings: CreationOptional<ModalitySettings>;
  declare isActive: CreationOptional<boolean>;
}

/*
|--------------------------------------------------------------------------
| Init
|--------------------------------------------------------------------------
*/

Modality.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    name: {
      type: DataTypes.STRING(60),
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: true,
        len: [2, 60],
      },
    },

    displayName: {
      type: DataTypes.STRING(60),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [2, 60],
      },
    },

    playersPerTeam: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 50,
      },
    },

    settings: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: () => ({ ...DEFAULT_SETTINGS }),
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: "modalities",

    indexes: [{ unique: true, fields: ["name"] }],

    hooks: {
      beforeValidate(modality) {
        if (modality.name) modality.name = modality.name.trim();
        if (modality.displayName)
          modality.displayName = modality.displayName.trim();
      },

      /**
       * Garantiza que settings siempre tenga todas las claves de DEFAULT_SETTINGS.
       * Útil cuando se guardan settings parciales desde el exterior.
       */
      beforeSave(modality) {
        modality.settings = {
          ...DEFAULT_SETTINGS,
          ...modality.settings,
        };
      },
    },
  },
);
