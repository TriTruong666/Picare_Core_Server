const { Op } = require("sequelize");
const HubClient = require("../models/hub_client.model");
const { HubClientDTO } = require("../schemas/hub_client.schema");
const {
  NotFoundException,
  BadRequestException,
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
}

module.exports = HubClientService;
