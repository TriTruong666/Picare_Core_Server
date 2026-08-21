const { Op } = require("sequelize");
const HubClient = require("../models/hub_client.model");
const { HubClientDTO } = require("../schemas/hub_client.schema");
const JWTService = require("./jwt.service");
const S3Service = require("./s3.service");
const mime = require("mime-types");
const ErrorCodes = require("../common/exceptions/error_codes");
const {
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} = require("../common/exceptions/BaseException");
const { ClientStatus } = require("../common/enum/hub_client.enum");

const HUB_CLIENT_S3_FOLDER = "hub_clients";

async function resolveAndUploadImage({
  file,
  rawValue,
  fallbackUrl = null,
  clientId = null,
  uploadedBy = null,
  description = "Hub client image",
}) {
  // 1. If multer file is provided (Buffer)
  if (file && file.buffer) {
    const originalName = file.originalname || `hub_client_${Date.now()}.png`;
    const key = S3Service.buildKey(HUB_CLIENT_S3_FOLDER, originalName);
    const result = await S3Service.upload({
      key,
      body: file.buffer,
      mimeType: file.mimetype || "image/png",
      originalName,
      fileSize: file.size || file.buffer.length,
      folder: HUB_CLIENT_S3_FOLDER,
      clientId,
      uploadedBy,
      description,
      visibility: "public",
    });
    return result.url;
  }

  // 2. If rawValue is provided as string
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) return null;

    // Check if it is base64 data URI (data:image/...;base64,...)
    const base64Match = trimmed.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (base64Match && base64Match.length === 3) {
      const mimeType = base64Match[1];
      const buffer = Buffer.from(base64Match[2], "base64");
      const ext = mime.extension(mimeType) || mimeType.split("/")[1] || "png";
      const originalName = `hub_client_${Date.now()}.${ext}`;
      const key = S3Service.buildKey(HUB_CLIENT_S3_FOLDER, originalName);
      const result = await S3Service.upload({
        key,
        body: buffer,
        mimeType,
        originalName,
        fileSize: buffer.length,
        folder: HUB_CLIENT_S3_FOLDER,
        clientId,
        uploadedBy,
        description,
        visibility: "public",
      });
      return result.url;
    }

    // Check if it is raw base64 string
    if (
      trimmed.length > 500 &&
      !trimmed.startsWith("http://") &&
      !trimmed.startsWith("https://")
    ) {
      try {
        const buffer = Buffer.from(trimmed, "base64");
        const originalName = `hub_client_${Date.now()}.png`;
        const key = S3Service.buildKey(HUB_CLIENT_S3_FOLDER, originalName);
        const result = await S3Service.upload({
          key,
          body: buffer,
          mimeType: "image/png",
          originalName,
          fileSize: buffer.length,
          folder: HUB_CLIENT_S3_FOLDER,
          clientId,
          uploadedBy,
          description,
          visibility: "public",
        });
        return result.url;
      } catch (_) {
        // Fallback to URL
      }
    }

    // Already a regular URL
    return trimmed;
  }

  return fallbackUrl;
}

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
      throw new BadRequestException(ErrorCodes.HUB_CLIENT_EXTERNAL_URL_INVALID);
    }

    const pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
    return `${parsedUrl.protocol.toLowerCase()}//${parsedUrl.host.toLowerCase()}${pathname}${parsedUrl.search}`;
  }

  static normalizeNullableValue(value) {
    const rawValue = String(value ?? "").trim();
    return rawValue ? rawValue : null;
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

  static async findClientByExternalUrl(externalUrl, role = null) {
    const normalizedTargetOrigin = this.extractOrigin(externalUrl);
    const clients = await HubClient.findAll();

    const matchingClients = clients.filter((item) => {
      try {
        return this.extractOrigin(item.clientExternalUrl) === normalizedTargetOrigin;
      } catch (error) {
        return false;
      }
    });

    if (!matchingClients.length) {
      throw new NotFoundException(ErrorCodes.CLIENT_NOT_FOUND);
    }

    if (role) {
      const normalizedRole = this.normalizeRole(role);
      const matchedByRole = matchingClients.find((item) => {
        const allowedRoles = (item.allowedRoles || []).map((r) => this.normalizeRole(r));
        return allowedRoles.includes(normalizedRole);
      });

      if (matchedByRole) {
        return matchedByRole;
      }
    }

    return matchingClients[0];
  }

  static async validateAccessToClient({ role, clientId, externalUrl }) {
    let client = null;

    // Priority 1: Check by clientId if provided
    if (clientId) {
      client = await HubClient.findOne({ where: { clientId } });
    }

    // Priority 2: Fallback to externalUrl (with role-aware selection if multiple clients match URL)
    if (!client && externalUrl) {
      client = await this.findClientByExternalUrl(externalUrl, role);
    }

    if (!client) {
      if (clientId || externalUrl) {
        throw new NotFoundException(ErrorCodes.CLIENT_NOT_FOUND);
      }
      throw new BadRequestException(ErrorCodes.HUB_CLIENT_PERMISSION_INPUT_MISSING);
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
      throw new NotFoundException(ErrorCodes.HUB_CLIENT_NOT_FOUND);
    }

    return HubClientDTO.fromClient(client);
  }

  /**
   * Create a new hub client (handles image upload to S3 directly)
   */
  static async createClient(clientData, options = {}) {
    const { files = {}, uploadedBy = null } = options;
    const safeClientData = clientData || {};
    const existingClient = await HubClient.findOne({
      where: { clientName: safeClientData.clientName },
    });
    if (existingClient) {
      throw new BadRequestException(ErrorCodes.HUB_CLIENT_NAME_TAKEN);
    }

    let allowedRoles = safeClientData.allowedRoles;
    if (typeof allowedRoles === "string") {
      try {
        allowedRoles = JSON.parse(allowedRoles);
      } catch (_) {
        allowedRoles = allowedRoles.split(",").map((r) => r.trim()).filter(Boolean);
      }
    }

    const logoFile =
      files?.logoFile?.[0] ||
      files?.clientLogoImage?.[0] ||
      files?.logo?.[0] ||
      null;
    const mockupFile =
      files?.mockupFile?.[0] ||
      files?.clientMockupImage?.[0] ||
      files?.mockup?.[0] ||
      null;

    const logoUrl = await resolveAndUploadImage({
      file: logoFile,
      rawValue: safeClientData.clientLogoImage || safeClientData.logoFile,
      uploadedBy,
      description: `Hub client logo - ${safeClientData.clientName || "new-client"}`,
    });

    const mockupUrl = await resolveAndUploadImage({
      file: mockupFile,
      rawValue: safeClientData.clientMockupImage || safeClientData.mockupFile,
      uploadedBy,
      description: `Hub client mockup - ${safeClientData.clientName || "new-client"}`,
    });

    const {
      clientInternalUrl: _clientInternalUrl,
      clientLogoImage: _cli,
      clientMockupImage: _cmi,
      logoFile: _lf,
      mockupFile: _mf,
      ...createData
    } = safeClientData;

    const newClient = await HubClient.create({
      ...createData,
      clientLogoImage: logoUrl,
      clientMockupImage: mockupUrl,
      allowedRoles: Array.isArray(allowedRoles) ? allowedRoles : ["admin"],
      clientInternalUrl: null,
    });
    return HubClientDTO.fromClient(newClient);
  }

  /**
   * Update hub client information (handles image upload to S3 directly)
   */
  static async updateClient(clientId, updateData, options = {}) {
    const { files = {}, uploadedBy = null } = options;
    const safeUpdateData = updateData || {};
    const client = await HubClient.findOne({ where: { clientId } });

    if (!client) {
      throw new NotFoundException(ErrorCodes.HUB_CLIENT_NOT_FOUND);
    }

    if (safeUpdateData.clientName && safeUpdateData.clientName !== client.clientName) {
      const existingName = await HubClient.findOne({
        where: { clientName: safeUpdateData.clientName },
      });
      if (existingName) {
        throw new BadRequestException(ErrorCodes.HUB_CLIENT_NAME_TAKEN);
      }
    }

    let allowedRoles = safeUpdateData.allowedRoles;
    if (typeof allowedRoles === "string") {
      try {
        allowedRoles = JSON.parse(allowedRoles);
      } catch (_) {
        allowedRoles = allowedRoles.split(",").map((r) => r.trim()).filter(Boolean);
      }
    }

    const logoFile =
      files?.logoFile?.[0] ||
      files?.clientLogoImage?.[0] ||
      files?.logo?.[0] ||
      null;
    const mockupFile =
      files?.mockupFile?.[0] ||
      files?.clientMockupImage?.[0] ||
      files?.mockup?.[0] ||
      null;

    let logoUrl = client.clientLogoImage;
    if (
      logoFile ||
      Object.prototype.hasOwnProperty.call(safeUpdateData, "clientLogoImage") ||
      Object.prototype.hasOwnProperty.call(safeUpdateData, "logoFile")
    ) {
      logoUrl = await resolveAndUploadImage({
        file: logoFile,
        rawValue:
          safeUpdateData.clientLogoImage !== undefined
            ? safeUpdateData.clientLogoImage
            : safeUpdateData.logoFile,
        fallbackUrl: client.clientLogoImage,
        clientId,
        uploadedBy,
        description: `Hub client logo - ${clientId}`,
      });
    }

    let mockupUrl = client.clientMockupImage;
    if (
      mockupFile ||
      Object.prototype.hasOwnProperty.call(safeUpdateData, "clientMockupImage") ||
      Object.prototype.hasOwnProperty.call(safeUpdateData, "mockupFile")
    ) {
      mockupUrl = await resolveAndUploadImage({
        file: mockupFile,
        rawValue:
          safeUpdateData.clientMockupImage !== undefined
            ? safeUpdateData.clientMockupImage
            : safeUpdateData.mockupFile,
        fallbackUrl: client.clientMockupImage,
        clientId,
        uploadedBy,
        description: `Hub client mockup - ${clientId}`,
      });
    }

    const {
      logoFile: _lf,
      mockupFile: _mf,
      ...cleanedUpdateData
    } = safeUpdateData;

    const normalizedUpdateData = {
      ...cleanedUpdateData,
      clientLogoImage: logoUrl,
      clientMockupImage: mockupUrl,
      ...(allowedRoles !== undefined && {
        allowedRoles: Array.isArray(allowedRoles)
          ? allowedRoles
          : client.allowedRoles,
      }),
      clientInternalUrl:
        Object.prototype.hasOwnProperty.call(
          safeUpdateData,
          "clientInternalUrl",
        )
          ? this.normalizeNullableValue(safeUpdateData.clientInternalUrl)
          : safeUpdateData.clientInternalUrl,
    };

    await client.update(normalizedUpdateData);
    return HubClientDTO.fromClient(client);
  }

  /**
   * Delete hub client
   */
  static async deleteClient(clientId) {
    const client = await HubClient.findOne({ where: { clientId } });

    if (!client) {
      throw new NotFoundException(ErrorCodes.HUB_CLIENT_NOT_FOUND);
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
   * Check access by external URL (and optional clientId) for the current token.
   */
  static async checkClientAccessByExternalUrl(token, externalUrl, clientId = null) {
    if (!token) {
      throw new UnauthorizedException(ErrorCodes.UNAUTHORIZED);
    }

    const decoded = JWTService.verify(token);
    if (!decoded) {
      throw new UnauthorizedException(ErrorCodes.UNAUTHORIZED);
    }

    await this.validateAccessToClient({ role: decoded.role, clientId, externalUrl });
    return null;
  }
}

module.exports = HubClientService;
