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

Role.associate = (models) => {
  if (models.User) {
    Role.hasMany(models.User, { foreignKey: "role_id" });
  }
  if (models.Permission) {
    Role.belongsToMany(models.Permission, {
      through: "role_permissions",
      foreignKey: "role_id",
      otherKey: "permission_id",
    });
  }
};

module.exports = Role;

