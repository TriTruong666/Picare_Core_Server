const { DataTypes } = require("sequelize");
const crypto = require("crypto");
const sequelize = require("../../config/postgres.config");

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const NUMBERS = "0123456789";
const SPECIALS = "!@#$%^&*_-+=";
const LICENSE_KEY_LENGTH = 36;

const randomCharacter = (characters) =>
  characters[crypto.randomInt(0, characters.length)];

const generateLicenseKey = () => {
  const characters = [
    randomCharacter(LETTERS),
    randomCharacter(NUMBERS),
    randomCharacter(SPECIALS),
  ];
  const alphabet = `${LETTERS}${NUMBERS}${SPECIALS}`;
  while (characters.length < LICENSE_KEY_LENGTH) {
    characters.push(randomCharacter(alphabet));
  }
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(0, index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
};

const License = sequelize.define(
  "License",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    licenseId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      field: "license_id",
      comment: "Mã UUIDV4 public của license",
    },
    licenseKey: {
      type: DataTypes.STRING(36),
      defaultValue: generateLicenseKey,
      allowNull: false,
      field: "license_key",
      validate: { len: [36, 36] },
      comment: "Khoá ngẫu nhiên 36 ký tự gồm chữ, số và ký tự đặc biệt",
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
    oncePaymentStatus: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "unpaid",
      comment: "Trạng thái thanh toán",
      validate: {
        isIn: [["paid", "partialy_paid", "unpaid"]],
      },
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
        name: "licenses_license_id_unique",
        unique: true,
        fields: ["license_id"],
      },
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

License.generateLicenseKey = generateLicenseKey;

module.exports = License;
