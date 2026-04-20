const { DataTypes } = require("sequelize");
const sequelize = require("../config/postgres.config");

const AppConfig = sequelize.define(
  "AppConfig",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    appVersion: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "app_version",
    },
    appName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "app_name",
    },
    appConfig: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
      field: "app_config",
    },
  },
  {
    timestamps: true,
    tableName: "app_configs",
  },
);

module.exports = AppConfig;
