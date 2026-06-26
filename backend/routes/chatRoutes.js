const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const { apiRateLimiter } = require("../middleware/rateLimitMiddleware");
const { handleUnifiedChat } = require("../controllers/chatController");

router.post("/", apiRateLimiter, protect, handleUnifiedChat);

module.exports = router;
