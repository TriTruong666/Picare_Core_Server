const { DataTypes } = require("sequelize");
const sequelize = require("../../config/postgres.config");

const ContractSignature = sequelize.define(
  "ContractSignature",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    contractSignatureId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      field: "contract_signature_id",
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
    contractDocumentId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "contract_document_id",
    },
    signerType: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "signer_type",
      validate: {
        isIn: [["owner", "partner"]],
      },
    },
    signerName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "signer_name",
    },
    signerEmail: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "signer_email",
    },
    signingMethod: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "digital",
      field: "signing_method",
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pending",
      validate: {
        isIn: [["pending", "signed", "failed"]],
      },
    },
    pdfHashBeforeSign: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "pdf_hash_before_sign",
    },
    preparedPdfPath: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "prepared_pdf_path",
    },
    preparedPdfHash: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "prepared_pdf_hash",
    },
    byteRange: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "byte_range",
    },
    signatureLength: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "signature_length",
    },
    signatureHex: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "signature_hex",
    },
    handwrittenSignatureImageUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "handwritten_signature_image_url",
    },
    handwrittenSignatureImageKey: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "handwritten_signature_image_key",
    },
    signatureMetadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "signature_metadata",
    },
    certificatePem: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "certificate_pem",
    },
    certificateSerial: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "certificate_serial",
    },
    certificateSubject: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "certificate_subject",
    },
    certificateIssuer: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "certificate_issuer",
    },
    vendor: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    signedPdfHash: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "signed_pdf_hash",
    },
    signedPdfUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "signed_pdf_url",
    },
    signedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "signed_at",
    },
  },
  {
    tableName: "contract_signature",
    timestamps: true,
    indexes: [
      {
        name: "contract_signature_contract_signature_id_key",
        unique: true,
        fields: ["contract_signature_id"],
      },
    ],
  }
);

ContractSignature.associate = (db) => {
  ContractSignature.belongsTo(db.Contract, {
    foreignKey: "contractId",
    targetKey: "contractId",
    as: "contract",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });

  ContractSignature.belongsTo(db.ContractDocument, {
    foreignKey: "contractDocumentId",
    targetKey: "contractDocumentId",
    as: "document",
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  });
};

module.exports = ContractSignature;
