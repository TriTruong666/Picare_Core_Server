const { Op } = require("sequelize");
const { randomUUID } = require("crypto");
const sequelize = require("../config/postgres.config");
const Catalogue = require("../models/catalogue/catalogue.model");
const CatalogueDetail = require("../models/catalogue/catalogue_detail.model");
const S3Service = require("./s3.service");
const { AssetVisibility } = require("../common/enum/s3_asset.enum");
const { NotFoundException } = require("../common/exceptions/BaseException");
const { CatalogueDTO } = require("../schemas/catalogue.schema");

// Catalogue assets are intentionally kept in the shared public S3 folder.
// This value is server-owned; clients cannot override it in the request payload.
const CATALOGUE_FOLDER = "public";

class CatalogueService {
  async findModel(catalogueId) {
    const catalogue = await Catalogue.findOne({
      where: { catalogueId },
      include: [{ model: CatalogueDetail, as: "details" }],
      order: [[{ model: CatalogueDetail, as: "details" }, "sortOrder", "ASC"]],
    });

    if (!catalogue) throw new NotFoundException("Không tìm thấy catalogue");
    return catalogue;
  }

  async uploadImages(imageFiles, uploadedBy) {
    if (!imageFiles?.length) return [];

    return Promise.all(
      imageFiles.map((file) =>
        S3Service.upload({
          // UUID prevents a same-name batch uploaded in the same millisecond
          // from generating duplicate S3 object keys.
          key: S3Service.buildKey(CATALOGUE_FOLDER, `${randomUUID()}-${file.originalname}`),
          body: file.buffer,
          mimeType: file.mimetype,
          originalName: file.originalname,
          fileSize: file.size,
          folder: CATALOGUE_FOLDER,
          uploadedBy,
          visibility: AssetVisibility.PUBLIC,
          description: `Catalogue image ${file.originalname}`,
        }),
      ),
    );
  }

  async cleanupAssets(assets) {
    await Promise.allSettled(
      assets.filter((asset) => asset?.key).map((asset) => S3Service.deleteAndRecord(asset.key)),
    );
  }

  async list({
    page = 1,
    limit = 20,
    search = "",
    status,
    sortBy = "createdAt",
    sortOrder = "DESC",
  }) {
    const where = {};
    if (search) where.catalogueName = { [Op.iLike]: `%${search}%` };
    if (status) where.status = status;
    const parsedPage = Number(page);
    const parsedLimit = Number(limit);
    const { count, rows } = await Catalogue.findAndCountAll({
      where,
      distinct: true,
      include: [{ model: CatalogueDetail, as: "details" }],
      order: [
        [sortBy, sortOrder],
        [{ model: CatalogueDetail, as: "details" }, "sortOrder", "ASC"],
      ],
      limit: parsedLimit,
      offset: (parsedPage - 1) * parsedLimit,
    });
    return { count, page: parsedPage, limit: parsedLimit, rows: rows.map(CatalogueDTO.fromCatalogue) };
  }

  async get(catalogueId) {
    return CatalogueDTO.fromCatalogue(await this.findModel(catalogueId));
  }

  async create({ catalogueName, status = "ACTIVE", note = null, imageFiles = [], uploadedBy = null }) {
    let assets = [];
    try {
      assets = await this.uploadImages(imageFiles, uploadedBy);
      const catalogue = await sequelize.transaction(async (transaction) => {
        const record = await Catalogue.create({ catalogueName, status, note }, { transaction });
        await CatalogueDetail.bulkCreate(
          assets.map((asset, index) => ({
            catalogueId: record.catalogueId,
            imageUrl: asset.url,
            imageKey: asset.key,
            sortOrder: index,
          })),
          { transaction },
        );
        return record;
      });
      return this.get(catalogue.catalogueId);
    } catch (error) {
      await this.cleanupAssets(assets);
      throw error;
    }
  }

  async update(catalogueId, payload, { imageFiles = [], uploadedBy = null, removeDetailIds = [] } = {}) {
    const catalogue = await this.findModel(catalogueId);
    const requestedRemovals = new Set(removeDetailIds);
    const detailsToRemove = catalogue.details.filter((detail) => requestedRemovals.has(detail.catalogueDetailId));
    let assets = [];

    try {
      assets = await this.uploadImages(imageFiles, uploadedBy);
      await sequelize.transaction(async (transaction) => {
        const updatePayload = {};
        ["catalogueName", "status", "note"].forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(payload, field)) updatePayload[field] = payload[field];
        });
        if (Object.keys(updatePayload).length) await catalogue.update(updatePayload, { transaction });
        if (detailsToRemove.length) {
          await CatalogueDetail.destroy({
            where: {
              catalogueId,
              catalogueDetailId: detailsToRemove.map((detail) => detail.catalogueDetailId),
            },
            transaction,
          });
        }
        if (assets.length) {
          const maxSortOrder = catalogue.details.reduce((max, item) => Math.max(max, item.sortOrder), -1);
          await CatalogueDetail.bulkCreate(assets.map((asset, index) => ({
            catalogueId,
            imageUrl: asset.url,
            imageKey: asset.key,
            sortOrder: maxSortOrder + index + 1,
          })), { transaction });
        }
      });
    } catch (error) {
      await this.cleanupAssets(assets);
      throw error;
    }

    await this.cleanupAssets(detailsToRemove.map((detail) => ({ key: detail.imageKey })));
    return this.get(catalogueId);
  }

  async deleteDetail(catalogueId, catalogueDetailId) {
    const detail = await CatalogueDetail.findOne({ where: { catalogueId, catalogueDetailId } });
    if (!detail) throw new NotFoundException("Không tìm thấy hình ảnh catalogue");
    await S3Service.deleteAndRecord(detail.imageKey);
    await detail.destroy();
  }

  async delete(catalogueId) {
    const catalogue = await this.findModel(catalogueId);
    await Promise.all(
      catalogue.details.map((detail) => S3Service.deleteAndRecord(detail.imageKey)),
    );
    await catalogue.destroy();
  }
}

module.exports = new CatalogueService();
