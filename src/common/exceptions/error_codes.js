/**
 * Centralized error codes for the application.
 */
const ErrorCodes = {
  INTERNAL_SERVER_ERROR: {
    code: "ERR_INTERNAL_001",
    message: "Đã có lỗi xảy ra phía máy chủ",
    statusCode: 500,
  },
  BAD_REQUEST: {
    code: "ERR_BAD_REQUEST_001",
    message: "Dữ liệu yêu cầu không hợp lệ",
    statusCode: 400,
  },
  UNAUTHORIZED: {
    code: "ERR_UNAUTHORIZED_001",
    message: "Phiên đăng nhập đã hết hạn hoặc không hợp lệ",
    statusCode: 401,
  },
  FORBIDDEN: {
    code: "ERR_FORBIDDEN_001",
    message: "Bạn không có quyền thực hiện hành động này",
    statusCode: 403,
  },
  NOT_FOUND: {
    code: "ERR_NOT_FOUND_001",
    message: "Không tìm thấy tài nguyên yêu cầu",
    statusCode: 404,
  },

  DATABASE_ERROR: {
    code: "ERR_DB_001",
    message: "Lỗi kết nối cơ sở dữ liệu",
    statusCode: 500,
  },
  DUPLICATE_ENTRY: {
    code: "ERR_DB_002",
    message: "Dữ liệu đã tồn tại trong hệ thống",
    statusCode: 409,
  },

  AUTH_INVALID_CREDENTIALS: {
    code: "ERR_AUTH_001",
    message: "Email hoặc mật khẩu không chính xác",
    statusCode: 401,
  },
  AUTH_EMAIL_TAKEN: {
    code: "ERR_AUTH_002",
    message: "Email đã được sử dụng",
    statusCode: 400,
  },
  AUTH_ROLE_NOT_ALLOWED: {
    code: "ERR_AUTH_003",
    message: "Tài khoản của bạn không có quyền truy cập vào hệ thống này",
    statusCode: 403,
  },
  AUTH_OLD_PASSWORD_INCORRECT: {
    code: "ERR_AUTH_004",
    message: "Mật khẩu cũ không chính xác",
    statusCode: 400,
  },
  AUTH_NEW_PASSWORD_MUST_DIFFERENT: {
    code: "ERR_AUTH_005",
    message: "Mật khẩu mới phải khác mật khẩu cũ",
    statusCode: 400,
  },
  CLIENT_NOT_FOUND: {
    code: "ERR_CLIENT_001",
    message: "Không tìm thấy client hệ thống",
    statusCode: 404,
  },

  USER_NOT_FOUND: {
    code: "ERR_USER_001",
    message: "Không tìm thấy người dùng",
    statusCode: 400,
  },
  USER_ROLE_REQUIRED: {
    code: "ERR_USER_002",
    message: "Role không được để trống",
    statusCode: 400,
  },
  COMPANY_NOT_FOUND: {
    code: "ERR_COMPANY_001",
    message: "Không tìm thấy công ty",
    statusCode: 404,
  },
  SHOP_NOT_FOUND: {
    code: "ERR_SHOP_001",
    message: "Không tìm thấy shop",
    statusCode: 404,
  },
  ORDER_NOT_FOUND: {
    code: "ERR_ORDER_001",
    message: "Không tìm thấy đơn hàng",
    statusCode: 404,
  },

  APP_CONFIG_NOT_FOUND: {
    code: "ERR_CONFIG_001",
    message: "Không tìm thấy cấu hình chính trong cơ sở dữ liệu",
    statusCode: 500,
  },
  FPT_AI_API_KEY_MISSING: {
    code: "ERR_FPT_AI_001",
    message: "Chưa cấu hình FPT_AI_API_KEY",
    statusCode: 400,
  },
  FPT_AI_URL_MISSING: {
    code: "ERR_FPT_AI_002",
    message: "Chưa cấu hình FPT_AI_ID_RECOGNITION_URL",
    statusCode: 400,
  },
  FPT_AI_INVALID_ID_IMAGE: {
    code: "ERR_FPT_AI_003",
    message: "File ảnh CMND/CCCD không hợp lệ",
    statusCode: 400,
  },
  FPT_AI_INVALID_RESPONSE: {
    code: "ERR_FPT_AI_004",
    message: "FPT AI trả về response không phải JSON",
    statusCode: 400,
  },
  FPT_AI_REQUEST_FAILED: {
    code: "ERR_FPT_AI_005",
    message: "Gọi FPT AI thất bại",
    statusCode: 400,
  },
  FPT_AI_RECOGNITION_FAILED: {
    code: "ERR_FPT_AI_006",
    message: "FPT AI không nhận diện được ảnh CMND/CCCD",
    statusCode: 400,
  },

  LICENSE_NOT_FOUND: {
    code: "ERR_LICENSE_001",
    message: "Không tìm thấy license",
    statusCode: 404,
  },
  LICENSE_SOFTWARE_NOT_FOUND: {
    code: "ERR_LICENSE_002",
    message: "Không tìm thấy phần mềm trong license",
    statusCode: 404,
  },
  LICENSE_TICKET_NOT_FOUND: {
    code: "ERR_LICENSE_003",
    message: "Không tìm thấy ticket trong license",
    statusCode: 404,
  },
  LICENSE_CREDENTIALS_INVALID: {
    code: "ERR_LICENSE_004",
    message: "License key hoặc software ID không hợp lệ",
    statusCode: 404,
  },
  LICENSE_SOFTWARE_INACTIVE: {
    code: "ERR_LICENSE_005",
    message: "Phần mềm đã bị khóa hoặc đang có lỗi bản quyền",
    statusCode: 403,
  },
  LICENSE_SOFTWARE_NOT_SERVER: {
    code: "ERR_LICENSE_006",
    message: "Software không phải loại server",
    statusCode: 400,
  },
  LICENSE_SERVER_INACTIVE: {
    code: "ERR_LICENSE_007",
    message: "Server đã bị khóa hoặc đang có lỗi bản quyền",
    statusCode: 403,
  },
  LICENSE_ACCESS_INVALID: {
    code: "ERR_LICENSE_008",
    message: "License ID hoặc license key không hợp lệ",
    statusCode: 404,
  },

  QR_PRODUCT_NOT_FOUND: {
    code: "ERR_QR_001",
    message: "Không tìm thấy QR sản phẩm",
    statusCode: 404,
  },
  S3_MAIN_VIDEO_NOT_FOUND: (key) => ({
    code: "ERR_S3_001",
    message: `Video chính không tồn tại: ${key}`,
    statusCode: 400,
  }),
  S3_SECOND_VIDEO_NOT_FOUND: (key) => ({
    code: "ERR_S3_002",
    message: `Video phụ không tồn tại: ${key}`,
    statusCode: 400,
  }),
  S3_FOLDER_DUPLICATE: (name) => ({
    code: "ERR_S3_FOLDER_001",
    message: `Thư mục với tên \"${name}\" đã tồn tại`,
    statusCode: 400,
  }),
  S3_FOLDER_NOT_FOUND: {
    code: "ERR_S3_FOLDER_002",
    message: "Không tìm thấy thư mục",
    statusCode: 404,
  },
  S3_FOLDER_NAME_DUPLICATE: (name) => ({
    code: "ERR_S3_FOLDER_003",
    message: `Tên thư mục \"${name}\" đã bị trùng`,
    statusCode: 400,
  }),

  HUB_CLIENT_EXTERNAL_URL_INVALID: {
    code: "ERR_HUB_CLIENT_002",
    message: "External URL không hợp lệ",
    statusCode: 400,
  },
  HUB_CLIENT_PERMISSION_INPUT_MISSING: {
    code: "ERR_HUB_CLIENT_003",
    message: "Thiếu clientId hoặc externalUrl để kiểm tra quyền",
    statusCode: 400,
  },
  HUB_CLIENT_NOT_FOUND: {
    code: "ERR_HUB_CLIENT_004",
    message: "Không tìm thấy Hub Client",
    statusCode: 404,
  },
  HUB_CLIENT_NAME_TAKEN: {
    code: "ERR_HUB_CLIENT_005",
    message: "Tên Hub Client đã tồn tại",
    statusCode: 400,
  },

  CHAT_MEMBER_REQUIRED: {
    code: "ERR_CHAT_001",
    message: "Phải có ít nhất 1 thành viên khác",
    statusCode: 400,
  },
  CHAT_PRIVATE_MEMBER_COUNT_INVALID: {
    code: "ERR_CHAT_002",
    message: "Chat riêng chỉ được có đúng 2 thành viên",
    statusCode: 400,
  },
  CHAT_GROUP_NAME_REQUIRED: {
    code: "ERR_CHAT_003",
    message: "Nhóm chat phải có tên",
    statusCode: 400,
  },
  CHAT_NOT_MEMBER: {
    code: "ERR_CHAT_004",
    message: "Bạn không phải thành viên",
    statusCode: 403,
  },
  CHAT_NOT_CONVERSATION_MEMBER: {
    code: "ERR_CHAT_005",
    message: "Bạn không phải thành viên của cuộc hội thoại này",
    statusCode: 403,
  },
  CHAT_CONVERSATION_NOT_FOUND: {
    code: "ERR_CHAT_006",
    message: "Không tìm thấy cuộc hội thoại",
    statusCode: 404,
  },
  CHAT_GROUP_UPDATE_FORBIDDEN: {
    code: "ERR_CHAT_007",
    message: "Chỉ owner hoặc admin mới có thể cập nhật nhóm",
    statusCode: 403,
  },
  CHAT_ONLY_GROUP_UPDATE: {
    code: "ERR_CHAT_008",
    message: "Chỉ có thể cập nhật thông tin nhóm chat",
    statusCode: 400,
  },
  CHAT_ADD_MEMBER_FORBIDDEN: {
    code: "ERR_CHAT_009",
    message: "Chỉ owner/admin mới được thêm thành viên",
    statusCode: 403,
  },
  CHAT_ONLY_GROUP_ADD_MEMBER: {
    code: "ERR_CHAT_010",
    message: "Chỉ có thể thêm thành viên vào nhóm chat",
    statusCode: 400,
  },
  CHAT_REMOVE_MEMBER_FORBIDDEN: {
    code: "ERR_CHAT_011",
    message: "Chỉ owner/admin mới có thể xóa thành viên",
    statusCode: 403,
  },
  CHAT_MESSAGE_EMPTY: {
    code: "ERR_CHAT_012",
    message: "Nội dung tin nhắn không được để trống",
    statusCode: 400,
  },
  CHAT_MESSAGE_NOT_FOUND: {
    code: "ERR_CHAT_013",
    message: "Không tìm thấy tin nhắn",
    statusCode: 404,
  },
  CHAT_EDIT_OWN_MESSAGE_ONLY: {
    code: "ERR_CHAT_014",
    message: "Bạn chỉ có thể chỉnh sửa tin nhắn của chính mình",
    statusCode: 403,
  },
  CHAT_TEXT_MESSAGE_EDIT_ONLY: {
    code: "ERR_CHAT_015",
    message: "Chỉ có thể chỉnh sửa tin nhắn văn bản",
    statusCode: 400,
  },
  CHAT_DELETE_OWN_MESSAGE_ONLY: {
    code: "ERR_CHAT_016",
    message: "Bạn chỉ có thể xóa tin nhắn của chính mình",
    statusCode: 403,
  },

  MAIL_SMTP_CONFIG_MISSING: (fields) => ({
    code: "ERR_MAIL_001",
    message: `Thiếu cấu hình SMTP: ${fields.join(", ")}`,
    statusCode: 500,
  }),
  MAIL_TO_REQUIRED: {
    code: "ERR_MAIL_002",
    message: "Trường to là bắt buộc",
    statusCode: 400,
  },
  MAIL_SUBJECT_REQUIRED: {
    code: "ERR_MAIL_003",
    message: "Trường subject là bắt buộc",
    statusCode: 400,
  },
  MAIL_CONTENT_REQUIRED: {
    code: "ERR_MAIL_004",
    message: "Phải có ít nhất text hoặc html",
    statusCode: 400,
  },
  MAIL_SEND_FAILED: (message) => ({
    code: "ERR_MAIL_005",
    message: `Gửi mail thất bại: ${message}`,
    statusCode: 500,
  }),

  CONTRACT_DRAFT_MUST_BE_PUBLISHED: {
    code: "ERR_CONTRACT_001",
    message:
      "Hợp đồng đang ở trạng thái nháp, cần phát hành bản unsigned trước khi ký",
    statusCode: 400,
  },
  CONTRACT_SIGNING_COMPLETED: {
    code: "ERR_CONTRACT_002",
    message: "Hợp đồng đã hoàn tất ký",
    statusCode: 400,
  },
  CONTRACT_OWNER_MUST_SIGN_FIRST: {
    code: "ERR_CONTRACT_003",
    message: "Owner phải ký trước",
    statusCode: 400,
  },
  CONTRACT_PARTNER_MUST_SIGN_AFTER_OWNER: {
    code: "ERR_CONTRACT_004",
    message: "Partner phải ký sau khi owner đã ký",
    statusCode: 400,
  },
  CONTRACT_SIGNER_TYPE_REQUIRED: {
    code: "ERR_CONTRACT_005",
    message: "Đối tác phải cập nhật signerType trước khi thực hiện flow ký",
    statusCode: 400,
  },
  CONTRACT_INDIVIDUAL_ID_REQUIRED: {
    code: "ERR_CONTRACT_006",
    message: "Đối tác cá nhân phải upload đủ 2 mặt CMND/CCCD trước khi ký tay",
    statusCode: 400,
  },
  CONTRACT_ORGANIZATION_LICENSE_REQUIRED: {
    code: "ERR_CONTRACT_007",
    message: "Đối tác tổ chức phải upload giấy phép kinh doanh trước khi ký số",
    statusCode: 400,
  },
  CONTRACT_DRAFT_DOWNLOAD_ONLY: {
    code: "ERR_CONTRACT_008",
    message:
      "Chỉ có thể tải bản hợp đồng nháp khi hợp đồng đang ở trạng thái draft",
    statusCode: 400,
  },
  CONTRACT_PDF_INVALID: {
    code: "ERR_CONTRACT_009",
    message: "File hợp đồng phải là PDF hợp lệ",
    statusCode: 400,
  },
  CONTRACT_NUMBER_TAKEN: {
    code: "ERR_CONTRACT_010",
    message: "Số hợp đồng đã tồn tại",
    statusCode: 400,
  },
  CONTRACT_DRAFT_PUBLISH_ONLY: {
    code: "ERR_CONTRACT_011",
    message: "Chỉ có thể phát hành hợp đồng đang ở trạng thái nháp",
    statusCode: 400,
  },
  CONTRACT_OWNER_SIGNED_PUBLISH_ONLY: {
    code: "ERR_CONTRACT_012",
    message: "Chỉ có thể publish hợp đồng đang ở trạng thái owner_signed",
    statusCode: 400,
  },
  CONTRACT_LATEST_NOT_OWNER_SIGNED: {
    code: "ERR_CONTRACT_013",
    message: "Phiên bản hợp đồng mới nhất không ở trạng thái owner_signed",
    statusCode: 400,
  },
  CONTRACT_COMPLETED_PUBLISH_ONLY: {
    code: "ERR_CONTRACT_014",
    message: "Chỉ có thể publish hợp đồng đang ở trạng thái completed",
    statusCode: 400,
  },
  CONTRACT_LATEST_NOT_COMPLETED: {
    code: "ERR_CONTRACT_015",
    message: "Phiên bản hợp đồng mới nhất không ở trạng thái completed",
    statusCode: 400,
  },
  CONTRACT_DRAFT_UPDATE_ONLY: {
    code: "ERR_CONTRACT_016",
    message: "Chỉ được cập nhật hợp đồng ở trạng thái draft",
    statusCode: 400,
  },
  CONTRACT_INDIVIDUAL_DIGITAL_SIGNATURE_UNAVAILABLE: {
    code: "ERR_CONTRACT_017",
    message: "Đối tác cá nhân không có chữ ký số, vui lòng sử dụng flow ký tay",
    statusCode: 400,
  },
  CONTRACT_SIGNING_SESSION_NOT_PENDING: {
    code: "ERR_CONTRACT_018",
    message: "Phiên ký không còn ở trạng thái pending",
    statusCode: 400,
  },
  CONTRACT_SIGNER_TYPE_UPDATE_COMPLETED: {
    code: "ERR_CONTRACT_019",
    message: "Hợp đồng đã hoàn tất, không thể cập nhật signerType",
    statusCode: 400,
  },
  CONTRACT_TWO_ID_IMAGES_REQUIRED: {
    code: "ERR_CONTRACT_020",
    message: "Cần upload đủ 2 ảnh CMND/CCCD mặt trước và mặt sau",
    statusCode: 400,
  },
  CONTRACT_SIGNER_TYPE_REQUIRED_FOR_INDIVIDUAL: {
    code: "ERR_CONTRACT_021",
    message: "Vui lòng cập nhật signerType trước khi upload hồ sơ cá nhân",
    statusCode: 400,
  },
  CONTRACT_INDIVIDUAL_UPLOAD_ONLY: {
    code: "ERR_CONTRACT_022",
    message: "Chỉ signerType individual mới được upload CMND/CCCD",
    statusCode: 400,
  },
  CONTRACT_BUSINESS_LICENSE_REQUIRED: {
    code: "ERR_CONTRACT_023",
    message: "Giấy phép kinh doanh là bắt buộc",
    statusCode: 400,
  },
  CONTRACT_SIGNER_TYPE_REQUIRED_FOR_ORGANIZATION: {
    code: "ERR_CONTRACT_024",
    message: "Vui lòng cập nhật signerType trước khi upload hồ sơ tổ chức",
    statusCode: 400,
  },
  CONTRACT_ORGANIZATION_UPLOAD_ONLY: {
    code: "ERR_CONTRACT_025",
    message: "Chỉ signerType organization mới được upload hồ sơ tổ chức",
    statusCode: 400,
  },
  CONTRACT_CREDENTIAL_TYPE_INVALID: {
    code: "ERR_CONTRACT_026",
    message: "credentialType chỉ nhận individual hoặc organization",
    statusCode: 400,
  },
  CONTRACT_CREDENTIAL_DELETE_COMPLETED: {
    code: "ERR_CONTRACT_027",
    message: "Hợp đồng đã hoàn tất, không thể xóa hồ sơ ký",
    statusCode: 400,
  },
  CONTRACT_HANDWRITTEN_SIGNER_TYPE_REQUIRED: {
    code: "ERR_CONTRACT_028",
    message: "Đối tác phải cập nhật signerType trước khi thực hiện flow ký tay",
    statusCode: 400,
  },
  CONTRACT_SIGNER_TYPE_INVALID: {
    code: "ERR_CONTRACT_029",
    message: "signerType chỉ nhận individual hoặc organization",
    statusCode: 400,
  },
  CONTRACT_SIGNER_TYPE_MISMATCH: {
    code: "ERR_CONTRACT_030",
    message: "signerType không khớp với loại đối tác đã cập nhật trên hợp đồng",
    statusCode: 400,
  },
  CONTRACT_ORGANIZATION_DIGITAL_FLOW_REQUIRED: {
    code: "ERR_CONTRACT_031",
    message: "Đối tác tổ chức phải sử dụng flow ký số",
    statusCode: 400,
  },
  CONTRACT_PARTNER_SIGN_LINK_STATE_INVALID: {
    code: "ERR_CONTRACT_032",
    message:
      "Chỉ có thể sinh link ký cho đối tác khi hợp đồng ở trạng thái đối tác ký (owner_signed)",
    statusCode: 400,
  },
  CONTRACT_UNSIGNED_PUBLISH_ONLY: {
    code: "ERR_CONTRACT_033",
    message: "Chỉ có thể phát hành hợp đồng đang ở trạng thái unsigned",
    statusCode: 400,
  },
  CONTRACT_PUBLISH_STATUS_INVALID: {
    code: "ERR_CONTRACT_034",
    message: "Trạng thái hợp đồng không hợp lệ để publish",
    statusCode: 400,
  },
  CONTRACT_IMAGE_OR_PDF_REQUIRED: {
    code: "ERR_CONTRACT_035",
    message: "File phải là ảnh hoặc PDF",
    statusCode: 400,
  },
  CONTRACT_IMAGE_REQUIRED: {
    code: "ERR_CONTRACT_036",
    message: "File phải là ảnh",
    statusCode: 400,
  },
  CONTRACT_ID_FRONT_IMAGE_INVALID: {
    code: "ERR_CONTRACT_037",
    message: "Ảnh mặt trước CMND/CCCD không hợp lệ",
    statusCode: 400,
  },
  CONTRACT_ID_BACK_IMAGE_INVALID: {
    code: "ERR_CONTRACT_038",
    message: "Ảnh mặt sau CMND/CCCD không hợp lệ",
    statusCode: 400,
  },
  CONTRACT_BUSINESS_LICENSE_FILE_INVALID: {
    code: "ERR_CONTRACT_039",
    message: "Giấy phép kinh doanh phải là file ảnh hoặc PDF",
    statusCode: 400,
  },
  CONTRACT_POWER_OF_ATTORNEY_FILE_INVALID: {
    code: "ERR_CONTRACT_040",
    message: "Giấy ủy quyền phải là file ảnh hoặc PDF",
    statusCode: 400,
  },
  CONTRACT_GDP_FILE_INVALID: {
    code: "ERR_CONTRACT_041",
    message: "GDP phải là file ảnh hoặc PDF",
    statusCode: 400,
  },
  CONTRACT_CCDDK_FILE_INVALID: {
    code: "ERR_CONTRACT_042",
    message: "CCDDK phải là file ảnh hoặc PDF",
    statusCode: 400,
  },
  CONTRACT_HANDWRITTEN_SIGNATURE_INVALID: {
    code: "ERR_CONTRACT_043",
    message: "Ảnh chữ ký tay không hợp lệ",
    statusCode: 400,
  },
  GRPC_LICENSE_INPUT_MISSING: {
    code: "ERR_LICENSE_GRPC_001",
    message: "Thiếu licenseKey hoặc softwareId",
    statusCode: 400,
  },
  PDF_WATERMARK_LOGO_NOT_FOUND: (path) => ({
    code: "ERR_PDF_001",
    message: `Không tìm thấy watermark logo tại ${path}`,
    statusCode: 500,
  }),
  PDF_UNICODE_FONT_NOT_FOUND: {
    code: "ERR_PDF_002",
    message:
      "Không tìm thấy font Unicode, hãy cấu hình CONTRACT_FONT_PATH đến file .ttf",
    statusCode: 500,
  },
  PDF_BYTE_RANGE_MISSING: {
    code: "ERR_PDF_003",
    message: "PDF signature placeholder thiếu /ByteRange",
    statusCode: 500,
  },
  PDF_CONTENTS_MISSING: {
    code: "ERR_PDF_004",
    message: "PDF signature placeholder thiếu /Contents",
    statusCode: 500,
  },
  PDF_CONTENTS_HEX_INVALID: {
    code: "ERR_PDF_005",
    message: "PDF signature /Contents hex placeholder không hợp lệ",
    statusCode: 500,
  },
  PDF_BYTE_RANGE_TOO_LONG: {
    code: "ERR_PDF_006",
    message: "PDF ByteRange replacement dài hơn placeholder",
    statusCode: 500,
  },
  PDF_INCREMENTAL_STRUCTURE_UNSUPPORTED: {
    code: "ERR_PDF_007",
    message: "Cấu trúc PDF không hỗ trợ ký incremental",
    statusCode: 500,
  },
  PDF_SIGNATURE_FORM_MISSING: {
    code: "ERR_PDF_008",
    message: "Thiếu PDF signature form cho ký incremental",
    statusCode: 500,
  },
  PDF_PAGE_OR_ACROFORM_MISSING: {
    code: "ERR_PDF_009",
    message: "Thiếu PDF page hoặc AcroForm object",
    statusCode: 500,
  },
  PDF_SIGNATURE_HEX_INVALID: {
    code: "ERR_PDF_010",
    message: "signatureHex phải là chuỗi hex hợp lệ",
    statusCode: 500,
  },
  PDF_SIGNATURE_HEX_TOO_LONG: (actual, maximum) => ({
    code: "ERR_PDF_011",
    message: `signatureHex dài hơn vùng placeholder (${actual}/${maximum})`,
    statusCode: 500,
  }),
  PDF_HANDWRITTEN_STRUCTURE_UNSUPPORTED: {
    code: "ERR_PDF_012",
    message: "Cấu trúc PDF không hỗ trợ ký tay incremental",
    statusCode: 500,
  },
  PDF_SIGNATURE_PAGE_MISSING: {
    code: "ERR_PDF_013",
    message: "Thiếu PDF signature page cho ký tay incremental",
    statusCode: 500,
  },
  PDF_PAGE_OBJECT_MISSING: {
    code: "ERR_PDF_014",
    message: "Thiếu PDF page object cho ký tay incremental",
    statusCode: 500,
  },
};

module.exports = ErrorCodes;
