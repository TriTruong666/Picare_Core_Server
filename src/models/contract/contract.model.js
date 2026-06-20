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
  const documentCode = getContractDocumentCode(this.contractType);
  const rawCompanyCode = String(
    this.ownerCompanyInfo?.companyCode || this.contractType || "HD"
  )
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  const companyCode = rawCompanyCode || "HD";

  return `${paddedSequence}/${month}/${year}/${documentCode}/${companyCode}`;
}

function getContractDocumentCode(contractType) {
  const normalizedType = String(contractType || "principle")
    .trim()
    .toLowerCase();

  if (["appendix", "phu_luc", "phuluc", "plhd", "plhp"].includes(normalizedType)) {
    return "PLHP";
  }

  if (["principle", "default", "digital"].includes(normalizedType)) {
    return "HDNT";
  }

  return (
    normalizedType
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase() || "HD"
  );
}

async function buildNextContractNumber(contract, options = {}) {
  const baseDate = contract.createdAt || new Date();
  const { start, end } = getContractPeriodRange(baseDate);
  const month = String(baseDate.getMonth() + 1).padStart(2, "0");
  const year = baseDate.getFullYear();
  const documentCode = getContractDocumentCode(contract.contractType);
  const rawCompanyCode = String(
    contract.ownerCompanyInfo?.companyCode || contract.contractType || "HD"
  )
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  const companyCode = rawCompanyCode || "HD";

  const latestContract = await sequelize.models.Contract.findOne({
    where: {
      createdAt: {
        [Op.gte]: start,
        [Op.lt]: end,
      },
      contractNumber: {
        [Op.like]: `%/${month}/${year}/${documentCode}/${companyCode}`,
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
      allowNull: true,
      field: "owner_company_info",
      comment:
        "companyCode, companyName, address, phone, email, bankInfo, mst, owner, role, signature",
    },
    partnerCompanyInfo: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "partner_company_info",
      comment:
        "companyName, address, phone, email, bankInfo, mst, owner, role, signature",
    },
    contractDueDate: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "contract_due_date",
    },
    contractData: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
      field: "contract_data",
      comment: "Dynamic payload by contractType. Keeps each contract type input without changing columns.",
    },
    contractChecksum: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "contract_checksum",
    },
    contractType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "principle",
      field: "contract_type",
    },
    contractMode: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "digital",
      validate: {
        isIn: [["digital", "upload"]],
      },
      field: "contract_mode",
      comment:
        "digital: xử lý và ký trên hệ thống; upload: lưu file hợp đồng đã có",
    },
    signerType: {
      type: DataTypes.STRING,
      validate: {
        isIn: [["individual", "organization"]],
      },
      allowNull: true,
      field: "signer_type",
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
    individualCredential: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "individual_credential",
      comment:
        "credentialId(Số CCCD), name, dob(ngày sinh), home(nguyên quán), address, sex, nationality, doe(ngày hết hạn), features(đặc điểm nhận dạng), issue_date(ngày cấp), first_identification_image, second_identification_image",
    },
    organizationCredential: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "organization_credential",
      comment:
        "business_license, power_of_attorney_image(optional), gdp(optional), ccddk(optional)",
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
