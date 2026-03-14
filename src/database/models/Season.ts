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

export class Season extends Model<
  InferAttributes<Season>,
  InferCreationAttributes<Season>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare modalityId: ForeignKey<Modality["id"]>;
  declare isActive: CreationOptional<boolean>;
  declare startedAt: CreationOptional<Date>;
  declare endedAt: CreationOptional<Date | null>;

  // Devuelve la season activa de una modalidad
  static async getActive(modalityId: number): Promise<Season | null> {
    return Season.findOne({
      where: { modalityId, isActive: true },
    });
  }

  /*
    |--------------------------------------------------------------------------
    | setActive
    |--------------------------------------------------------------------------
    | Activa una season y desactiva las demás de la misma modalidad.
    | Usa una transacción para evitar que existan dos seasons activas a la vez.
    */
  static async setActive(seasonId: number): Promise<void> {
    await sequelize.transaction(async (t) => {
      const season = await Season.findByPk(seasonId, { transaction: t });
      if (!season) throw new Error("Season no encontrada.");

      // Desactiva todas las seasons activas de la misma modalidad
      await Season.update(
        { isActive: false },
        {
          where: { modalityId: season.modalityId, isActive: true },
          transaction: t,
        },
      );

      await season.update({ isActive: true }, { transaction: t });
    });
  }
}

Season.init(
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

    modalityId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "modalities", key: "id" },
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    startedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },

    endedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    sequelize,
    tableName: "seasons",

    indexes: [
      { fields: ["modalityId"] },
      // nombre único por modalidad
      { unique: true, fields: ["name", "modalityId"] },
      // Índice único parcial: solo funciona en PostgreSQL y SQLite.
      // En MySQL no está soportado, así que se usa setActive() para
      // asegurar la unicidad desde la lógica de la aplicación.
      {
        unique: true,
        fields: ["modalityId", "isActive"],
        where: { isActive: true },
      },
    ],

    hooks: {
      beforeValidate(season) {
        if (season.name) season.name = season.name.trim();
      },

      // Evita cerrar la temporada sin fecha de fin o con fechas inválidas.
      beforeSave(season) {
        if (
          season.changed("isActive") &&
          season.isActive === false &&
          season.endedAt == null
        ) {
          season.endedAt = new Date();
        }

        if (season.startedAt && season.endedAt) {
          if (season.endedAt <= season.startedAt) {
            throw new Error("endedAt debe ser posterior a startedAt.");
          }
        }
      },
    },
  },
);
