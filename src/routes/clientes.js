const express = require("express");
const db = require("../database/db");
const verificarToken = require("../middleware/auth");

const router = express.Router();

// Todas as rotas abaixo exigem autenticação
router.use(verificarToken);


// LISTAR CLIENTES
router.get("/", async (req, res) => {
  try {
    const resultado = await db.query(`
      SELECT
        id,
        nome,
        cpf_cnpj,
        telefone,
        whatsapp,
        email,
        cidade,
        estado,
        endereco,
        observacoes,
        status,
        criado_em,
        atualizado_em
      FROM clientes
      ORDER BY nome ASC
    `);

    res.json({
      clientes: resultado.rows
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao buscar clientes"
    });
  }
});


// CADASTRAR CLIENTE
router.post("/", async (req, res) => {
  try {

    const {
      nome,
      cpf_cnpj,
      telefone,
      whatsapp,
      email,
      cidade,
      estado,
      endereco,
      observacoes
    } = req.body;

    if (!nome) {
      return res.status(400).json({
        erro: "O nome do cliente é obrigatório"
      });
    }

    const resultado = await db.query(
      `
        INSERT INTO clientes
        (
          nome,
          cpf_cnpj,
          telefone,
          whatsapp,
          email,
          cidade,
          estado,
          endereco,
          observacoes
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9)

        RETURNING *
      `,
      [
        nome,
        cpf_cnpj || null,
        telefone || null,
        whatsapp || null,
        email || null,
        cidade || null,
        estado || null,
        endereco || null,
        observacoes || null
      ]
    );

    res.status(201).json({
      mensagem: "Cliente cadastrado com sucesso",
      cliente: resultado.rows[0]
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao cadastrar cliente"
    });
  }
});

module.exports = router;