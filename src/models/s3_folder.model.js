const { DataTypes } = require("sequelize");
const sequelize = require("../config/postgres.config");

/**
 * S3Folder – Quản lý các thư mục logic chứa các S3Asset.
 */
const S3Folder = sequelize.define(
  "S3Folder",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    folderId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      unique: true,
      field: "folder_id",
    },

    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      comment: "Tên thư mục (vd: avatars, public, invoices)",
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Mô tả về mục đích của thư mục",
    },

    assetCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: "asset_count",
      comment: "Số lượng file trong thư mục này",
    },

    totalSize: {
      type: DataTypes.BIGINT,
      defaultValue: 0,
      field: "total_size",
      comment: "Tổng dung lượng của tất cả file trong thư mục (bytes)",
    },
  },
  {
    tableName: "s3_folders",
    timestamps: true,
  }
);

S3Folder.associate = (db) => {
  // Một Folder chứa nhiều Assets
  S3Folder.hasMany(db.S3Asset, {
    foreignKey: "folderId",
    sourceKey: "folderId",
    as: "assets",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
};

module.exports = S3Folder;
