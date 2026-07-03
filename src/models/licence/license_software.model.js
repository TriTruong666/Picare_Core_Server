const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

const LicenseSoftware = sequelize.define(
  "LicenseSoftware",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    licenseId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "license_id",
      references: { model: "licenses", key: "id" },
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    price: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
    },
    status: {
      type: DataTypes.ENUM("active", "error"),
      allowNull: false,
      defaultValue: "active",
    },
    domain: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    type: {
      type: DataTypes.ENUM("client", "server"),
      allowNull: false,
    },
    serverConfig: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "server_config",
      comment: "Cấu hình bật/tắt các dịch vụ con; chỉ dùng khi type là server",
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "license_software",
    timestamps: true,
    indexes: [
      { fields: ["license_id"] },
      { fields: ["domain"] },
      { fields: ["status"] },
    ],
    validate: {
      serverConfigMatchesType() {
        if (this.type !== "server" && this.serverConfig != null) {
          throw new Error("serverConfig chỉ được sử dụng cho phần mềm loại server");
        }
      },
    },
  },
);

module.exports = LicenseSoftware;
