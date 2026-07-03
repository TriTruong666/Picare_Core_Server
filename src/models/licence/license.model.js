const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

const License = sequelize.define(
  "License",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    licenseKey: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      field: "license_key",
      comment: "Khoá định danh duy nhất do hệ thống cấp cho khách hàng",
    },
    licenseContract: {
      type: DataTypes.ARRAY(DataTypes.JSONB),
      allowNull: true,
      comment:
        "Thông tin hợp đồng license, json bao gồm tên hợp đồng và url hợp đồng",
    },
    yearlyCost: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: 0,
      comment: "Chi phí annual hàng năm của khách hàng",
    },
    customerName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "customer_name",
    },
    customerPhone: {
      type: DataTypes.STRING(30),
      allowNull: false,
      field: "customer_phone",
    },
    customerEmail: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "customer_email",
      validate: { isEmail: true },
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "licenses",
    timestamps: true,
    indexes: [
      {
        name: "licenses_license_key_unique",
        unique: true,
        fields: ["license_key"],
      },
      { fields: ["customer_email"] },
      { fields: ["customer_phone"] },
    ],
  },
);

module.exports = License;
