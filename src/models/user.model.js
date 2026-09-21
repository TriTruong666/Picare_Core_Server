const { DataTypes } = require("sequelize");
const sequelize = require("../config/postgres.config");
const { UserRoles } = require("../common/enum/role.enum");
const { USER_STATUS } = require("../common/enum/user.enum");
const bcrypt = require("bcrypt");

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    userId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      field: "user_id",
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    isOnline: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: USER_STATUS.ACTIVE,
      validate: {
        isIn: [[USER_STATUS.ACTIVE, USER_STATUS.INACTIVE]],
      },
      field: "status",
    },
    loginAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "login_at",
    },
    logoutAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "logout_at",
    },
    loginIp: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "login_ip",
    },
    trustedIps: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: [],
      allowNull: false,
      field: "trusted_ips",
    },
    trustedIpRecords: {
      type: DataTypes.JSONB,
      defaultValue: [],
      allowNull: false,
      field: "trusted_ip_records",
    },
    bypassIpVerification: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      field: "bypass_ip_verification",
    },
    sessionVersion: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
      field: "session_version",
    },
    role: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: UserRoles.DEFAULT,
    },
    note: {
      type: DataTypes.TEXT,
    },
    roleId: {
      type: DataTypes.INTEGER,
      field: "role_id",
      references: {
        model: "roles",
        key: "id",
      },
      allowNull: true,
    },
  },
  {
    tableName: "users",
    timestamps: true,
    indexes: [
      { name: "users_user_id_key", unique: true, fields: ["user_id"] },
      { name: "users_email_key", unique: true, fields: ["email"] },
      { name: "users_phone_key", unique: true, fields: ["phone"] },
    ],
    hooks: {
      beforeCreate: async (user) => {
        if (user.password) {
          const salt = await bcrypt.genSalt(12);
          user.password = await bcrypt.hash(user.password, salt);
        }
      },

      beforeUpdate: async (user) => {
        if (user.changed("password")) {
          const salt = await bcrypt.genSalt(12);
          user.password = await bcrypt.hash(user.password, salt);
        }

        const invalidatesSessions = [
          "password",
          "status",
          "role",
          "roleId",
          "email",
          "bypassIpVerification",
        ].some((field) => user.changed(field));

        if (invalidatesSessions && !user.changed("sessionVersion")) {
          user.sessionVersion = Number(user.sessionVersion || 0) + 1;
        }
      },
    },
  },
);

User.prototype.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

User.associate = (models) => {
  if (models.Role) {
    User.belongsTo(models.Role, { foreignKey: "role_id" });
  }
};

module.exports = User;
