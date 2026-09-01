const express = require("express");
const db = require("../database/db");
const verificarToken = require("../middleware/auth");

const router = express.Router();

// Todas as rotas abaixo exigem autenticação
router.use(verificarToken);


// ======================================================
// LISTAR CLIENTES
// ======================================================

router.get("/", async (req, res) => {
  try {
    const resultado = await db.query(`
      SELECT
        id,
        nome,
        nome_fantasia,
        razao_social,
        tipo_pessoa,
        cpf,
        cnpj,
        telefone,
        whatsapp,
        email,
        cep,
        endereco,
        numero,
        complemento,
        bairro,
        cidade,
        estado,
        segmento,
        origem,
        responsavel,
        status,
        etapa_jornada,
        observacoes,
        foto_url,
        pasta_drive_id,
        criado_por,
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


// ======================================================
// CADASTRAR CLIENTE
// ======================================================

router.post("/", async (req, res) => {
  try {
    const {
      nome,
      nome_fantasia,
      razao_social,
      tipo_pessoa,
      cpf,
      cnpj,
      telefone,
      whatsapp,
      email,
      cep,
      endereco,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      segmento,
      origem,
      responsavel,
      etapa_jornada,
      observacoes,
      foto_url,
      pasta_drive_id
    } = req.body;

    if (!nome) {
      return res.status(400).json({
        erro: "O nome do cliente é obrigatório"
      });
    }

    if (tipo_pessoa === "PF" && !cpf) {
      return res.status(400).json({
        erro: "CPF é obrigatório para pessoa física"
      });
    }

    if (tipo_pessoa === "PJ" && !cnpj) {
      return res.status(400).json({
        erro: "CNPJ é obrigatório para pessoa jurídica"
      });
    }

    // Verifica CPF duplicado
    if (cpf) {
      const cpfExistente = await db.query(
        "SELECT id FROM clientes WHERE cpf = $1",
        [cpf]
      );

      if (cpfExistente.rows.length > 0) {
        return res.status(409).json({
          erro: "Já existe um cliente cadastrado com este CPF"
        });
      }
    }

    // Verifica CNPJ duplicado
    if (cnpj) {
      const cnpjExistente = await db.query(
        "SELECT id FROM clientes WHERE cnpj = $1",
        [cnpj]
      );

      if (cnpjExistente.rows.length > 0) {
        return res.status(409).json({
          erro: "Já existe um cliente cadastrado com este CNPJ"
        });
      }
    }

    const resultado = await db.query(
      `
        INSERT INTO clientes
        (
          nome,
          nome_fantasia,
          razao_social,
          tipo_pessoa,
          cpf,
          cnpj,
          telefone,
          whatsapp,
          email,
          cep,
          endereco,
          numero,
          complemento,
          bairro,
          cidade,
          estado,
          segmento,
          origem,
          responsavel,
          etapa_jornada,
          observacoes,
          foto_url,
          pasta_drive_id,
          criado_por
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,
          $10,$11,$12,$13,$14,$15,$16,
          $17,$18,$19,
          $20,$21,
          $22,$23,
          $24
        )
        RETURNING *
      `,
      [
        nome,
        nome_fantasia || null,
        razao_social || null,
        tipo_pessoa || null,
        cpf || null,
        cnpj || null,
        telefone || null,
        whatsapp || null,
        email || null,
        cep || null,
        endereco || null,
        numero || null,
        complemento || null,
        bairro || null,
        cidade || null,
        estado || null,
        segmento || null,
        origem || null,
        responsavel || null,
        etapa_jornada || null,
        observacoes || null,
        foto_url || null,
        pasta_drive_id || null,
        req.usuario.id
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


// ======================================================
// BUSCAR CLIENTE POR ID
// ======================================================

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


// ======================================================
// ATUALIZAR CLIENTE
// ======================================================

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      nome,
      nome_fantasia,
      razao_social,
      tipo_pessoa,
      cpf,
      cnpj,
      telefone,
      whatsapp,
      email,
      cep,
      endereco,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      segmento,
      origem,
      responsavel,
      status,
      etapa_jornada,
      observacoes,
      foto_url,
      pasta_drive_id
    } = req.body;

    if (!nome) {
      return res.status(400).json({
        erro: "O nome do cliente é obrigatório"
      });
    }

    if (tipo_pessoa === "PF" && !cpf) {
      return res.status(400).json({
        erro: "CPF é obrigatório para pessoa física"
      });
    }

    if (tipo_pessoa === "PJ" && !cnpj) {
      return res.status(400).json({
        erro: "CNPJ é obrigatório para pessoa jurídica"
      });
    }

    // CPF pertence a outro cliente?
    if (cpf) {
      const cpfExistente = await db.query(
        `
          SELECT id
          FROM clientes
          WHERE cpf = $1
          AND id <> $2
        `,
        [cpf, id]
      );

      if (cpfExistente.rows.length > 0) {
        return res.status(409).json({
          erro: "Já existe outro cliente cadastrado com este CPF"
        });
      }
    }

    // CNPJ pertence a outro cliente?
    if (cnpj) {
      const cnpjExistente = await db.query(
        `
          SELECT id
          FROM clientes
          WHERE cnpj = $1
          AND id <> $2
        `,
        [cnpj, id]
      );

      if (cnpjExistente.rows.length > 0) {
        return res.status(409).json({
          erro: "Já existe outro cliente cadastrado com este CNPJ"
        });
      }
    }

    const resultado = await db.query(
      `
        UPDATE clientes
        SET
          nome = $1,
          nome_fantasia = $2,
          razao_social = $3,
          tipo_pessoa = $4,
          cpf = $5,
          cnpj = $6,
          telefone = $7,
          whatsapp = $8,
          email = $9,
          cep = $10,
          endereco = $11,
          numero = $12,
          complemento = $13,
          bairro = $14,
          cidade = $15,
          estado = $16,
          segmento = $17,
          origem = $18,
          responsavel = $19,
          status = $20,
          etapa_jornada = $21,
          observacoes = $22,
          foto_url = $23,
          pasta_drive_id = $24,
          atualizado_em = NOW()
        WHERE id = $25
        RETURNING *
      `,
      [
        nome,
        nome_fantasia || null,
        razao_social || null,
        tipo_pessoa || null,
        cpf || null,
        cnpj || null,
        telefone || null,
        whatsapp || null,
        email || null,
        cep || null,
        endereco || null,
        numero || null,
        complemento || null,
        bairro || null,
        cidade || null,
        estado || null,
        segmento || null,
        origem || null,
        responsavel || null,
        status || "ATIVO",
        etapa_jornada || null,
        observacoes || null,
        foto_url || null,
        pasta_drive_id || null,
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


// ======================================================
// ARQUIVAR / INATIVAR CLIENTE
// ======================================================

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await db.query(
      `
        UPDATE clientes
        SET
          status = 'INATIVO',
          atualizado_em = NOW()
        WHERE id = $1
        RETURNING id, nome, status
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        erro: "Cliente não encontrado"
      });
    }

    res.json({
      mensagem: "Cliente arquivado com sucesso",
      cliente: resultado.rows[0]
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao arquivar cliente"
    });
  }
});

router.patch("/:id/inativar", async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await db.query(
      `
        UPDATE clientes
        SET status = 'INATIVO',
            atualizado_em = NOW()
        WHERE id = $1
        RETURNING id, nome, status
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        erro: "Cliente não encontrado"
      });
    }

    res.json({
      mensagem: "Cliente inativado com sucesso",
      cliente: resultado.rows[0]
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao inativar cliente"
    });
  }
});

router.patch("/:id/ativar", async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await db.query(
      `
        UPDATE clientes
        SET status = 'ATIVO',
            atualizado_em = NOW()
        WHERE id = $1
        RETURNING id, nome, status
      `,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        erro: "Cliente não encontrado"
      });
    }

    res.json({
      mensagem: "Cliente ativado com sucesso",
      cliente: resultado.rows[0]
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao ativar cliente"
    });
  }
});

module.exports = router;