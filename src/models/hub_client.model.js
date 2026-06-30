const { DataTypes } = require("sequelize");
const sequelize = require("../config/postgres.config");
const { CLIENT_STATUS } = require("../common/enum/hub_client.enum");

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
      field: "client_id",
    },
    clientName: {
      type: DataTypes.STRING,
      allowNull: false,
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
      allowNull: true,
      field: "client_internal_url",
    },
    clientExternalUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "client_external_url",
    },
    clientStatus: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isIn: [CLIENT_STATUS],
      },
      defaultValue: CLIENT_STATUS.ACTIVE,
      note: "Trạng thái của client: active, inactive",
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
    indexes: [
      { name: "hub_clients_client_id_key", unique: true, fields: ["client_id"] },
      { name: "hub_clients_client_name_key", unique: true, fields: ["client_name"] },
    ],
  },
);

module.exports = HubClient;
