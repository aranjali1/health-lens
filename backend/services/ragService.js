const fs = require("fs").promises;
const crypto = require("crypto");
const path = require("path");
require("dotenv").config();
const { z } = require("zod");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { buildMedicalResponse } = require("../utils/medicalSafety");

const RAG_PROVIDER = process.env.RAG_VECTOR_PROVIDER || "local";
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";
const EMBEDDING_DIMENSIONS = Number(process.env.RAG_EMBEDDING_DIMENSIONS || 768);
const PINECONE_INDEX = process.env.PINECONE_INDEX || "";
const PINECONE_HOST = process.env.PINECONE_INDEX_HOST || process.env.PINECONE_HOST || "";
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || "medinsight-knowledge-base";
const PINECONE_TOP_K = Number(process.env.RAG_TOP_K || 5);
const SIMILARITY_THRESHOLD = Number(process.env.RAG_SIMILARITY_THRESHOLD || 0.65);
const AUTO_INDEX_ON_EMPTY = process.env.RAG_AUTO_INDEX_ON_EMPTY !== "false";
const LOCAL_CACHE_PATH = path.join(__dirname, "../.rag-cache/knowledge-base.json");

let docChunks = [];
let embeddingModel = null;
let chunkVectors = [];
let llm = null;
let ragReady = false;
let ragStatus = {
  ready: false,
  provider: RAG_PROVIDER,
  index: PINECONE_INDEX || null,
  namespace: RAG_PROVIDER === "pinecone" ? PINECONE_NAMESPACE : "local",
  chunkCount: 0,
  lastIndexedAt: null,
  lastError: null,
};

const ChatResponseSchema = z.object({
  answer: z.string(),
  source: z.enum(["context", "general_knowledge"]),
  foundInContext: z.boolean(),
  disclaimer: z.string(),
  followUpQuestions: z.array(z.string()),
});

function getKnowledgeBaseStatus() {
  return { ...ragStatus, ready: ragReady };
}

function isRAGReady() {
  return ragReady;
}

function hasPineconeConfig() {
  return Boolean(process.env.PINECONE_API_KEY && PINECONE_HOST);
}

function pineconeHeaders() {
  return {
    "Api-Key": process.env.PINECONE_API_KEY,
    "Content-Type": "application/json",
    "X-Pinecone-API-Version": "2025-04",
  };
}

