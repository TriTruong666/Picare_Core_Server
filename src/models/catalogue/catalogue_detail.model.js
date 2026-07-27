const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

const CatalogueDetail = sequelize.define(
  "CatalogueDetail",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    catalogueDetailId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      field: "catalogue_detail_id",
    },
    catalogueId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "catalogue_id",
    },
    imageUrl: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "image_url",
    },
    imageKey: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "image_key",
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "sort_order",
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: "catalogue_detail",
    indexes: [
      {
        name: "catalogue_detail_catalogue_detail_id_key",
        unique: true,
        fields: ["catalogue_detail_id"],
      },
      { fields: ["catalogue_id", "sort_order"] },
    ],
  },
);

CatalogueDetail.associate = (db) => {
  CatalogueDetail.belongsTo(db.Catalogue, {
    foreignKey: "catalogueId",
    targetKey: "catalogueId",
    as: "catalogue",
    onDelete: "CASCADE",
  });
};

module.exports = CatalogueDetail;
