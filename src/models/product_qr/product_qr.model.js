const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

const ProductQR = sequelize.define(
  "ProductQR",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    productId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      unique: true,
      field: "product_id",
      comment: "ID định danh duy nhất của product",
    },
    rawContent: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "raw_content",
    },
    jsonContent: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: "json_content",
    },
    qrImage: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "qr_image",
    },
    linkUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "link_url",
    },
    imageUrl: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      allowNull: true,
      field: "image_url",
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "product_qr",
    timestamps: true,
  },
);

module.exports = ProductQR;
