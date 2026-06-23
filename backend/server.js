const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const reportRoutes = require("./routes/reportRoutes");
const { initializeRAG } = require("./services/ragService");

connectDB();
initializeRAG();

const app = express();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/reports", reportRoutes);

app.get("/", (req, res) => {
  res.send("MedInsight API Running");
});

const PORT = process.env.PORT || 5003;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});