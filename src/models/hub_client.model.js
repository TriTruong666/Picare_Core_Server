const { DataTypes } = require("sequelize");
const sequelize = require("../config/postgres.config");

const HubClient = sequelize.define(
  "HubClient",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    clientId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      unique: true,
      field: "client_id",
    },
    clientName: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "client_name",
    },
    clientDescription: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "client_description",
    },
    clientLogoImage: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "client_logo_image",
    },
    clientMockupImage: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "client_mockup_image",
    },
    clientInternalUrl: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "client_internal_url",
    },
    clientExternalUrl: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "client_external_url",
    },
    clientStatus: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "client_status",
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    allowedRoles: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: ["admin"],
      field: "allowed_roles",
    },
  },
  {
    tableName: "hub_clients",
    timestamps: true,
  },
);

module.exports = HubClient;
