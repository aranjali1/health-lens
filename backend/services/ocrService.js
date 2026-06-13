const Tesseract = require("tesseract.js");

const extractImageText = async (filePath) => {
  const result = await Tesseract.recognize(
    filePath,
    "eng"
  );

  return result.data.text;
};

module.exports = extractImageText;