const Report = require("../models/Report");
const extractPdfText = require("../services/pdfService");
const extractImageText = require("../services/ocrService");
const analyzeReport = require("../services/aiService");
const askQuestion =
  require("../services/chatService");

const uploadReport = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "No file uploaded",
      });
    }

    let extractedText = "";

    // PDF Extraction
    if (req.file.mimetype === "application/pdf") {
      extractedText = await extractPdfText(
        req.file.path
      );
    }

    // Image OCR
    else if (
      req.file.mimetype === "image/png" ||
      req.file.mimetype === "image/jpeg" ||
      req.file.mimetype === "image/jpg"
    ) {
      extractedText = await extractImageText(
        req.file.path
      );
    }

    else {
      return res.status(400).json({
        message: "Unsupported file type",
      });
    }

    // AI Analysis using Structured Output
    const analysis = await analyzeReport(
      extractedText,
      req.body.language || "English"
    );

    const report = await Report.create({
      userId: req.user.id,

      originalFileName:
        req.file.originalname,

      filePath: req.file.path,

      fileType: req.file.mimetype,

      extractedText,

      reportType:
        analysis.reportType || "",

      summary:
        analysis.summary || "",

      abnormalValues:
        analysis.abnormalValues || [],

      suggestions:
        analysis.suggestions || [],

      suggestedQuestions:
        analysis.suggestedQuestions || [],

      parameters:
        analysis.parameters || [],
    });

    res.status(201).json({
      success: true,
      message:
        "Report uploaded and analyzed successfully",
      report,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: error.message,
    });
  }
};

const getReports = async (req, res) => {
  try {
    const reports = await Report.find({
      userId: req.user.id,
    }).sort({ createdAt: -1 });

    res.status(200).json(reports);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const getReportById = async (req, res) => {
  try {
    const report = await Report.findById(
      req.params.id
    );

    if (!report) {
      return res.status(404).json({
        message: "Report not found",
      });
    }

    if (
      report.userId.toString() !==
      req.user.id
    ) {
      return res.status(403).json({
        message: "Unauthorized",
      });
    }

    res.status(200).json(report);

  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const chatWithReport = async (
  req,
  res
) => {
  try {

    const report =
      await Report.findById(
        req.params.id
      );

      if (
  report.userId.toString() !==
  req.user.id
) {
  return res.status(403).json({
    message: "Unauthorized",
  });
}

    if (!report) {
      return res.status(404).json({
        message:
          "Report not found",
      });
    }

    const { question, language } =
      req.body;

  const answer =
  await askQuestion(
    report.extractedText,
    question,
    language || "English"
  );

report.chatHistory.push({
  question,
  answer,
});

await report.save();

res.status(200).json({
  answer,
});

  } catch (error) {
    res.status(500).json({
      message:
        error.message,
    });
  }
};

const getChatHistory = async (
  req,
  res
) => {
  try {

    const report =
      await Report.findById(
        req.params.id
      );

    if (!report) {
      return res.status(404).json({
        message:
          "Report not found",
      });
    }

    if (
      report.userId.toString() !==
      req.user.id
    ) {
      return res.status(403).json({
        message:
          "Unauthorized",
      });
    }

    res.status(200).json(
      report.chatHistory
    );

  } catch (error) {
    res.status(500).json({
      message:
        error.message,
    });
  }
};

module.exports = {
  uploadReport,
  getReports,
  getReportById,
  chatWithReport,
  getChatHistory,
};