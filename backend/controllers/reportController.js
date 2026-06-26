const Report = require("../models/Report");
const fs = require("fs").promises;
const extractPdfText = require("../services/pdfService");
const extractImageText = require("../services/ocrService");
const analyzeReport = require("../services/aiService");
const askReportQuestion = require("../services/chatService");
const { askQuestion: askRagQuestion, isRAGReady } = require("../services/ragService");

const handleUserQuery = async (req, res) => {
  try {
    console.log("RAG Ready:", isRAGReady());
    if (!isRAGReady()) {
      return res.status(503).json({ message: "Knowledge base is still loading, please try again shortly." });
    }

    const { question } = req.body;
    if (!question?.trim()) {
      return res.status(400).json({ message: "Question is required" });
    }

    const answer = await askRagQuestion(question);
    res.status(200).json({ success: true, answer });
  } catch (error) {
    console.error("CRASH IN handleUserQuery:", error);
    res.status(500).json({ message: error.message });
  }
};

const uploadReport = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    let extractedText = "";

    if (req.file.mimetype === "application/pdf") {
      extractedText = await extractPdfText(req.file.path);
    } else if (["image/png", "image/jpeg", "image/jpg"].includes(req.file.mimetype)) {
      extractedText = await extractImageText(req.file.path);
    } else {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: "Unsupported file type" });
    }

    const analysis = await analyzeReport(extractedText, req.body.language || "English");

    const report = await Report.create({
      userId: req.user.id,
      originalFileName: req.file.originalname,
      filePath: req.file.path,
      fileType: req.file.mimetype,
      extractedText,
      reportType: analysis.reportType || "",
      summary: analysis.summary || "",
      abnormalValues: analysis.abnormalValues || [],
      suggestions: analysis.suggestions || [],
      suggestedQuestions: analysis.suggestedQuestions || [],
      parameters: analysis.parameters || [],
    });

    await fs.unlink(req.file.path).catch(() => {});

    res.status(201).json({ success: true, message: "Report uploaded and analyzed successfully", report });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getReports = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const reports = await Report.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json(reports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getReportById = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });
    if (report.userId.toString() !== req.user.id) return res.status(403).json({ message: "Unauthorized" });

    res.status(200).json(report);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const chatWithReport = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });
    if (report.userId.toString() !== req.user.id) return res.status(403).json({ message: "Unauthorized" });

    const { question, language } = req.body;
    if (!question?.trim()) {
      return res.status(400).json({ message: "Question is required" });
    }

    const answer = await askReportQuestion(report.extractedText, question, language || "English");

    report.chatHistory.push({ question, answer });
    await report.save();

    res.status(200).json({ answer });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getChatHistory = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });
    if (report.userId.toString() !== req.user.id) return res.status(403).json({ message: "Unauthorized" });

    res.status(200).json(report.chatHistory);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  handleUserQuery,
  uploadReport,
  getReports,
  getReportById,
  chatWithReport,
  getChatHistory,
};