const S3Folder = require("../models/s3_folder.model");
const { BadRequestException, NotFoundException } = require("../common/exceptions/BaseException");
const { Op } = require("sequelize");

class S3FolderService {
  /**
   * Tạo thư mục mới
   */
  static async create(data) {
    const existing = await S3Folder.findOne({ where: { name: data.name } });
    if (existing) {
      throw new BadRequestException(`Thư mục với tên "${data.name}" đã tồn tại`);
    }
    return await S3Folder.create(data);
  }

  /**
   * Lấy danh sách thư mục (Phân trang & Tìm kiếm)
   */
  static async getAll({ page = 1, limit = 20, search = "" }) {
    const offset = (page - 1) * limit;
    const where = {};
    
    if (search) {
      where.name = { [Op.iLike]: `%${search}%` };
    }

    return await S3Folder.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["name", "ASC"]],
    });
  }

  /**
   * Lấy chi tiết thư mục theo UUID
   */
  static async getById(folderId) {
    const folder = await S3Folder.findOne({ where: { folderId } });
    if (!folder) {
      throw new NotFoundException("Không tìm thấy thư mục");
    }
    return folder;
  }

  /**
   * Cập nhật thông tin thư mục
   */
  static async update(folderId, data) {
    const folder = await this.getById(folderId);

    if (data.name && data.name !== folder.name) {
      const existing = await S3Folder.findOne({ 
        where: { name: data.name, folderId: { [Op.ne]: folderId } } 
      });
      if (existing) {
        throw new BadRequestException(`Tên thư mục "${data.name}" đã bị trùng`);
      }
    }

    return await folder.update(data);
  }

  /**
   * Xóa thư mục (Cascade delete assets)
   */
  static async delete(folderId) {
    const folder = await this.getById(folderId);
    
    // Lưu ý: Ràng buộc Cascade Delete đã được định nghĩa trong Model Association.
    // Khi xóa Folder record này, Postgres sẽ tự động xóa các S3Asset record liên quan.
    await folder.destroy();
    
    return { message: "Xóa thư mục và các asset liên quan thành công" };
  }
}

module.exports = S3FolderService;
