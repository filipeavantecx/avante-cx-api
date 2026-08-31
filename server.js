const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    sistema: "AVANTE CX",
    api: "online",
    versao: "2.0.0"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    sistema: "AVANTE CX"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`AVANTE CX API rodando na porta ${PORT}`);
});