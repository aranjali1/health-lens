const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const upload =
  require("../middleware/uploadMiddleware");
const {
  uploadReport,
  getReports,
  getReportById,
  chatWithReport,
  getChatHistory,
} = require("../controllers/reportController");

router.post(
  "/upload",
  protect,
  upload.single("report"),
  uploadReport
);

router.get("/", protect, getReports);

router.get("/:id", protect, getReportById);
router.post(
  "/:id/chat",
  protect,
  chatWithReport
);

router.get(
  "/:id/chat-history",
  protect,
  getChatHistory
);

module.exports = router;