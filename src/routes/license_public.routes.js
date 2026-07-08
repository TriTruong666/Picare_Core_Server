const express = require("express");
const LicenseController = require("../controllers/license.controller");
const {
  createPublicTicketSchema,
  listPublicTicketSchema,
  publicTicketIdSchema,
} = require("../schemas/license.schema");

const router = express.Router();

router
  .route("/:licenseId/tickets")
  .post(createPublicTicketSchema, LicenseController.createPublicTicket)
  .get(listPublicTicketSchema, LicenseController.getPublicTickets);

router.get(
  "/:licenseId/tickets/:ticketId",
  publicTicketIdSchema,
  LicenseController.getPublicTicket,
);

module.exports = router;
