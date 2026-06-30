const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

const ContractDetail = sequelize.define(
  "ContractDetail",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
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
    contractDetailId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      field: "contract_detail_id",
    },
    detailKey: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "detail_key",
    },
    detailType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "item",
      field: "detail_type",
    },
    detailData: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
      field: "detail_data",
    },
    productName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "product_name",
    },
    price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
  },
  {
    tableName: "contract_detail",
    timestamps: true,
    indexes: [
      {
        name: "contract_detail_contract_detail_id_key",
        unique: true,
        fields: ["contract_detail_id"],
      },
    ],
  }
);

ContractDetail.associate = (db) => {
  ContractDetail.belongsTo(db.Contract, {
    foreignKey: "contractId",
    targetKey: "contractId",
    as: "contract",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
};

module.exports = ContractDetail;
