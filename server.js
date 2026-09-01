const express = require("express");
const cors = require("cors");
const authRoutes = require("./src/routes/auth");
const clientesRoutes = require("./src/routes/clientes");
const contratosRoutes = require("./src/routes/contratos");
const crmRoutes = require("./src/routes/crm");
const comercialRoutes = require("./src/routes/comercial");

const db = require("./src/database/db");

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

app.get("/db-test", async (req, res) => {
  try {
    const resultado = await db.query("SELECT NOW() AS agora");

    res.json({
      banco: "conectado",
      servidor: "PostgreSQL",
      agora: resultado.rows[0].agora
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      banco: "erro",
      mensagem: erro.message
    });
  }
});

// IMPORTANTE: AUTH PRIMEIRO
app.use("/auth", authRoutes);

// ROTAS PROTEGIDAS
app.use("/clientes", clientesRoutes);
app.use("/contratos", contratosRoutes);

// CRM POR ÚLTIMO
app.use("/", crmRoutes);
app.use("/", comercialRoutes);

app.listen(PORT, () => {
  console.log(`AVANTE CX API rodando na porta ${PORT}`);
});