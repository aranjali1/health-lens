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

function normalizeMessageContent(content) {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

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

  const answer = normalizeMessageContent(response.content);

  if (!answer) {
    throw new Error("The AI returned an empty response for this report.");
  }

  return answer;
};

module.exports = askQuestion;
