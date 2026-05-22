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
      unique: true,
      field: "contract_detail_id",
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
