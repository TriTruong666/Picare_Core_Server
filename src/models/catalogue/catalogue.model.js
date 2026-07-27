const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

const Catalogue = sequelize.define(
  "Catalogue",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    catalogueId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      field: "catalogue_id",
    },
    catalogueName: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "catalogue_name",
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "ACTIVE",
      validate: {
        isIn: [["ACTIVE", "INACTIVE"]],
      },
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    tableName: "catalogue",
    indexes: [
      {
        name: "catalogue_catalogue_id_key",
        unique: true,
        fields: ["catalogue_id"],
      },
    ],
  },
);

Catalogue.associate = (db) => {
  Catalogue.hasMany(db.CatalogueDetail, {
    foreignKey: "catalogueId",
    sourceKey: "catalogueId",
    as: "details",
    onDelete: "CASCADE",
    hooks: true,
  });
};

module.exports = Catalogue;
