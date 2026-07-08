const { Op } = require("sequelize");
const { License, LicenseSoftware, LicenseTicket, sequelize } = require("../models");
const { LicenseDTO, SoftwareDTO, TicketDTO } = require("../schemas/license.schema");
const { NotFoundException, ForbiddenException, BadRequestException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

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

  static normalizeSoftwarePayload(payload, currentType) {
    const normalized = { ...payload };
    const type = payload.type || currentType;

    if (type !== "server") {
      if (Array.isArray(payload.serverConfig) && payload.serverConfig.length > 0) {
        throw new BadRequestException("serverConfig chỉ được sử dụng cho phần mềm loại server");
      }
      if (Object.prototype.hasOwnProperty.call(payload, "serverConfig") || payload.type === "client") {
        normalized.serverConfig = null;
      }
    }

    return normalized;
  }

  static async ensureLicense(licenseId, transaction) {
    const license = await License.findOne({ where: { licenseId }, transaction });
    if (!license) throw new NotFoundException(ErrorCodes.LICENSE_NOT_FOUND);
    return license;
  }

  static async createLicense(payload) {
    return sequelize.transaction(async (transaction) => {
      const license = await License.create(this.pick(payload, [
        "customerName", "customerPhone", "customerEmail", "licenseContract", "yearlyCost", "oncePaymentStatus", "note",
      ]), { transaction });

      if (payload.software?.length) {
        await LicenseSoftware.bulkCreate(
          payload.software.map((item) => ({
            ...this.normalizeSoftwarePayload(item),
            licenseId: license.licenseId,
          })),
          { transaction, validate: true },
        );
      }
      return this.getLicenseById(license.licenseId, transaction);
    });
  }

  static async getLicenses({ page = 1, limit = 20, search = "" } = {}) {
    const where = search ? {
      [Op.or]: ["licenseId", "customerName", "customerPhone", "customerEmail"].map((field) => ({
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
    const item = await License.findOne({
      where: { licenseId },
      include: [softwareInclude, ticketInclude],
      transaction,
    });
    if (!item) throw new NotFoundException(ErrorCodes.LICENSE_NOT_FOUND);
    return new LicenseDTO(item);
  }

  static async updateLicense(licenseId, payload) {
    return sequelize.transaction(async (transaction) => {
      const license = await this.ensureLicense(licenseId, transaction);
      await license.update(this.pick(payload, [
        "customerName", "customerPhone", "customerEmail", "licenseContract", "yearlyCost", "oncePaymentStatus", "note",
      ]), { transaction });

      for (const softwarePayload of payload.software || []) {
        const normalizedPayload = this.normalizeSoftwarePayload(softwarePayload);
        const software = await LicenseSoftware.findOne({
          where: { softwareId: normalizedPayload.softwareId },
          transaction,
        });

        if (software && software.licenseId !== licenseId) {
          throw new BadRequestException(`Software ID ${normalizedPayload.softwareId} đã thuộc license khác`);
        }

        if (software) {
          await software.update(this.pick(normalizedPayload, [
            "name", "price", "status", "domain", "type", "serverConfig", "note",
          ]), { transaction });
        } else {
          await LicenseSoftware.create({ ...normalizedPayload, licenseId }, { transaction });
        }
      }

      return this.getLicenseById(licenseId, transaction);
    });
  }

  static async deleteLicense(licenseId) {
    return sequelize.transaction(async (transaction) => {
      const license = await this.ensureLicense(licenseId, transaction);
      await LicenseTicket.destroy({ where: { licenseId: license.licenseId }, transaction });
      await LicenseSoftware.destroy({ where: { licenseId: license.licenseId }, transaction });
      await license.destroy({ transaction });
      return { licenseId };
    });
  }

  static async createSoftware(licenseId, payload) {
    await this.ensureLicense(licenseId);
    const item = await LicenseSoftware.create({
      ...this.normalizeSoftwarePayload(payload),
      licenseId,
    });
    return new SoftwareDTO(item);
  }

  static async getSoftware(licenseId, softwareId) {
    const item = await LicenseSoftware.findOne({ where: { softwareId, licenseId } });
    if (!item) throw new NotFoundException(ErrorCodes.LICENSE_SOFTWARE_NOT_FOUND);
    return new SoftwareDTO(item);
  }

  static async updateSoftware(licenseId, softwareId, payload) {
    const item = await LicenseSoftware.findOne({ where: { softwareId, licenseId } });
    if (!item) throw new NotFoundException(ErrorCodes.LICENSE_SOFTWARE_NOT_FOUND);
    const normalizedPayload = this.normalizeSoftwarePayload(payload, item.type);
    await item.update(this.pick(normalizedPayload, ["softwareId", "name", "price", "status", "domain", "type", "serverConfig", "note"]));
    return new SoftwareDTO(item);
  }

  static async deleteSoftware(licenseId, softwareId) {
    const item = await LicenseSoftware.findOne({ where: { softwareId, licenseId } });
    if (!item) throw new NotFoundException(ErrorCodes.LICENSE_SOFTWARE_NOT_FOUND);
    await item.destroy();
    return { softwareId };
  }

  static async createTicket(licenseId, payload) {
    await this.ensureLicense(licenseId);
    const item = await LicenseTicket.create({ ...payload, licenseId });
    return new TicketDTO(item);
  }

  static async getTickets({ page = 1, limit = 20, search = "", status, licenseId } = {}) {
    const where = {
      ...(status ? { status } : {}),
      ...(licenseId ? { licenseId } : {}),
      ...(search ? {
        [Op.or]: ["title", "message"].map((field) => ({
          [field]: { [Op.iLike]: `%${search}%` },
        })),
      } : {}),
    };
    const { count, rows } = await LicenseTicket.findAndCountAll({
      where,
      include: [{
        model: License,
        as: "license",
        attributes: ["licenseId", "customerName", "customerPhone", "customerEmail"],
      }],
      distinct: true,
      limit,
      offset: (page - 1) * limit,
      order: [["createdAt", "DESC"]],
    });
    return { count, rows: rows.map((item) => new TicketDTO(item)), page, limit };
  }

  static async getTicket(licenseId, ticketId) {
    const item = await LicenseTicket.findOne({ where: { id: ticketId, licenseId } });
    if (!item) throw new NotFoundException(ErrorCodes.LICENSE_TICKET_NOT_FOUND);
    return new TicketDTO(item);
  }

  static async updateTicket(licenseId, ticketId, payload) {
    const item = await LicenseTicket.findOne({ where: { id: ticketId, licenseId } });
    if (!item) throw new NotFoundException(ErrorCodes.LICENSE_TICKET_NOT_FOUND);
    await item.update(this.pick(payload, ["title", "message", "attachments", "status", "cancelReason", "note"]));
    return new TicketDTO(item);
  }

  static async deleteTicket(licenseId, ticketId) {
    const item = await LicenseTicket.findOne({ where: { id: ticketId, licenseId } });
    if (!item) throw new NotFoundException(ErrorCodes.LICENSE_TICKET_NOT_FOUND);
    await item.destroy();
    return { id: ticketId };
  }

  static async findSoftwareByKey({ licenseKey, softwareId }) {
    const software = await LicenseSoftware.findOne({
      where: { softwareId },
      include: [{
        model: License,
        as: "license",
        where: { licenseKey },
        attributes: ["id", "licenseId", "customerName", "customerEmail"],
      }],
    });
    if (!software) throw new NotFoundException(ErrorCodes.LICENSE_CREDENTIALS_INVALID);
    return software;
  }

  static async ensureLicenseAccess({ licenseId, licenseKey }) {
    const license = await License.findOne({
      where: { licenseId, licenseKey },
    });
    if (!license) {
      throw new NotFoundException(ErrorCodes.LICENSE_ACCESS_INVALID);
    }
    return license;
  }

  static formatAccessResult(software) {
    return {
      active: true,
      status: software.status,
      customer: { id: software.license.licenseId, name: software.license.customerName, email: software.license.customerEmail },
      software: {
        id: software.softwareId,
        name: software.name,
        type: software.type,
        domain: software.domain,
        enabledFeatures: this.getEnabledFeatures(software.serverConfig),
      },
    };
  }

  static async checkSoftwareAccess(params) {
    const software = await this.findSoftwareByKey(params);
    if (software.status !== "active") throw new ForbiddenException(ErrorCodes.LICENSE_SOFTWARE_INACTIVE);
    return this.formatAccessResult(software);
  }

  static async checkServerAccess(params) {
    const software = await this.findSoftwareByKey(params);
    if (software.type !== "server") throw new BadRequestException(ErrorCodes.LICENSE_SOFTWARE_NOT_SERVER);
    if (software.status !== "active") throw new ForbiddenException(ErrorCodes.LICENSE_SERVER_INACTIVE);
    return this.formatAccessResult(software);
  }

  static async createPublicTicket({ licenseId, licenseKey, payload }) {
    await this.ensureLicenseAccess({ licenseId, licenseKey });
    const item = await LicenseTicket.create({ ...payload, licenseId });
    return new TicketDTO(item);
  }

  static async getPublicTickets({
    licenseId,
    licenseKey,
    page = 1,
    limit = 20,
    search = "",
    status,
  } = {}) {
    await this.ensureLicenseAccess({ licenseId, licenseKey });

    const where = {
      licenseId,
      ...(status ? { status } : {}),
      ...(search
        ? {
            [Op.or]: ["title", "message"].map((field) => ({
              [field]: { [Op.iLike]: `%${search}%` },
            })),
          }
        : {}),
    };

    const { count, rows } = await LicenseTicket.findAndCountAll({
      where,
      distinct: true,
      limit,
      offset: (page - 1) * limit,
      order: [["createdAt", "DESC"]],
    });

    return {
      count,
      rows: rows.map((item) => new TicketDTO(item)),
      page,
      limit,
    };
  }

  static async getPublicTicket({ licenseId, licenseKey, ticketId }) {
    await this.ensureLicenseAccess({ licenseId, licenseKey });
    const item = await LicenseTicket.findOne({ where: { id: ticketId, licenseId } });
    if (!item) throw new NotFoundException(ErrorCodes.LICENSE_TICKET_NOT_FOUND);
    return new TicketDTO(item);
  }
}

module.exports = LicenseService;
