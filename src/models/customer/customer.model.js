const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

const Customer = sequelize.define(
  "Customer",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    customerCode: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "customer_code",
      unique: true,
      comment: "Mã khách hàng",
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "customer_name",
      comment: "Tên khách hàng",
    },
    customerPhone: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "customer_phone",
      comment: "Số điện thoại khách hàng",
    },
    customerEmail: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "customer_email",
      comment: "Email khách hàng",
    },
    customerAddress: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "customer_address",
      comment: "Địa chỉ khách hàng",
    },
    taxCode: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "tax_code",
      comment: "Mã số thuế",
    },
    taxName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "tax_name",
      comment: "Tên xuất hoá đơn",
    },
    taxAddress: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "tax_address",
      comment: "Địa chỉ xuất hoá đơn",
    },
    isLoyalty: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: "is_loyalty",
      comment: "Có phải hội viên",
      defaultValue: false,
    },
    saleTeamId: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: true,
      field: "sale_team_id",
      comment: "ID đội ngũ sale, gRPC thông qua SaleForce",
    },
    customerType: {
      type: DataTypes.STRING,
      validate: {
        isIn: [["RETAIL", "B2B", "DISTRIBUTOR", "UNKNOWN"]],
      },
      field: "customer_type",
      comment: "Loại khách hàng",
      defaultValue: "UNKNOWN",
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "status",
      comment: "Trạng thái",
      validate: {
        isIn: [["ACTIVE", "INACTIVE"]],
      },
      defaultValue: "ACTIVE",
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "customer",
    timestamps: true,
  },
);

module.exports = Customer;
