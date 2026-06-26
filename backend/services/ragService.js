const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();
const { z } = require("zod");

let docChunks = [];
let embeddings = null;
let chunkVectors = [];
let llm = null;
let ragReady = false;

const ChatResponseSchema = z.object({
  answer: z.string(),
  source: z.enum(["context", "general_knowledge"]),
  foundInContext: z.boolean(),
  disclaimer: z.string(),
  followUpQuestions: z.array(z.string()),
});

function isRAGReady() {
  return ragReady;
}

function cosineSimilarity(a, b) {
  let dot = 0,
    normA = 0,
    normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function similaritySearch(query, k = 4) {
  const queryEmbedding = await embeddings.embedQuery(query);

  const scored = chunkVectors.map((vec, i) => ({
    score: cosineSimilarity(queryEmbedding, vec),
    text: docChunks[i],
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, k).map((s) => s.text);
}

async function initializeRAG() {
  try {
    const directoryPath = path.join(__dirname, "../knowledge_base");

    try {
      await fs.access(directoryPath);
    } catch {
      await fs.mkdir(directoryPath, { recursive: true });
    }

    const files = await fs.readdir(directoryPath);

    const pdfFiles = files.filter((f) =>
      f.toLowerCase().endsWith(".pdf")
    );

    if (pdfFiles.length === 0) {
      console.log("No PDFs found.");
      return;
    }

    const { PDFLoader } = await import(
      "@langchain/community/document_loaders/fs/pdf"
    );

    const {
      RecursiveCharacterTextSplitter,
    } = await import("@langchain/textsplitters");

    const {
      GoogleGenerativeAIEmbeddings,
      ChatGoogleGenerativeAI,
    } = await import("@langchain/google-genai");

    let docs = [];

    for (const file of pdfFiles) {
      const loader = new PDFLoader(
        path.join(directoryPath, file)
      );

      docs.push(...(await loader.load()));
    }

    const splitter =
      new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });

    const splitDocs =
      await splitter.splitDocuments(docs);

    docChunks = splitDocs.map((d) => d.pageContent);

    embeddings =
      new GoogleGenerativeAIEmbeddings({
        model: "gemini-embedding-001",
        apiKey: process.env.GEMINI_API_KEY,
      });

    chunkVectors =
      await embeddings.embedDocuments(docChunks);

    llm = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      apiKey: process.env.GEMINI_API_KEY,
      temperature: 0,
    });

    ragReady = true;

    console.log(
      `RAG initialized with ${docChunks.length} chunks`
    );
  } catch (err) {
    console.error(err);
  }
}

async function getMultiQueryContext(question) {
  const prompt = `
Generate 3 alternative search queries.

Original Question:

${question}

Return each query on a new line only.
`;

  const res = await llm.invoke(prompt);

  const content =
    typeof res.content === "string"
      ? res.content
      : res.content[0]?.text || "";

  const queries = content
    .split("\n")
    .filter((q) => q.trim());

  queries.push(question);

  const seen = new Set();
  const context = [];

  for (const q of queries) {
    const results =
      await similaritySearch(q, 2);

    for (const r of results) {
      if (!seen.has(r)) {
        seen.add(r);
        context.push(r);
      }
    }
  }

  return context;
}

async function askQuestion(question) {
  if (!ragReady)
    throw new Error("RAG not initialized");

  const contextChunks =
    await getMultiQueryContext(question);

  const context = contextChunks.join(
    "\n\n-----------------\n\n"
  );

  const structuredModel =
    llm.withStructuredOutput(ChatResponseSchema);

  const prompt = `
You are MedInsight.

Instructions:

1. Use the Context first.

2. If Context contains the answer:
   - source = "context"
   - foundInContext = true
   - disclaimer = ""

3. Otherwise answer using general medical knowledge.
   - source = "general_knowledge"
   - foundInContext = false
   - disclaimer = "The uploaded documents do not contain this information."

4. Never diagnose diseases.

5. Never prescribe medicines.

6. Always keep answers patient friendly.

7. Generate 3 follow-up questions.

Context:

${context}

Question:

${question}
`;

  const response =
    await structuredModel.invoke(prompt);

  return response;
}

module.exports = {
  initializeRAG,
  askQuestion,
  isRAGReady,
};