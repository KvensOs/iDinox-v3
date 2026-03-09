import {
    DataTypes,
    Model,
    InferAttributes,
    InferCreationAttributes,
    CreationOptional,
} from "sequelize";
import { sequelize } from "../../core/database.js";

export type SignOfferStatus = "pending" | "accepted" | "rejected" | "expired";

export class SignOffer extends Model<
    InferAttributes<SignOffer>,
    InferCreationAttributes<SignOffer>
> {
    declare id: CreationOptional<number>;

    declare dtDiscordId: string;
    declare targetDiscordId: string;

    declare modalityId: number;
    declare seasonId: number;
    declare teamId: number;

    declare channelId: string;
    declare messageId: string;

    declare position: string;

    declare dtIsMain: boolean;

    declare status: CreationOptional<SignOfferStatus>;

    declare expiresAt: Date;

    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}

SignOffer.init(
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        dtDiscordId: { type: DataTypes.STRING(32), allowNull: false },
        targetDiscordId: { type: DataTypes.STRING(32), allowNull: false },
        modalityId: { type: DataTypes.INTEGER, allowNull: false },
        seasonId: { type: DataTypes.INTEGER, allowNull: false },
        teamId: { type: DataTypes.INTEGER, allowNull: false },
        channelId: { type: DataTypes.STRING(32), allowNull: false },
        messageId: { type: DataTypes.STRING(32), allowNull: false },
        position: { type: DataTypes.STRING(10), allowNull: false, defaultValue: "N/A" },
        dtIsMain: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        status: {
            type: DataTypes.ENUM("pending", "accepted", "rejected", "expired"),
            allowNull: false,
            defaultValue: "pending",
        },
        expiresAt: { type: DataTypes.DATE, allowNull: false },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    {
        sequelize,
        tableName: "sign_offers",
        timestamps: true,
        indexes: [
            {
                unique: true,
                name: "uq_target_modality_pending",
                fields: ["targetDiscordId", "modalityId", "status"],
            },
        ],
    }
);