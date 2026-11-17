const PICARE_GROUP_PUBLIC_ID = "picare_group";
const PICARE_GROUP_DB_ID = "00000000-0000-4000-8000-706963617265";
const PICARE_GROUP_NAME = "Đại gia đình - Picare Group";
const PICARE_GROUP_DESCRIPTION =
  "Đây là nhóm chính thức của toàn bộ thành viên của Picare Group, các cuộc thảo luận, sinh hoạt và giải trí sẽ ở trên group này";
const PERSONAL_SPACE_CONTEXT_TYPE = "PERSONAL_SPACE";
const PERSONAL_SPACE_NAME = "Không gian của bạn";
const PERSONAL_SPACE_DESCRIPTION =
  "Không gian lưu trữ cá nhân của riêng bạn — lưu tin nhắn, ghi chú, liên kết và tài liệu riêng tư.";
const SYSTEM_ADMIN_USER_ID = "25d3eb75-03fe-4208-a685-845ec606e2d8";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveDbConversationId(id) {
  if (!id) return id;
  return String(id).trim() === PICARE_GROUP_PUBLIC_ID ? PICARE_GROUP_DB_ID : id;
}

function toPublicConversationId(id) {
  if (!id) return id;
  return String(id).trim() === PICARE_GROUP_DB_ID ? PICARE_GROUP_PUBLIC_ID : id;
}

function isValidConversationIdentifier(id) {
  if (!id || typeof id !== "string") return false;
  const trimmed = id.trim();
  return trimmed === PICARE_GROUP_PUBLIC_ID || UUID_REGEX.test(trimmed);
}

module.exports = {
  PICARE_GROUP_PUBLIC_ID,
  PICARE_GROUP_DB_ID,
  PICARE_GROUP_NAME,
  PICARE_GROUP_DESCRIPTION,
  PERSONAL_SPACE_CONTEXT_TYPE,
  PERSONAL_SPACE_NAME,
  PERSONAL_SPACE_DESCRIPTION,
  SYSTEM_ADMIN_USER_ID,
  resolveDbConversationId,
  toPublicConversationId,
  isValidConversationIdentifier,
};
