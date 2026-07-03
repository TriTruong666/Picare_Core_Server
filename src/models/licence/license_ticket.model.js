const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

const LicenseTicket = sequelize.define(
  "LicenseTicket",
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
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: "Nội dung text hoặc HTML từ rich-text editor",
    },
    attachments: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      allowNull: false,
      defaultValue: [],
      comment: "Danh sách URL file/hình ảnh đính kèm",
    },
    status: {
      type: DataTypes.ENUM("pending", "completed", "cancelled"),
      allowNull: false,
      defaultValue: "pending",
    },
    cancelReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "cancel_reason",
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "license_tickets",
    timestamps: true,
    indexes: [
      { fields: ["license_id"] },
      { fields: ["status"] },
    ],
    validate: {
      cancelledTicketHasReason() {
        if (this.status === "cancelled" && !this.cancelReason?.trim()) {
          throw new Error("cancelReason là bắt buộc khi ticket bị huỷ");
        }
      },
    },
  },
);

module.exports = LicenseTicket;
