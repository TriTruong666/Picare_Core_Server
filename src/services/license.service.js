const { Op } = require("sequelize");
const { License, LicenseSoftware, LicenseTicket, sequelize } = require("../models");
const { LicenseDTO, SoftwareDTO, TicketDTO } = require("../schemas/license.schema");
const { NotFoundException, ForbiddenException, BadRequestException } = require("../common/exceptions/BaseException");

const softwareInclude = { model: LicenseSoftware, as: "software" };
const ticketInclude = { model: LicenseTicket, as: "tickets" };

class LicenseService {
  static getEnabledFeatures(serverConfig) {
    if (!Array.isArray(serverConfig)) return [];
    return serverConfig
      .filter((item) => item?.active === true)
      .map((item) => item.name)
      .filter(Boolean);
  }

  static pick(payload, fields) {
    return Object.fromEntries(fields
      .filter((key) => Object.prototype.hasOwnProperty.call(payload, key))
      .map((key) => [key, payload[key]]));
  }

  static async ensureLicense(licenseId, transaction) {
    const license = await License.findByPk(licenseId, { transaction });
    if (!license) throw new NotFoundException("Không tìm thấy license");
    return license;
  }

  static async createLicense(payload) {
    return sequelize.transaction(async (transaction) => {
      const license = await License.create(this.pick(payload, [
        "customerName", "customerPhone", "customerEmail", "licenseContract", "yearlyCost", "oncePaymentStatus", "note",
      ]), { transaction });

      if (payload.software?.length) {
        await LicenseSoftware.bulkCreate(
          payload.software.map((item) => ({ ...item, licenseId: license.id })),
          { transaction, validate: true },
        );
      }
      return this.getLicenseById(license.id, transaction);
    });
  }

  static async getLicenses({ page = 1, limit = 20, search = "" } = {}) {
    const where = search ? {
      [Op.or]: ["customerName", "customerPhone", "customerEmail"].map((field) => ({
        [field]: { [Op.iLike]: `%${search}%` },
      })),
    } : {};
    const { count, rows } = await License.findAndCountAll({
      where,
      include: [softwareInclude],
      distinct: true,
      limit,
      offset: (page - 1) * limit,
      order: [["createdAt", "DESC"]],
    });
    return { count, rows: rows.map((item) => new LicenseDTO(item)), page, limit };
  }

  static async getLicenseById(licenseId, transaction) {
    const item = await License.findByPk(licenseId, {
      include: [softwareInclude, ticketInclude],
      transaction,
    });
    if (!item) throw new NotFoundException("Không tìm thấy license");
    return new LicenseDTO(item);
  }

  static async updateLicense(licenseId, payload) {
    const license = await this.ensureLicense(licenseId);
    await license.update(this.pick(payload, [
      "customerName", "customerPhone", "customerEmail", "licenseContract", "yearlyCost", "oncePaymentStatus", "note",
    ]));
    return this.getLicenseById(licenseId);
  }

  static async deleteLicense(licenseId) {
    return sequelize.transaction(async (transaction) => {
      const license = await this.ensureLicense(licenseId, transaction);
      await LicenseTicket.destroy({ where: { licenseId }, transaction });
      await LicenseSoftware.destroy({ where: { licenseId }, transaction });
      await license.destroy({ transaction });
      return { id: licenseId };
    });
  }

  static async createSoftware(licenseId, payload) {
    await this.ensureLicense(licenseId);
    const item = await LicenseSoftware.create({ ...payload, licenseId });
    return new SoftwareDTO(item);
  }

  static async getSoftware(licenseId, softwareId) {
    const item = await LicenseSoftware.findOne({ where: { id: softwareId, licenseId } });
    if (!item) throw new NotFoundException("Không tìm thấy phần mềm trong license");
    return new SoftwareDTO(item);
  }

  static async updateSoftware(licenseId, softwareId, payload) {
    const item = await LicenseSoftware.findOne({ where: { id: softwareId, licenseId } });
    if (!item) throw new NotFoundException("Không tìm thấy phần mềm trong license");
    await item.update(this.pick(payload, ["name", "price", "status", "domain", "type", "serverConfig", "note"]));
    return new SoftwareDTO(item);
  }

  static async deleteSoftware(licenseId, softwareId) {
    const item = await LicenseSoftware.findOne({ where: { id: softwareId, licenseId } });
    if (!item) throw new NotFoundException("Không tìm thấy phần mềm trong license");
    await item.destroy();
    return { id: softwareId };
  }

  static async createTicket(licenseId, payload) {
    await this.ensureLicense(licenseId);
    const item = await LicenseTicket.create({ ...payload, licenseId });
    return new TicketDTO(item);
  }

  static async getTickets(licenseId, status) {
    await this.ensureLicense(licenseId);
    const rows = await LicenseTicket.findAll({
      where: { licenseId, ...(status ? { status } : {}) },
      order: [["createdAt", "DESC"]],
    });
    return rows.map((item) => new TicketDTO(item));
  }

  static async getTicket(licenseId, ticketId) {
    const item = await LicenseTicket.findOne({ where: { id: ticketId, licenseId } });
    if (!item) throw new NotFoundException("Không tìm thấy ticket trong license");
    return new TicketDTO(item);
  }

  static async updateTicket(licenseId, ticketId, payload) {
    const item = await LicenseTicket.findOne({ where: { id: ticketId, licenseId } });
    if (!item) throw new NotFoundException("Không tìm thấy ticket trong license");
    await item.update(this.pick(payload, ["title", "message", "attachments", "status", "cancelReason", "note"]));
    return new TicketDTO(item);
  }

  static async deleteTicket(licenseId, ticketId) {
    const item = await LicenseTicket.findOne({ where: { id: ticketId, licenseId } });
    if (!item) throw new NotFoundException("Không tìm thấy ticket trong license");
    await item.destroy();
    return { id: ticketId };
  }

  static async findSoftwareByKey({ licenseKey, softwareId }) {
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
    return software;
  }

  static formatAccessResult(software) {
    return {
      active: true,
      status: software.status,
      customer: { id: software.license.id, name: software.license.customerName, email: software.license.customerEmail },
      software: {
        id: software.id,
        name: software.name,
        type: software.type,
        domain: software.domain,
        enabledFeatures: this.getEnabledFeatures(software.serverConfig),
      },
    };
  }

  static async checkSoftwareAccess(params) {
    const software = await this.findSoftwareByKey(params);
    if (software.status !== "active") throw new ForbiddenException("Phần mềm đã bị khoá hoặc đang có lỗi bản quyền");
    return this.formatAccessResult(software);
  }

  static async checkServerAccess(params) {
    const software = await this.findSoftwareByKey(params);
    if (software.type !== "server") throw new BadRequestException("Software không phải loại server");
    if (software.status !== "active") throw new ForbiddenException("Server đã bị khoá hoặc đang có lỗi bản quyền");
    return this.formatAccessResult(software);
  }
}

module.exports = LicenseService;