async function pineconeRequest(pathname, body) {
  const response = await fetch(`${PINECONE_HOST}${pathname}`, {
    method: "POST",
    headers: pineconeHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Pinecone request failed (${response.status}): ${details}`);
  }

  return response.json();
}

async function getPineconeVectorCount() {
  const stats = await pineconeRequest("/describe_index_stats", {});
  const namespaceStats = stats.namespaces?.[PINECONE_NAMESPACE];
  return namespaceStats?.vectorCount || 0;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function chunkId(metadata) {
  return crypto
    .createHash("sha256")
    .update(`${metadata.source}:${metadata.page}:${metadata.chunkIndex}:${metadata.text}`)
    .digest("hex");
}

function formatCitation(metadata = {}, score) {
  return {
    source: metadata.source || "Knowledge base",
    page: metadata.page || null,
    chunkIndex: metadata.chunkIndex,
    score: Number(score.toFixed(4)),
  };
}

function dedupeResults(results) {
  const seen = new Set();
  const deduped = [];

  for (const result of results) {
    const key = result.id || result.text;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }

  return deduped.sort((a, b) => b.score - a.score);
}

function deterministicEmbedding(text) {
  const safeText = String(text || "empty");
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0.01);

  for (let i = 0; i < safeText.length; i++) {
    vector[i % EMBEDDING_DIMENSIONS] += safeText.charCodeAt(i) / 1000;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => Number((value / magnitude).toFixed(6)) || 0);
}

function normalizeEmbeddingVector(values) {
  const vector = Array.from(values || []).slice(0, EMBEDDING_DIMENSIONS);
  if (vector.length < EMBEDDING_DIMENSIONS) {
    vector.push(...new Array(EMBEDDING_DIMENSIONS - vector.length).fill(0));
  }
  return vector.map((value) => Number(value) || 0);
}

async function getEmbedding(text) {
  try {
    const result = await embeddingModel.embedContent(String(text || "empty"));
    const vector = normalizeEmbeddingVector(result.embedding?.values);

    if (vector.length !== EMBEDDING_DIMENSIONS || vector.every((value) => value === 0)) {
      throw new Error("Embedding API returned an empty vector.");
    }

    return vector;
  } catch (error) {
    console.warn("Gemini embedding unavailable. Using deterministic local fallback:", error.message);
    return deterministicEmbedding(text);
  }
}

async function getEmbeddings(texts) {
  const vectors = [];
  for (const text of texts) {
    vectors.push(await getEmbedding(text));
  }
  return vectors;
}

async function loadKnowledgeBaseDocuments() {
  const directoryPath = path.join(__dirname, "../knowledge_base");
  try {
    await fs.access(directoryPath);
  } catch {
    await fs.mkdir(directoryPath, { recursive: true });
  }

  const files = await fs.readdir(directoryPath);
  const pdfFiles = files.filter((file) => file.toLowerCase().endsWith(".pdf"));

  if (pdfFiles.length === 0) {
    return [];
  }

  const { PDFLoader } = await import("@langchain/community/document_loaders/fs/pdf");
  const { RecursiveCharacterTextSplitter } = await import("@langchain/textsplitters");

  let docs = [];
  for (const file of pdfFiles) {
    const loader = new PDFLoader(path.join(directoryPath, file));
    const loadedDocs = await loader.load();
    docs.push(...loadedDocs.map((doc) => ({
      ...doc,
      metadata: {
        ...doc.metadata,
        source: file,
      },
    })));
  }

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
  const splitDocs = await splitter.splitDocuments(docs);

  return splitDocs.map((doc, index) => {
    const metadata = {
      source: path.basename(doc.metadata?.source || "knowledge-base.pdf"),
      page: doc.metadata?.loc?.pageNumber || doc.metadata?.pdf?.page || null,
      chunkIndex: index,
      text: doc.pageContent,
    };

    return {
      id: chunkId(metadata),
      text: doc.pageContent,
      metadata,
    };
  });
}

async function initModels() {
  const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  llm = new ChatGoogleGenerativeAI({
    model: "gemini-3.1-flash-lite",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0,
  });
}

async function loadLocalCache() {
  try {
    const raw = await fs.readFile(LOCAL_CACHE_PATH, "utf8");
    const cache = JSON.parse(raw);
    docChunks = cache.chunks || [];
    chunkVectors = cache.vectors || [];
    ragStatus.chunkCount = docChunks.length;
    ragStatus.lastIndexedAt = cache.indexedAt || null;
    return docChunks.length > 0 && chunkVectors.length === docChunks.length;
  } catch {
    return false;
  }
}

async function saveLocalCache(chunks, vectors) {
  await fs.mkdir(path.dirname(LOCAL_CACHE_PATH), { recursive: true });
  await fs.writeFile(LOCAL_CACHE_PATH, JSON.stringify({
    indexedAt: new Date().toISOString(),
    chunks,
    vectors,
  }));
}

async function upsertPineconeVectors(chunks, vectors) {
  const invalidVectorIndex = vectors.findIndex((vector) => !Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS);
  if (invalidVectorIndex !== -1) {
    throw new Error(`Embedding generation failed for chunk ${invalidVectorIndex}. Expected ${EMBEDDING_DIMENSIONS} dimensions.`);
  }

  await pineconeRequest("/vectors/delete", {
    deleteAll: true,
    namespace: PINECONE_NAMESPACE,
  }).catch((error) => {
    if (!String(error.message).includes("404")) throw error;
  });

  const batchSize = 100;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize).map((chunk, offset) => ({
      id: chunk.id,
      values: vectors[i + offset],
      metadata: chunk.metadata,
    }));

    await pineconeRequest("/vectors/upsert", {
      namespace: PINECONE_NAMESPACE,
      vectors: batch,
    });
  }
}

async function indexKnowledgeBase({ force = false } = {}) {
  ragReady = false;
  ragStatus.ready = false;
  ragStatus.lastError = null;

  await initModels();

  if (RAG_PROVIDER === "pinecone" && !force) {
    if (!hasPineconeConfig()) {
      throw new Error("Pinecone is selected but PINECONE_API_KEY or PINECONE_INDEX_HOST is missing.");
    }

    const vectorCount = await getPineconeVectorCount();
    if (vectorCount === 0 && AUTO_INDEX_ON_EMPTY) {
      return indexKnowledgeBase({ force: true });
    }

    ragStatus = {
      ready: vectorCount > 0,
      provider: RAG_PROVIDER,
      index: PINECONE_INDEX || null,
      namespace: PINECONE_NAMESPACE,
      chunkCount: vectorCount,
      lastIndexedAt: null,
      lastError: vectorCount > 0 ? null : "Pinecone is connected, but this namespace has no vectors yet. Click Re-index.",
    };
    ragReady = vectorCount > 0;
    return ragStatus;
  }

  if (!force && RAG_PROVIDER !== "pinecone") {
    const loadedFromCache = await loadLocalCache();
    if (loadedFromCache) {
      ragReady = true;
      ragStatus.ready = true;
      return ragStatus;
    }
  }

  const chunks = await loadKnowledgeBaseDocuments();
  if (chunks.length === 0) {
    ragStatus.chunkCount = 0;
    ragStatus.lastError = "No PDFs found in knowledge_base.";
    return ragStatus;
  }

  const vectors = await getEmbeddings(chunks.map((chunk) => chunk.text));
  const invalidVectorIndex = vectors.findIndex((vector) => !Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS);
  if (invalidVectorIndex !== -1) {
    throw new Error(`Embedding generation failed for chunk ${invalidVectorIndex}. Expected ${EMBEDDING_DIMENSIONS} dimensions.`);
  }

  if (RAG_PROVIDER === "pinecone") {
    if (!hasPineconeConfig()) {
      throw new Error("Pinecone is selected but PINECONE_API_KEY or PINECONE_INDEX_HOST is missing.");
    }

    await upsertPineconeVectors(chunks, vectors);
    ragStatus.chunkCount = await getPineconeVectorCount();
  } else {
    docChunks = chunks;
    chunkVectors = vectors;
    await saveLocalCache(chunks, vectors);
  }

  ragStatus = {
    ready: true,
    provider: RAG_PROVIDER,
    index: RAG_PROVIDER === "pinecone" ? PINECONE_INDEX || null : null,
    namespace: RAG_PROVIDER === "pinecone" ? PINECONE_NAMESPACE : "local",
    chunkCount: RAG_PROVIDER === "pinecone" ? ragStatus.chunkCount || chunks.length : chunks.length,
    lastIndexedAt: new Date().toISOString(),
    lastError: null,
  };
  ragReady = true;

  return ragStatus;
}

async function initializeRAG() {
  try {
    const status = await indexKnowledgeBase({ force: false });
    if (status.ready) {
      console.log(`RAG initialized with ${status.chunkCount} chunks using ${status.provider}`);
    } else {
      console.log(status.lastError || "RAG was not initialized.");
    }
  } catch (err) {
    ragStatus.lastError = err.message;
    console.error(err);
  }
}

async function similaritySearchLocal(query, k = PINECONE_TOP_K) {
  const queryEmbedding = await getEmbedding(query);
  const scored = chunkVectors.map((vec, index) => ({
    id: docChunks[index].id,
    score: cosineSimilarity(queryEmbedding, vec),
    text: docChunks[index].text,
    metadata: docChunks[index].metadata,
  }));

  return scored
    .filter((item) => item.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

async function similaritySearchPinecone(query, k = PINECONE_TOP_K) {
  const vector = await getEmbedding(query);
  const response = await pineconeRequest("/query", {
    namespace: PINECONE_NAMESPACE,
    vector,
    topK: k,
    includeMetadata: true,
    includeValues: false,
  });

  return (response.matches || [])
    .filter((match) => match.score >= SIMILARITY_THRESHOLD)
    .map((match) => ({
      id: match.id,
      score: match.score,
      text: match.metadata?.text || "",
      metadata: match.metadata || {},
    }));
}

async function similaritySearch(query, k = PINECONE_TOP_K) {
  if (RAG_PROVIDER === "pinecone") {
    return similaritySearchPinecone(query, k);
  }

  return similaritySearchLocal(query, k);
}

async function getMultiQueryContext(question) {
  const prompt = `Generate 3 alternative medical search queries based on this Original Question: ${question}\nReturn each query on a new line only.`;
  const res = await llm.invoke(prompt);
  const content = typeof res.content === "string" ? res.content : res.content[0]?.text || "";
  const queries = content.split("\n").map((query) => query.trim()).filter(Boolean);
  queries.push(question);

  const results = [];
  for (const query of queries) {
    results.push(...(await similaritySearch(query, 3)));
  }

  return dedupeResults(results).slice(0, PINECONE_TOP_K);
}

function formatContext(results) {
  return results.map((result, index) => {
    const citation = formatCitation(result.metadata, result.score);
    return `[Source ${index + 1}: ${citation.source}${citation.page ? `, page ${citation.page}` : ""}, score ${citation.score}]\n${result.text}`;
  }).join("\n\n-----------------\n\n");
}

async function retrieveKnowledgeContext(question) {
  if (!ragReady) throw new Error("RAG not initialized");

  const contextResults = await getMultiQueryContext(question);
  const context = formatContext(contextResults);
  const citations = contextResults.map((result) => formatCitation(result.metadata, result.score));

  return {
    context,
    citations,
    foundContext: contextResults.length > 0,
  };
}

async function askQuestion(question) {
  const { context, citations, foundContext } = await retrieveKnowledgeContext(question);
  const structuredModel = llm.withStructuredOutput(ChatResponseSchema);

  const prompt = `
You are MedInsight.
Instructions:
1. Use the Context first.
2. If Context contains the answer:
   - source = "context"
   - foundInContext = true
   - disclaimer = ""
3. If Context is empty or does not contain the answer:
   - answer using general medical knowledge only when it is safe and educational
   - source = "general_knowledge"
   - foundInContext = false
   - disclaimer = "The knowledge base did not contain a sufficiently relevant source for this answer."
4. Never diagnose diseases.
5. Never prescribe medicines.
6. Always keep answers patient friendly.
7. This is general educational medical information, not interpretation of a user's uploaded report.
8. Start the answer with "Educational information:".
9. If the user describes urgent symptoms, advise them to seek immediate emergency care before any other explanation.
10. Do not write the legal/medical disclaimer yourself; the API adds it consistently.
11. Generate 3 follow-up questions.

Context:
${context || "No sufficiently relevant context was retrieved."}

Question:
${question}
`;

  const response = await structuredModel.invoke(prompt);

  return buildMedicalResponse(response.answer, question, "educational_info", {
    source: foundContext ? response.source : "general_knowledge",
    foundInContext: foundContext && response.foundInContext,
    knowledgeBaseNotice: foundContext ? response.disclaimer : "The knowledge base did not contain a sufficiently relevant source for this answer.",
    followUpQuestions: response.followUpQuestions,
    citations: foundContext ? citations : [],
  });
}

module.exports = {
  initializeRAG,
  indexKnowledgeBase,
  askQuestion,
  retrieveKnowledgeContext,
  isRAGReady,
  getKnowledgeBaseStatus,
};
