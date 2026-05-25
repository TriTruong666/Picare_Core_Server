const { DataTypes, Op } = require("sequelize");
const sequelize = require("../../config/postgres.config");

function getContractPeriodRange(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();

  return {
    start: new Date(year, month, 1, 0, 0, 0, 0),
    end: new Date(year, month + 1, 1, 0, 0, 0, 0),
  };
}

function formatContractNumber(sequence, date = new Date()) {
  const paddedSequence = String(sequence).padStart(3, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const companyCode = String(this.ownerCompanyInfo?.companyCode || "").trim();

  if (!companyCode) {
    throw new Error(
      "ownerCompanyInfo.companyCode is required to build contractNumber"
    );
  }

  return `${paddedSequence}/${month}/${year}/${companyCode}`;
}

async function buildNextContractNumber(contract, options = {}) {
  const baseDate = contract.createdAt || new Date();
  const { start, end } = getContractPeriodRange(baseDate);

  const latestContract = await sequelize.models.Contract.findOne({
    where: {
      createdAt: {
        [Op.gte]: start,
        [Op.lt]: end,
      },
      contractNumber: {
        [Op.ne]: null,
      },
    },
    order: [
      ["createdAt", "DESC"],
      ["id", "DESC"],
    ],
    transaction: options.transaction,
  });

  let nextSequence = 1;

  if (latestContract?.contractNumber) {
    const [lastSequence] = latestContract.contractNumber.split("/");
    const parsedSequence = Number.parseInt(lastSequence, 10);

    if (Number.isInteger(parsedSequence) && parsedSequence > 0) {
      nextSequence = parsedSequence + 1;
    }
  }

  return formatContractNumber.call(contract, nextSequence, baseDate);
}

const Contract = sequelize.define(
  "Contract",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    contractId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      unique: true,
      field: "contract_id",
    },
    contractNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "contract_number",
    },
    ownerCompanyInfo: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: "owner_company_info",
      comment:
        "companyCode, companyName, address, phone, email, bankInfo, mst, owner, role, signature",
    },
    partnerCompanyInfo: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: "partner_company_info",
      comment:
        "companyName, address, phone, email, bankInfo, mst, owner, role, signature",
    },
    contractDueDate: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "contract_due_date",
    },
    contractChecksum: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "contract_checksum",
    },
    contractType: {
      type: DataTypes.STRING,
      validate: {
        isIn: [["digital", "default"]],
      },
      defaultValue: "default",
      field: "contract_type",
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "draft",
      validate: {
        isIn: [["draft", "unsigned", "owner_signed", "completed"]],
      },
    },
    contractUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "contract_url",
    },
    signerCredential: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment:
        "credentialId(Số CCCD), name, dob(ngày sinh), home(nguyên quán), address, sex, nationality, doe(ngày hết hạn), features(đặc điểm nhận dạng), issue_date(ngày cấp), image_first, image_second",
    },
  },
  {
    tableName: "contract",
    timestamps: true,
    hooks: {
      beforeValidate: async (contract, options) => {
        if (!contract.contractNumber) {
          contract.contractNumber = await buildNextContractNumber(
            contract,
            options
          );
        }
      },
      afterCreate: async (contract, options) => {
        if (contract.contractNumber) {
          return;
        }

        const contractNumber = await buildNextContractNumber(contract, options);
        await contract.update({ contractNumber }, { ...options, hooks: false });
      },
    },
  }
);

Contract.associate = (db) => {
  Contract.hasMany(db.ContractDetail, {
    foreignKey: "contractId",
    sourceKey: "contractId",
    as: "details",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  Contract.hasMany(db.ContractDocument, {
    foreignKey: "contractId",
    sourceKey: "contractId",
    as: "documents",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  Contract.hasMany(db.ContractSignature, {
    foreignKey: "contractId",
    sourceKey: "contractId",
    as: "signatures",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
};

module.exports = Contract;
