const S3Folder = require("../models/s3_folder.model");
const S3Asset = require("../models/s3_asset.model");
const S3Service = require("./s3.service");
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
   * Xóa thư mục và toàn bộ asset + object S3 liên quan.
   */
  static async delete(folderId) {
    const folder = await this.getById(folderId);

    const assets = await S3Asset.findAll({
      where: { folderId },
      attributes: ["id", "s3Key"],
    });

    const keys = assets.map((asset) => asset.s3Key).filter(Boolean);
    if (keys.length > 0) {
      await S3Service.deleteMany(keys);
    }

    for (const asset of assets) {
      await asset.destroy();
    }

    await folder.destroy();

    return { message: "Xóa thư mục, asset DB và dữ liệu S3 liên quan thành công" };
  }
}

module.exports = S3FolderService;
