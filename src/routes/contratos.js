const express = require("express");
const db = require("../database/db");
const verificarToken = require("../middleware/auth");

const router = express.Router();

router.use(verificarToken);


// LISTAR CONTRATOS
router.get("/", async (req, res) => {
  try {
    const resultado = await db.query(`
      SELECT
        c.*,
        cli.nome_completo AS cliente_nome
      FROM contratos c
      LEFT JOIN clientes cli
        ON cli.id_cliente = c.id_cliente
      ORDER BY c.data_cadastro DESC
    `);

    res.json({
      total: resultado.rows.length,
      contratos: resultado.rows
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao buscar contratos"
    });
  }
});


// CONTRATOS DE UM CLIENTE
router.get("/cliente/:id_cliente", async (req, res) => {
  try {
    const { id_cliente } = req.params;

    const resultado = await db.query(
      `
        SELECT *
        FROM contratos
        WHERE id_cliente = $1
        ORDER BY data_cadastro DESC
      `,
      [id_cliente]
    );

    res.json({
      total: resultado.rows.length,
      contratos: resultado.rows
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao buscar contratos do cliente"
    });
  }
});


// BUSCAR CONTRATO
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await db.query(
      `
        SELECT *
        FROM contratos
        WHERE
          id::text = $1
          OR id_contrato = $1
        LIMIT 1
      `,
      [id]
    );

    if (!resultado.rows.length) {
      return res.status(404).json({
        erro: "Contrato não encontrado"
      });
    }

    res.json({
      contrato: resultado.rows[0]
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao buscar contrato"
    });
  }
});


// CADASTRAR CONTRATO
router.post("/", async (req, res) => {
  try {
    const {
      id_contrato,
      id_cliente,
      titulo,
      tipo_contrato,
      status,
      data_inicio,
      data_vencimento,
      valor,
      descricao,
      nome_arquivo,
      id_arquivo,
      url_arquivo,
      pasta_drive_id,
      usuario_cadastro,
      observacoes
    } = req.body;

    if (!id_cliente) {
      return res.status(400).json({
        erro: "ID_CLIENTE é obrigatório"
      });
    }

    const cliente = await db.query(
      `
        SELECT id_cliente
        FROM clientes
        WHERE id_cliente = $1
        LIMIT 1
      `,
      [id_cliente]
    );

    if (!cliente.rows.length) {
      return res.status(400).json({
        erro: "Cliente informado não existe"
      });
    }

    const resultado = await db.query(
      `
        INSERT INTO contratos
        (
          id_contrato,
          id_cliente,
          titulo,
          tipo_contrato,
          status,
          data_inicio,
          data_vencimento,
          valor,
          descricao,
          nome_arquivo,
          id_arquivo,
          url_arquivo,
          pasta_drive_id,
          usuario_cadastro,
          ativo,
          observacoes,
          criado_por
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,
          $10,$11,$12,$13,$14,$15,$16,$17
        )
        RETURNING *
      `,
      [
        id_contrato || null,
        id_cliente,
        titulo || null,
        tipo_contrato || null,
        status || "ATIVO",
        data_inicio || null,
        data_vencimento || null,
        valor || null,
        descricao || null,
        nome_arquivo || null,
        id_arquivo || null,
        url_arquivo || null,
        pasta_drive_id || null,
        usuario_cadastro || null,
        true,
        observacoes || null,
        req.usuario.id
      ]
    );

    let contrato = resultado.rows[0];

    if (!contrato.id_contrato) {
      const novoId =
        `CONT_${String(contrato.id).padStart(6, "0")}`;

      const atualizado = await db.query(
        `
          UPDATE contratos
          SET id_contrato = $1
          WHERE id = $2
          RETURNING *
        `,
        [novoId, contrato.id]
      );

      contrato = atualizado.rows[0];
    }

    res.status(201).json({
      mensagem: "Contrato cadastrado com sucesso",
      contrato
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao cadastrar contrato"
    });
  }
});


// ATUALIZAR CONTRATO
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      id_cliente,
      titulo,
      tipo_contrato,
      status,
      data_inicio,
      data_vencimento,
      valor,
      descricao,
      nome_arquivo,
      id_arquivo,
      url_arquivo,
      pasta_drive_id,
      usuario_atualizacao,
      ativo,
      observacoes
    } = req.body;

    const resultado = await db.query(
      `
        UPDATE contratos
        SET
          id_cliente = $1,
          titulo = $2,
          tipo_contrato = $3,
          status = $4,
          data_inicio = $5,
          data_vencimento = $6,
          valor = $7,
          descricao = $8,
          nome_arquivo = $9,
          id_arquivo = $10,
          url_arquivo = $11,
          pasta_drive_id = $12,
          usuario_atualizacao = $13,
          ativo = $14,
          observacoes = $15,
          data_atualizacao = NOW()
        WHERE
          id::text = $16
          OR id_contrato = $16
        RETURNING *
      `,
      [
        id_cliente,
        titulo || null,
        tipo_contrato || null,
        status || "ATIVO",
        data_inicio || null,
        data_vencimento || null,
        valor || null,
        descricao || null,
        nome_arquivo || null,
        id_arquivo || null,
        url_arquivo || null,
        pasta_drive_id || null,
        usuario_atualizacao || null,
        ativo !== false,
        observacoes || null,
        id
      ]
    );

    if (!resultado.rows.length) {
      return res.status(404).json({
        erro: "Contrato não encontrado"
      });
    }

    res.json({
      mensagem: "Contrato atualizado com sucesso",
      contrato: resultado.rows[0]
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao atualizar contrato"
    });
  }
});


// INATIVAR CONTRATO
router.patch("/:id/inativar", async (req, res) => {
  try {
    const resultado = await db.query(
      `
        UPDATE contratos
        SET
          status = 'INATIVO',
          ativo = FALSE,
          data_atualizacao = NOW()
        WHERE
          id::text = $1
          OR id_contrato = $1
        RETURNING *
      `,
      [req.params.id]
    );

    if (!resultado.rows.length) {
      return res.status(404).json({
        erro: "Contrato não encontrado"
      });
    }

    res.json({
      mensagem: "Contrato inativado com sucesso",
      contrato: resultado.rows[0]
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao inativar contrato"
    });
  }
});


// ATIVAR CONTRATO
router.patch("/:id/ativar", async (req, res) => {
  try {
    const resultado = await db.query(
      `
        UPDATE contratos
        SET
          status = 'ATIVO',
          ativo = TRUE,
          data_atualizacao = NOW()
        WHERE
          id::text = $1
          OR id_contrato = $1
        RETURNING *
      `,
      [req.params.id]
    );

    if (!resultado.rows.length) {
      return res.status(404).json({
        erro: "Contrato não encontrado"
      });
    }

    res.json({
      mensagem: "Contrato ativado com sucesso",
      contrato: resultado.rows[0]
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao ativar contrato"
    });
  }
});


module.exports = router;