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


// CADASTRAR CLIENTE
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