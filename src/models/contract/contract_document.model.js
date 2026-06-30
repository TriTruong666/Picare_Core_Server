const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

const ContractDocument = sequelize.define(
  "ContractDocument",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    contractDocumentId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      field: "contract_document_id",
    },
    contractId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "contract_id",
      references: {
        model: "contract",
        key: "contract_id",
      },
    },
    version: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "draft",
    },
    fileName: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "file_name",
    },
    filePath: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "file_path",
    },
    fileUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "file_url",
    },
    fileHash: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "file_hash",
    },
  },
  {
    tableName: "contract_document",
    timestamps: true,
    indexes: [
      {
        name: "contract_document_contract_document_id_key",
        unique: true,
        fields: ["contract_document_id"],
      },
      {
        unique: true,
        fields: ["contract_id", "version"],
      },
    ],
  }
);

ContractDocument.associate = (db) => {
  ContractDocument.belongsTo(db.Contract, {
    foreignKey: "contractId",
    targetKey: "contractId",
    as: "contract",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
};

module.exports = ContractDocument;
