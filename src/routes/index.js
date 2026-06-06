const express = require("express");
const router = express.Router();

const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const chatRoutes = require("./chat.routes");
const hubClientRoutes = require("./hub_client.routes");
const s3Routes = require("./s3.routes");
const s3FolderRoutes = require("./s3_folder.routes");
const contractRoutes = require("./contract.routes");
const mailRoutes = require("./mail.routes");
const productQRRoutes = require("./product_qr.routes");

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/chat", chatRoutes);
router.use("/hub-clients", hubClientRoutes);
router.use("/s3", s3Routes);
router.use("/s3-folders", s3FolderRoutes);
router.use("/contracts", contractRoutes);
router.use("/mail", mailRoutes);
router.use("/product-qrs", productQRRoutes);

module.exports = router;
