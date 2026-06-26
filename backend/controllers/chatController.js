const mongoose = require("mongoose");
const Report = require("../models/Report");
const answerUnifiedChat = require("../services/unifiedChatService");
const {
  retrieveKnowledgeContext,
  isRAGReady,
} = require("../services/ragService");

const includeErrorDetails = process.env.NODE_ENV !== "production";

function errorResponse(message, error) {
  return {
    message,
    ...(includeErrorDetails && error?.message ? { details: error.message } : {}),
  };
}

const handleUnifiedChat = async (req, res) => {
  try {
    if (!isRAGReady()) {
      return res.status(503).json({ message: "Knowledge base is still loading, please try again shortly." });
    }

    const { question, reportId } = req.body;
    if (!question?.trim()) {
      return res.status(400).json({ message: "Question is required" });
    }

    const knowledgeContext = await retrieveKnowledgeContext(question);
    let report = null;

    if (reportId) {
      if (!mongoose.Types.ObjectId.isValid(reportId)) {
        return res.status(400).json({ message: "Invalid reportId" });
      }

      report = await Report.findById(reportId);
      if (!report) return res.status(404).json({ message: "Report not found" });
      if (report.userId.toString() !== req.user.id) {
        return res.status(403).json({ message: "Unauthorized" });
      }
    }

    const answer = await answerUnifiedChat({
      question,
      report,
      knowledgeContext,
    });

    if (report) {
      report.chatHistory.push({ question, answer: answer.answer });
      await report.save();
    }

    res.status(200).json({ success: true, answer });
  } catch (error) {
    console.error("CRASH IN handleUnifiedChat:", error);
    res.status(500).json(errorResponse("Unable to answer this question right now.", error));
  }
};

module.exports = {
  handleUnifiedChat,
};
