const appConfig = require("../config/app.config");
const { BadRequestException } = require("../common/exceptions/BaseException");

class FptAiService {
  static getIdRecognitionConfig() {
    const apiKey = appConfig.fptAi?.apiKey;
    const url = appConfig.fptAi?.idRecognitionUrl;

    if (!apiKey) {
      throw new BadRequestException("Chưa cấu hình FPT_AI_API_KEY");
    }

    if (!url) {
      throw new BadRequestException("Chưa cấu hình FPT_AI_ID_RECOGNITION_URL");
    }

    return { apiKey, url };
  }

  static async recognizeVietnamIdCard(file) {
    if (!file?.buffer) {
      throw new BadRequestException("File ảnh CMND/CCCD không hợp lệ");
    }

    const { apiKey, url } = this.getIdRecognitionConfig();
    const formData = new FormData();
    const imageBlob = new Blob([file.buffer], {
      type: file.mimetype || "application/octet-stream",
    });

    formData.append("image", imageBlob, file.originalname || "id-card.jpg");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": apiKey,
      },
      body: formData,
    });

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new BadRequestException("FPT AI trả về response không phải JSON");
    }

    if (!response.ok) {
      throw new BadRequestException("Gọi FPT AI thất bại", {
        status: response.status,
        payload,
      });
    }

    if (payload.errorCode !== 0) {
      throw new BadRequestException(
        payload.errorMessage || "FPT AI không nhận diện được ảnh CMND/CCCD",
        payload
      );
    }

    return payload;
  }
}

module.exports = FptAiService;
