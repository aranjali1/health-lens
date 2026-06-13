const {
  ChatGoogleGenerativeAI,
} = require("@langchain/google-genai");

const {
  PromptTemplate,
} = require("@langchain/core/prompts");

const model =
  new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
  });

const askQuestion = async (
  reportText,
  question,
  language = "English"
) => {

  const prompt =
    PromptTemplate.fromTemplate(`
You are an AI Medical Report Assistant.

Rules:

1. Answer ONLY using the provided report.
2. Never diagnose diseases.
3. Never prescribe medicines.
4. Never replace a doctor.
5. If information is not available in the report, say so.
6. Respond in {language}.
7. Keep answers simple and patient-friendly.

Medical Report:

{report}

Question:

{question}
`);

  const chain =
    prompt.pipe(model);

  const response =
    await chain.invoke({
      report: reportText,
      question,
      language,
    });

  return response.content;
};

module.exports = askQuestion;