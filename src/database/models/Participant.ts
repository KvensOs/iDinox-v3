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
import { Player } from "./Player.js";
import { Team } from "./Team.js";
import { Season } from "./Season.js";
import { Modality } from "./Modality.js";

export const POSITIONS = ["GK", "DEF", "MID", "DFWD", "FWD", "N/A"] as const;
export type Position = (typeof POSITIONS)[number];

/*
| 
| Representa la participación de un jugador en una temporada.
|
| modalityId está desnormalizado a propósito para poder buscar
| por modalidad sin hacer join con Season.
| El hook beforeSave asegura que season.modalityId y
| participant.modalityId coincidan.
|
*/

export class Participant extends Model<
  InferAttributes<Participant>,
  InferCreationAttributes<Participant>
> {
  declare id: CreationOptional<number>;
  declare playerId: ForeignKey<Player["id"]>;
  declare teamId: ForeignKey<Team["id"]> | null;
  declare seasonId: ForeignKey<Season["id"]>;
  declare modalityId: ForeignKey<Modality["id"]>;
  declare position: CreationOptional<Position>;
  declare isActive: CreationOptional<boolean>;
}

Participant.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    playerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "players", key: "id" },
    },

    teamId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      references: { model: "teams", key: "id" },
    },

    seasonId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "seasons", key: "id" },
    },

    modalityId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "modalities", key: "id" },
    },

    position: {
      type: DataTypes.ENUM(...POSITIONS),
      allowNull: false,
      defaultValue: "N/A",
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: "participants",

    indexes: [
      { fields: ["playerId"] },
      { fields: ["teamId"] },
      { fields: ["seasonId"] },
      { fields: ["modalityId"] },
      { fields: ["seasonId", "modalityId"] },
      { fields: ["seasonId", "teamId"] },
      // un jugador solo puede tener una participación por temporada y modalidad
      {
        unique: true,
        name: "uq_participant_player_season_modality",
        fields: ["playerId", "seasonId", "modalityId"],
      },
    ],

    hooks: {
      /**
       * Verifica que la season exista y coincida con la modalidad del participant.
       * Si hay teamId, también comprueba que el equipo exista y sea de la misma modalidad.
       *
       * Solo se ejecuta si cambian seasonId, modalityId o teamId para evitar queries innecesarias.
       */
      async beforeSave(participant) {
        const isNew = participant.isNewRecord;
        const seasonChanged = participant.changed("seasonId");
        const modalityChanged = participant.changed("modalityId");
        const teamChanged = participant.changed("teamId");

        if (!isNew && !seasonChanged && !modalityChanged && !teamChanged)
          return;

        const season = await Season.findByPk(participant.seasonId);
        if (!season) {
          throw new Error("La temporada especificada no existe.");
        }
        if (season.modalityId !== participant.modalityId) {
          throw new Error(
            "La temporada no pertenece a la modalidad especificada.",
          );
        }

        if (participant.teamId != null) {
          const team = await Team.findByPk(participant.teamId);
          if (!team) {
            throw new Error("El equipo especificado no existe.");
          }
          if (team.modalityId !== participant.modalityId) {
            throw new Error(
              "El equipo no pertenece a la misma modalidad del participante.",
            );
          }
        }
      },
    },
  },
);
