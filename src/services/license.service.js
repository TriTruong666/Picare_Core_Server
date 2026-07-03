const { License, LicenseSoftware, sequelize } = require("../models");
const { LicenseDTO } = require("../schemas/license.schema");
const {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} = require("../common/exceptions/BaseException");

const SOFTWARE_ATTRIBUTES = [
  "id", "licenseId", "name", "price", "status", "domain", "type",
  "serverConfig", "note", "createdAt", "updatedAt",
];

class LicenseService {
  static async createLicense(payload) {
    return sequelize.transaction(async (transaction) => {
      const license = await License.create({
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        customerEmail: payload.customerEmail,
        note: payload.note ?? null,
      }, { transaction });

      await LicenseSoftware.bulkCreate(
        payload.software.map((software) => ({ ...software, licenseId: license.id })),
        { transaction, validate: true },
      );

      return this.getLicenseById(license.id, transaction);
    });
  }

  static async getLicenses() {
    const licenses = await License.findAll({
      include: [{ model: LicenseSoftware, as: "software", attributes: SOFTWARE_ATTRIBUTES }],
      order: [["createdAt", "DESC"]],
    });
    return licenses.map((license) => new LicenseDTO(license));
  }

  static async getLicenseById(licenseId, transaction) {
    const license = await License.findByPk(licenseId, {
      include: [{ model: LicenseSoftware, as: "software", attributes: SOFTWARE_ATTRIBUTES }],
      transaction,
    });
    if (!license) throw new NotFoundException("Không tìm thấy license");
    return new LicenseDTO(license);
  }

  static async checkServerAccess({ licenseKey, softwareId }) {
    const software = await LicenseSoftware.findOne({
      where: { id: softwareId },
      include: [{
        model: License,
        as: "license",
        where: { licenseKey },
        attributes: ["id", "customerName", "customerEmail"],
      }],
    });

    if (!software) throw new NotFoundException("License key hoặc software ID không hợp lệ");
    if (software.type !== "server") {
      throw new BadRequestException("Chỉ phần mềm loại server mới được kiểm tra quyền API");
    }
    if (software.status !== "active") {
      throw new ForbiddenException("Server đã bị khoá hoặc đang có lỗi bản quyền");
    }

    return {
      active: true,
      status: software.status,
      customer: {
        id: software.license.id,
        name: software.license.customerName,
        email: software.license.customerEmail,
      },
      software: {
        id: software.id,
        name: software.name,
        domain: software.domain,
        enabledFeatures: Object.entries(software.serverConfig || {})
          .filter(([, enabled]) => enabled === true)
          .map(([feature]) => feature),
      },
    };
  }

  static async activateServer({ licenseKey, softwareId }) {
    return this.checkServerAccess({ licenseKey, softwareId });
  }

  static async updateSoftware(licenseId, softwareId, payload) {
    const software = await LicenseSoftware.findOne({ where: { id: softwareId, licenseId } });
    if (!software) throw new NotFoundException("Không tìm thấy phần mềm trong license");

    const allowed = ["name", "price", "status", "domain", "serverConfig", "note"];
    const changes = Object.fromEntries(
      allowed.filter((key) => Object.prototype.hasOwnProperty.call(payload, key))
        .map((key) => [key, payload[key]]),
    );
    await software.update(changes);
    return software;
  }
}

module.exports = LicenseService;
