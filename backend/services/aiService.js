const {
  ChatGoogleGenerativeAI,
} = require("@langchain/google-genai");

const {
  PromptTemplate,
} = require("@langchain/core/prompts");

const { z } = require("zod");

const model =
  new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
  });

const ReportSchema = z.object({
  reportType: z.string(),

  summary: z.string(),

  abnormalValues: z.array(
    z.string()
  ),

  suggestions: z.array(
    z.string()
  ),

  suggestedQuestions: z.array(
    z.string()
  ),

  parameters: z.array(
    z.object({
      parameter: z.string(),
      value: z.string(),
      referenceRange:
        z.string(),
      status: z.string(),
    })
  ),
});

const analyzeReport = async (
  reportText,
  language = "English"
) => {

  const structuredModel =
    model.withStructuredOutput(
      ReportSchema
    );

  const prompt =
  PromptTemplate.fromTemplate(`
You are an AI Medical Report Analyzer.

Your job is to analyze medical reports and convert them into structured insights.

IMPORTANT RULES:

1. Never diagnose diseases.
2. Never prescribe medicines.
3. Never claim a person has a medical condition.
4. Never replace a doctor.
5. Always recommend consulting a healthcare professional.
6. Explain findings in simple patient-friendly language.
7. Generate all responses in {language}.
8. If the uploaded document is NOT a medical report, identify it and return empty parameters.

TASKS:

1. Identify report type
   Examples:
   - CBC
   - Lipid Profile
   - Thyroid Profile
   - Liver Function Test
   - Kidney Function Test
   - Blood Sugar Report
   - Vitamin Report
   - Medical Report
   - Non-Medical Document

2. Generate a concise summary.

3. Extract ALL medical parameters found in the report.

For each parameter extract:

- parameter
- value
- referenceRange
- status

Status must be one of:
- Low
- Normal
- High
- Critical
- Unknown

4. Create a list of abnormal values.

5. Generate 3-5 general health suggestions based on the report findings.

6. Generate 3-5 useful questions a patient may want to ask.

PARAMETER EXTRACTION RULES:

- Extract every available parameter.
- Never skip parameters if values exist.
- If reference range is missing, use "Not Available".
- If status cannot be determined, use "Unknown".
- Preserve original units.
- Do not invent values.

NON-MEDICAL DOCUMENT RULES:

If the document is not a medical report:

- reportType = "Non-Medical Document"
- parameters = []
- abnormalValues = []
- Explain that the uploaded document is not a medical report.

Medical Report:

{report}
`);

  const chain =
    prompt.pipe(
      structuredModel
    );

  const result =
    await chain.invoke({
      report: reportText,
      language,
    });

  return result;
};

module.exports =
  analyzeReport;