/**
 * Enum cho S3 Asset
 */

/** Visibility của file: công khai hay private */
const AssetVisibility = {
  PUBLIC: "public",
  PRIVATE: "private",
};

/** Nhóm loại file dựa trên MIME type */
const AssetType = {
  IMAGE: "image",
  VIDEO: "video",
  DOCUMENT: "document",
  AUDIO: "audio",
  OTHER: "other",
};

const ASSET_VISIBILITY = Object.values(AssetVisibility);
const ASSET_TYPE = Object.values(AssetType);

module.exports = {
  AssetVisibility,
  AssetType,
  ASSET_VISIBILITY,
  ASSET_TYPE,
};
