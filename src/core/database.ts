import { Sequelize } from "sequelize";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: join(__dirname, "../../database.sqlite"),
  logging: false,
  define: {
    freezeTableName: true,
    timestamps: true,
  },
});

export async function connectDatabase(): Promise<void> {
  try {
    await sequelize.authenticate();
    await sequelize.query("PRAGMA journal_mode = WAL;");
    await sequelize.query("PRAGMA synchronous = NORMAL;");
    logger.success("Database connection established.");
  } catch (error) {
    logger.fatal("Failed to connect to database.", error);
    throw error;
  }
}
