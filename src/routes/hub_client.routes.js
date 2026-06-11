const express = require("express");
const router = express.Router();
const HubClientController = require("../controllers/hub_client.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  createHubClientSchema,
  updateHubClientSchema,
  clientIdSchema,
  checkAccessSchema,
  checkAccessByUrlSchema,
} = require("../schemas/hub_client.schema");

router.get("/", HubClientController.getClientsPaginate);

router.get(
  "/check-access-by-url",
  checkAccessByUrlSchema,
  HubClientController.checkClientAccessByExternalUrl,
);

router.get("/:clientId/check-access", checkAccessSchema, HubClientController.checkClientAccess);

router.get("/:clientId", clientIdSchema, HubClientController.getClientById);

router.post(
  "/",
  protect,
  createHubClientSchema,
  HubClientController.createClient,
);

router.put(
  "/:clientId",
  protect,
  updateHubClientSchema,
  HubClientController.updateClient,
);

router.delete(
  "/:clientId",
  protect,
  clientIdSchema,
  HubClientController.deleteClient,
);

module.exports = router;
