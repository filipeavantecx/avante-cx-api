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

// BUSCAR CLIENTE POR ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await db.query(
      `
        SELECT *
        FROM clientes
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        erro: "Cliente não encontrado"
      });
    }

    res.json({
      cliente: resultado.rows[0]
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao buscar cliente"
    });
  }
});

// ATUALIZAR CLIENTE
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      nome,
      cpf_cnpj,
      telefone,
      whatsapp,
      email,
      cidade,
      estado,
      endereco,
      observacoes,
      status
    } = req.body;

    if (!nome) {
      return res.status(400).json({
        erro: "O nome do cliente é obrigatório"
      });
    }

    const resultado = await db.query(
      `
        UPDATE clientes
        SET
          nome = $1,
          cpf_cnpj = $2,
          telefone = $3,
          whatsapp = $4,
          email = $5,
          cidade = $6,
          estado = $7,
          endereco = $8,
          observacoes = $9,
          status = $10,
          atualizado_em = NOW()
        WHERE id = $11
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
        observacoes || null,
        status || "ATIVO",
        id
      ]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        erro: "Cliente não encontrado"
      });
    }

    res.json({
      mensagem: "Cliente atualizado com sucesso",
      cliente: resultado.rows[0]
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao atualizar cliente"
    });
  }
});

// EXCLUIR CLIENTE
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await db.query(
      `
        DELETE FROM clientes
        WHERE id = $1
        RETURNING id, nome
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        erro: "Cliente não encontrado"
      });
    }

    res.json({
      mensagem: "Cliente excluído com sucesso",
      cliente: resultado.rows[0]
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao excluir cliente"
    });
  }
});

module.exports = router;