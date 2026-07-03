const appConfig = require("../config/app.config");
const { BadRequestException } = require("../common/exceptions/BaseException");
const ErrorCodes = require("../common/exceptions/error_codes");

class FptAiService {
  static getIdRecognitionConfig() {
    const apiKey = appConfig.fptAi?.apiKey;
    const url = appConfig.fptAi?.idRecognitionUrl;

    if (!apiKey) {
      throw new BadRequestException(ErrorCodes.FPT_AI_API_KEY_MISSING);
    }

    if (!url) {
      throw new BadRequestException(ErrorCodes.FPT_AI_URL_MISSING);
    }

    return { apiKey, url };
  }

  static async recognizeVietnamIdCard(file) {
    if (!file?.buffer) {
      throw new BadRequestException(ErrorCodes.FPT_AI_INVALID_ID_IMAGE);
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
      throw new BadRequestException(ErrorCodes.FPT_AI_INVALID_RESPONSE);
    }

    if (!response.ok) {
      throw new BadRequestException(ErrorCodes.FPT_AI_REQUEST_FAILED, {
        status: response.status,
        payload,
      });
    }

    if (payload.errorCode !== 0) {
      throw new BadRequestException(
        payload.errorMessage || ErrorCodes.FPT_AI_RECOGNITION_FAILED,
        payload
      );
    }

    return payload;
  }
}

module.exports = FptAiService;
