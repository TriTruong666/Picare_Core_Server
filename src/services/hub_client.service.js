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
const { ClientStatus } = require("../common/enum/hub_client.enum");

class HubClientService {
  static normalizeRole(role) {
    return String(role || "").trim().toLowerCase();
  }

  static normalizeUrl(url) {
    const rawUrl = String(url || "").trim();
    if (!rawUrl) {
      return null;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch (error) {
      throw new BadRequestException("External URL khong hop le");
    }

    const pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
    return `${parsedUrl.protocol.toLowerCase()}//${parsedUrl.host.toLowerCase()}${pathname}${parsedUrl.search}`;
  }

  static extractOrigin(url) {
    const normalizedUrl = this.normalizeUrl(url);
    return new URL(normalizedUrl).origin.toLowerCase();
  }

  static extractTokenFromRequest(req) {
    const authorization = req.headers?.authorization;
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : null;

    return req.cookies?.token || bearerToken || null;
  }

  static ensureRoleAllowed(role, allowedRoles = []) {
    const normalizedRole = this.normalizeRole(role);
    const normalizedAllowedRoles = allowedRoles.map((item) => this.normalizeRole(item));

    if (!normalizedAllowedRoles.includes(normalizedRole)) {
      throw new ForbiddenException(ErrorCodes.AUTH_ROLE_NOT_ALLOWED);
    }
  }

  static ensureClientActive(client) {
    if (client.clientStatus !== ClientStatus.ACTIVE) {
      throw new ForbiddenException(ErrorCodes.FORBIDDEN);
    }
  }

  static async findClientByExternalUrl(externalUrl) {
    const normalizedTargetOrigin = this.extractOrigin(externalUrl);
    const clients = await HubClient.findAll();

    const client = clients.find((item) => {
      try {
        return this.extractOrigin(item.clientExternalUrl) === normalizedTargetOrigin;
      } catch (error) {
        return false;
      }
    });

    if (!client) {
      throw new NotFoundException(ErrorCodes.CLIENT_NOT_FOUND);
    }

    return client;
  }

  static async validateAccessToClient({ role, clientId, externalUrl }) {
    let client = null;

    if (clientId) {
      client = await HubClient.findOne({ where: { clientId } });
    } else if (externalUrl) {
      client = await this.findClientByExternalUrl(externalUrl);
    } else {
      throw new BadRequestException("Thieu clientId hoac externalUrl de kiem tra quyen");
    }

    if (!client) {
      throw new NotFoundException(ErrorCodes.CLIENT_NOT_FOUND);
    }

    this.ensureClientActive(client);
    this.ensureRoleAllowed(role, client.allowedRoles || []);

    return client;
  }

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
      offset,
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
      throw new NotFoundException("Khong tim thay Hub Client");
    }

    return HubClientDTO.fromClient(client);
  }

  /**
   * Create a new hub client
   */
  static async createClient(clientData) {
    const existingClient = await HubClient.findOne({
      where: { clientName: clientData.clientName },
    });
    if (existingClient) {
      throw new BadRequestException("Ten Hub Client da ton tai");
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
      throw new NotFoundException("Khong tim thay Hub Client");
    }

    if (updateData.clientName && updateData.clientName !== client.clientName) {
      const existingName = await HubClient.findOne({
        where: { clientName: updateData.clientName },
      });
      if (existingName) {
        throw new BadRequestException("Ten Hub Client da ton tai");
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
      throw new NotFoundException("Khong tim thay Hub Client");
    }

    await client.destroy();
    return { message: "Xoa Hub Client thanh cong" };
  }

  /**
   * Check access by clientId for the current token.
   */
  static async checkClientAccess(token, clientId) {
    if (!token) {
      throw new UnauthorizedException(ErrorCodes.UNAUTHORIZED);
    }

    const decoded = JWTService.verify(token);
    if (!decoded) {
      throw new UnauthorizedException(ErrorCodes.UNAUTHORIZED);
    }

    await this.validateAccessToClient({ role: decoded.role, clientId });
    return null;
  }

  /**
   * Check access by external URL for the current token.
   */
  static async checkClientAccessByExternalUrl(token, externalUrl) {
    if (!token) {
      throw new UnauthorizedException(ErrorCodes.UNAUTHORIZED);
    }

    const decoded = JWTService.verify(token);
    if (!decoded) {
      throw new UnauthorizedException(ErrorCodes.UNAUTHORIZED);
    }

    await this.validateAccessToClient({ role: decoded.role, externalUrl });
    return null;
  }
}

module.exports = HubClientService;
