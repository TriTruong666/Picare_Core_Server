const fs = require("fs");
const path = require("path");
const HubClient = require("../models/hub_client.model");

/**
 * Seed Hub Client data from local_data/hub_client_seed.data.json
 */
async function seedingHubClients() {
  try {
    const filePath = path.join(
      __dirname,
      "/local_data/hub_client_seed.data.json"
    );
    const rawData = fs.readFileSync(filePath, "utf-8");
    const clients = JSON.parse(rawData);

    for (const c of clients) {
      const isExisted = await HubClient.findOne({
        where: { clientName: c.clientName },
      });

      if (!isExisted) {
        await HubClient.create({
          clientName: c.clientName,
          clientDescription: c.clientDescription,
          clientExternalUrl: c.clientExternalUrl,
          clientStatus: c.clientStatus || "active",
          allowedRoles: c.allowedRoles,
          note: c.note,
        });
        console.log(`[SEED]: Hub Client "${c.clientName}" đã được tạo thành công.`);
      } else {
        await isExisted.update({
          clientDescription: c.clientDescription,
          clientExternalUrl: c.clientExternalUrl,
          clientStatus: c.clientStatus || isExisted.clientStatus,
          allowedRoles: c.allowedRoles,
          note: c.note || isExisted.note,
        });
        console.log(`[SEED]: Hub Client "${c.clientName}" đã được cập nhật thông tin.`);
      }
    }
  } catch (error) {
    console.error("[SEED ERROR]: Lỗi khi seed Hub Clients:", error.message);
  }
}

module.exports = seedingHubClients;
