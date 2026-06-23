const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();

let docChunks = [];
let embeddings = null;
let chunkVectors = [];
let llm = null;
let ragReady = false;

function isRAGReady() {
    console.log("Current ragReady:", ragReady);
  return ragReady;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
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
    const pdfFiles = files.filter((file) => file.toLowerCase().endsWith(".pdf"));

    if (pdfFiles.length === 0) {
      console.log("No PDFs found in knowledge_base, RAG not initialized.");
      return;
    }

    const { PDFLoader } = await import("@langchain/community/document_loaders/fs/pdf");
    const { RecursiveCharacterTextSplitter } = await import("@langchain/textsplitters");
    const { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } = await import("@langchain/google-genai");

    let rawDocs = [];
    for (const file of pdfFiles) {
      const loader = new PDFLoader(path.join(directoryPath, file));
      const docs = await loader.load();
      rawDocs.push(...docs);
    }

    const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
    const splitDocs = await textSplitter.splitDocuments(rawDocs);
    docChunks = splitDocs.map((d) => d.pageContent);

    embeddings = new GoogleGenerativeAIEmbeddings({
        model: "text-embedding-004",
      apiKey: process.env.GEMINI_API_KEY,
    });

    chunkVectors = await embeddings.embedDocuments(docChunks);

    llm = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      apiKey: process.env.GEMINI_API_KEY,
      temperature: 0.2,
    });
    console.log("Current ragReady:", ragReady);
    ragReady = true;
    console.log(`RAG Pipeline Initialized with ${docChunks.length} chunks.`);
  } catch (error) {
    console.error("Error initializing RAG:", error);
  }
}

async function getMultiQueryContext(question) {
  const prompt = `You are an AI language model assistant. Generate 3 different versions of the given question to retrieve relevant documents from a vector database. Provide them separated by newlines. No numbers or bullet points.
Original question: ${question}`;

  const res = await llm.invoke(prompt);
  const queries = res.content.split("\n").filter((q) => q.trim().length > 0);
  queries.push(question);

  const allTexts = [];
  const seen = new Set();

  for (const q of queries) {
    const results = await similaritySearch(q, 2);
    for (const text of results) {
      if (!seen.has(text)) {
        seen.add(text);
        allTexts.push(text);
      }
    }
  }

  return allTexts;
}

async function askQuestion(question) {
  if (!ragReady) throw new Error("RAG system is not initialized");

  const contextChunks = await getMultiQueryContext(question);
  const context = contextChunks.join("\n\n---\n\n");

  const prompt = `You are MedInsight.

Rules:
1. Answer only using the provided context.
2. If the context does not contain the answer, say: "I could not find that information in the knowledge base."
3. Never make up medical information.
4. Never diagnose diseases.
5. Never prescribe medicines.
6. Recommend consulting a healthcare professional for medical decisions.

Context:
${context}

Question:
${question}

Answer:`;

  const response = await llm.invoke(prompt);
  return response.content;
}

module.exports = { initializeRAG, askQuestion, isRAGReady };