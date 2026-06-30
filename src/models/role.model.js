const { DataTypes } = require("sequelize");
const sequelize = require("../config/postgres.config");

const Role = sequelize.define(
  "Role",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
    },
  },
  {
    tableName: "roles",
    timestamps: true,
    indexes: [{ name: "roles_name_key", unique: true, fields: ["name"] }],
  }
);

module.exports = Role;
