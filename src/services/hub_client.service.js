const { Op } = require("sequelize");
const HubClient = require("../models/hub_client.model");
const { HubClientDTO } = require("../schemas/hub_client.schema");
const JWTService = require("./jwt.service");
const ErrorCodes = require("../common/exceptions/error_codes");
const {
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} = require("../common/exceptions/BaseException");

class HubClientService {
  /**
   * Get all hub clients with pagination and search
   */
  static async getClientsPaginate({
    page = 1,
    limit = 20,
    search = "",
    status = "",
  } = {}) {
    const where = {};
    if (status) {
      where.clientStatus = status;
    }

    if (search) {
      where[Op.or] = [
        { clientName: { [Op.iLike]: `%${search}%` } },
        { clientDescription: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const pLimit = parseInt(limit);
    const pPage = parseInt(page);
    const offset = (pPage - 1) * pLimit;

    const { count, rows } = await HubClient.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: pLimit,
      offset: offset,
    });

    return {
      count,
      clients: HubClientDTO.fromClients(rows),
      page: pPage,
      limit: pLimit,
      totalPages: Math.ceil(count / pLimit),
    };
  }

  /**
   * Get hub client by its clientId (UUID)
   */
  static async getClientByClientId(clientId) {
    const client = await HubClient.findOne({
      where: { clientId },
    });

    if (!client) {
      throw new NotFoundException("Không tìm thấy Hub Client");
    }

    return HubClientDTO.fromClient(client);
  }

  /**
   * Create a new hub client
   */
  static async createClient(clientData) {
    // Check if client name already exists
    const existingClient = await HubClient.findOne({
      where: { clientName: clientData.clientName },
    });
    if (existingClient) {
      throw new BadRequestException("Tên Hub Client đã tồn tại");
    }

    const newClient = await HubClient.create(clientData);
    return HubClientDTO.fromClient(newClient);
  }

  /**
   * Update hub client information
   */
  static async updateClient(clientId, updateData) {
    const client = await HubClient.findOne({ where: { clientId } });

    if (!client) {
      throw new NotFoundException("Không tìm thấy Hub Client");
    }

    // If updating name, check uniqueness
    if (updateData.clientName && updateData.clientName !== client.clientName) {
      const existingName = await HubClient.findOne({
        where: { clientName: updateData.clientName },
      });
      if (existingName) {
        throw new BadRequestException("Tên Hub Client đã tồn tại");
      }
    }

    await client.update(updateData);
    return HubClientDTO.fromClient(client);
  }

  /**
   * Delete hub client
   */
  static async deleteClient(clientId) {
    const client = await HubClient.findOne({ where: { clientId } });

    if (!client) {
      throw new NotFoundException("Không tìm thấy Hub Client");
    }

    await client.destroy();
    return { message: "Xóa Hub Client thành công" };
  }
  /**
   * Check if the current token holder has access to a specific client.
   * Mirrors getMe pattern: reads token from cookie, decodes role, validates against client's allowedRoles.
   * @param {string} token - JWT token from cookie
   * @param {string} clientId - UUID of the target client
   * @returns {Object} { client: HubClientDTO, user: { name, role, userId } }
   */
  static async checkClientAccess(token, clientId) {
    if (!token) {
      throw new UnauthorizedException(ErrorCodes.UNAUTHORIZED);
    }

    const decoded = JWTService.verify(token);
    if (!decoded) {
      throw new UnauthorizedException(ErrorCodes.UNAUTHORIZED);
    }

    const client = await HubClient.findOne({ where: { clientId } });
    if (!client) {
      throw new NotFoundException(ErrorCodes.CLIENT_NOT_FOUND);
    }

    const allowedRoles = client.allowedRoles || [];
    if (!allowedRoles.includes(decoded.role)) {
      throw new ForbiddenException(ErrorCodes.AUTH_ROLE_NOT_ALLOWED);
    }

    return {
      client: HubClientDTO.fromClient(client),
      user: {
        name: decoded.name,
        role: decoded.role,
        userId: decoded.userId,
      },
    };
  }
}

module.exports = HubClientService;
