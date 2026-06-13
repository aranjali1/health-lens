const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    originalFileName: {
      type: String,
      required: true,
    },

    filePath: {
      type: String,
      required: true,
    },

    fileType: {
      type: String,
      required: true,
    },

    extractedText: {
      type: String,
      default: "",
    },

    reportType: {
      type: String,
      default: "",
    },

    summary: {
      type: String,
      default: "",
    },

    abnormalValues: {
      type: [String],
      default: [],
    },

    suggestions: {
      type: [String],
      default: [],
    },

    suggestedQuestions: {
      type: [String],
      default: [],
    },

    chatHistory: [
  {
    question: String,
    answer: String,
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
],

    parameters: [
      {
        parameter: String,
        value: String,
        referenceRange: String,
        status: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Report", reportSchema);