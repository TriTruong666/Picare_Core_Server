const express = require("express");
const router = express.Router();

const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const chatRoutes = require("./chat.routes");
const hubClientRoutes = require("./hub_client.routes");
const s3Routes = require("./s3.routes");

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/chat", chatRoutes);
router.use("/hub-clients", hubClientRoutes);
router.use("/s3", s3Routes);

module.exports = router;
