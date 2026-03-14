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
import { Award } from "./Award.js";
import { Player } from "./Player.js";
import { Team } from "./Team.js";

/*
|--------------------------------------------------------------------------
| Model
|--------------------------------------------------------------------------
|
|  Registra quién ganó un Award.
|
|  Premio individual  → playerId  (teamId = null)
|  Premio de equipo   → teamId    (playerId = null)
|                       + N filas con playerId para cada jugador del equipo
|
|  Al menos uno de los dos debe estar presente (validate.atLeastOne).
|
*/

export class AwardWinner extends Model<
  InferAttributes<AwardWinner>,
  InferCreationAttributes<AwardWinner>
> {
  declare id: CreationOptional<number>;
  declare awardId: ForeignKey<Award["id"]>;
  declare playerId: CreationOptional<ForeignKey<Player["id"]> | null>;
  declare teamId: CreationOptional<ForeignKey<Team["id"]> | null>;
}

AwardWinner.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    awardId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "awards", key: "id" },
    },

    playerId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      references: { model: "players", key: "id" },
    },

    teamId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      references: { model: "teams", key: "id" },
    },
  },
  {
    sequelize,
    tableName: "award_winners",

    indexes: [
      { fields: ["awardId"] },
      { fields: ["playerId"] },
      { fields: ["teamId"] },
      // un jugador no puede ganar el mismo premio dos veces
      // WHERE playerId IS NOT NULL (SQL ignora nulls en unique)
      {
        unique: true,
        name: "uq_award_player",
        fields: ["awardId", "playerId"],
      },
      // un equipo no puede ganar el mismo premio dos veces
      { unique: true, name: "uq_award_team", fields: ["awardId", "teamId"] },
    ],

    validate: {
      atLeastOne() {
        if (this.playerId == null && this.teamId == null) {
          throw new Error("AwardWinner requiere playerId o teamId.");
        }
      },
    },

    hooks: {
      /**
       * Verifica que el tipo de ganador sea coherente con el tipo del Award.
       * - Award "individual" → solo acepta playerId
       * - Award "team"       → acepta teamId y/o playerId (jugadores del equipo)
       */
      async beforeSave(winner) {
        const award = await Award.findByPk(winner.awardId);
        if (!award) throw new Error("El award especificado no existe.");

        if (award.type === "individual" && winner.teamId != null) {
          throw new Error(
            "Un premio individual no puede tener un equipo como ganador.",
          );
        }
      },
    },
  },
);
