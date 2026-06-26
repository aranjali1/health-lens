const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { PromptTemplate } = require("@langchain/core/prompts");
const { z } = require("zod");

// -----------------------------
// Zod Schema
// -----------------------------
const ReportSchema = z.object({
  reportType: z.string(),
  summary: z.string(),
  abnormalValues: z.array(z.string()),
  suggestions: z.array(z.string()),
  suggestedQuestions: z.array(z.string()),
  parameters: z.array(
    z.object({
      parameter: z.string(),
      value: z.string(),
      referenceRange: z.string(),
      status: z.enum([
        "Low",
        "Normal",
        "High",
        "Critical",
        "Unknown",
      ]),
    })
  ),
});

// -----------------------------
// Gemini Model
// -----------------------------
const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});

// -----------------------------
// Prompt
// -----------------------------
const prompt = PromptTemplate.fromTemplate(`
You are an AI Medical Report Analyzer.

Your task is to analyze the uploaded medical report and return structured information.

Rules:
1. Never diagnose diseases.
2. Never prescribe medicines.
3. Never replace a doctor.
4. Explain findings in simple patient-friendly language.
5. Always recommend consulting a healthcare professional.
6. Generate every response in {language}.
7. If the uploaded document is NOT a medical report:
   - reportType = "Non-Medical Document"
   - summary = Explain that the uploaded file is not a medical report.
   - abnormalValues = []
   - suggestions = []
   - suggestedQuestions = []
   - parameters = []

Medical Report:

{report}
`);

// -----------------------------
// Structured Model
// -----------------------------
const structuredModel = model.withStructuredOutput(ReportSchema);

// -----------------------------
// Analyzer
// -----------------------------
async function analyzeReport(reportText, language = "English") {
  try {
    const chain = prompt.pipe(structuredModel);

    const result = await chain.invoke({
      report: reportText,
      language,
    });

    return result;
  } catch (error) {
    console.error("Medical Report Analysis Error:", error);

    return {
      reportType: "Parsing Error",
      summary: "Unable to analyze the medical report safely.",
      abnormalValues: [],
      suggestions: [],
      suggestedQuestions: [],
      parameters: [],
    };
  }
}

module.exports = analyzeReport;
