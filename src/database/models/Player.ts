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
| Model
|--------------------------------------------------------------------------
|
|  Representa un usuario de Discord que puede participar en ligas.
|  discordId es el identificador externo inmutable (snowflake de Discord).
|
*/

export class Player extends Model<
    InferAttributes<Player>,
    InferCreationAttributes<Player>
> {
    declare id:          CreationOptional<number>;
    declare discordId:   string;
    declare username:    string;
    declare globalName:  CreationOptional<string | null>;
}

/*
|--------------------------------------------------------------------------
| Init
|--------------------------------------------------------------------------
*/

Player.init(
    {
        id: {
            type:          DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey:    true,
        },

        discordId: {
            type:      DataTypes.STRING(30),
            allowNull: false,
            unique:    true,
            validate: {
                notEmpty: true,
            },
        },

        username: {
            type:      DataTypes.STRING(64),
            allowNull: false,
            validate: {
                notEmpty: true,
                len:      [1, 64],
            },
        },

        globalName: {
            type:         DataTypes.STRING(64),
            allowNull:    true,
            defaultValue: null,
        },
    },
    {
        sequelize,
        tableName: "players",

        indexes: [
            { unique: true, fields: ["discordId"] },
            { fields: ["username"] },
        ],

        hooks: {
            beforeValidate(player) {
                if (player.username)   player.username   = player.username.trim();
                if (player.globalName) player.globalName = player.globalName.trim();
            },
        },
    }
);