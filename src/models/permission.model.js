const { DataTypes } = require("sequelize");
const sequelize = require("../config/postgres.config");

const Permission = sequelize.define(
  "Permission",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
    },
    service: {
      type: DataTypes.STRING,
      defaultValue: "all",
      comment: "Thuộc dịch vụ nào (ví dụ: oms, chat, all)",
    },
  },
  {
    tableName: "permissions",
    timestamps: true,
  }
);

module.exports = Permission;
