const express = require("express");
const db = require("../database/db");
const verificarToken = require("../middleware/auth");

const router = express.Router();
router.use(verificarToken);

function valorOuNull(v) {
  return (v === undefined || v === null || v === "") ? null : v;
}

function numeroOuNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function booleanOuPadrao(v, padrao = true) {
  if (v === undefined || v === null || v === "") return padrao;
  if (typeof v === "boolean") return v;
  return !["false","0","nao","não","n","inativo"].includes(String(v).trim().toLowerCase());
}

function montarDadosContrato(body = {}) {
  return {
    id_contrato: valorOuNull(body.id_contrato ?? body.ID_CONTRATO),
    id_cliente: valorOuNull(body.id_cliente ?? body.ID_CLIENTE),
    titulo: valorOuNull(body.titulo ?? body.TITULO),
    tipo_contrato: valorOuNull(body.tipo_contrato ?? body.TIPO_CONTRATO),
    status: valorOuNull(body.status ?? body.STATUS) || "ATIVO",
    data_inicio: valorOuNull(body.data_inicio ?? body.DATA_INICIO),
    data_vencimento: valorOuNull(body.data_vencimento ?? body.DATA_VENCIMENTO),
    valor: numeroOuNull(body.valor ?? body.VALOR),
    descricao: valorOuNull(body.descricao ?? body.DESCRICAO),
    nome_arquivo: valorOuNull(body.nome_arquivo ?? body.NOME_ARQUIVO),
    id_arquivo: valorOuNull(body.id_arquivo ?? body.ID_ARQUIVO),
    url_arquivo: valorOuNull(body.url_arquivo ?? body.URL_ARQUIVO),
    pasta_drive_id: valorOuNull(body.pasta_drive_id ?? body.PASTA_DRIVE_ID),
    data_cadastro: valorOuNull(body.data_cadastro ?? body.DATA_CADASTRO),
    data_atualizacao: valorOuNull(body.data_atualizacao ?? body.DATA_ATUALIZACAO),
    usuario_cadastro: valorOuNull(body.usuario_cadastro ?? body.USUARIO_CADASTRO),
    usuario_atualizacao: valorOuNull(body.usuario_atualizacao ?? body.USUARIO_ATUALIZACAO),
    ativo: booleanOuPadrao(body.ativo ?? body.ATIVO, true),
    observacoes: valorOuNull(body.observacoes ?? body.OBSERVACOES)
  };
}

async function validarCliente(idCliente) {
  const r = await db.query(
    "SELECT id_cliente FROM clientes WHERE id_cliente = $1 LIMIT 1",
    [idCliente]
  );
  return r.rows.length > 0;
}

async function inserirContrato({ dados, usuarioId }) {
  const r = await db.query(
    `INSERT INTO contratos (
      id_contrato,id_cliente,titulo,tipo_contrato,status,data_inicio,data_vencimento,
      valor,descricao,nome_arquivo,id_arquivo,url_arquivo,pasta_drive_id,
      data_cadastro,data_atualizacao,usuario_cadastro,usuario_atualizacao,
      ativo,observacoes,criado_por
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
    ) RETURNING *`,
    [
      dados.id_contrato,dados.id_cliente,dados.titulo,dados.tipo_contrato,dados.status,
      dados.data_inicio,dados.data_vencimento,dados.valor,dados.descricao,dados.nome_arquivo,
      dados.id_arquivo,dados.url_arquivo,dados.pasta_drive_id,
      dados.data_cadastro || new Date(),dados.data_atualizacao || new Date(),
      dados.usuario_cadastro,dados.usuario_atualizacao,dados.ativo,dados.observacoes,usuarioId
    ]
  );

  let contrato = r.rows[0];

  if (!contrato.id_contrato) {
    const novoId = `CONT_${String(contrato.id).padStart(6, "0")}`;
    const u = await db.query(
      "UPDATE contratos SET id_contrato = $1 WHERE id = $2 RETURNING *",
      [novoId, contrato.id]
    );
    contrato = u.rows[0];
  }

  return contrato;
}

async function atualizarContrato({ id, dados }) {
  const r = await db.query(
    `UPDATE contratos SET
      id_cliente=$1,titulo=$2,tipo_contrato=$3,status=$4,data_inicio=$5,
      data_vencimento=$6,valor=$7,descricao=$8,nome_arquivo=$9,id_arquivo=$10,
      url_arquivo=$11,pasta_drive_id=$12,data_atualizacao=COALESCE($13,NOW()),
      usuario_atualizacao=$14,ativo=$15,observacoes=$16
     WHERE id=$17 RETURNING *`,
    [
      dados.id_cliente,dados.titulo,dados.tipo_contrato,dados.status,dados.data_inicio,
      dados.data_vencimento,dados.valor,dados.descricao,dados.nome_arquivo,dados.id_arquivo,
      dados.url_arquivo,dados.pasta_drive_id,dados.data_atualizacao,
      dados.usuario_atualizacao,dados.ativo,dados.observacoes,id
    ]
  );
  return r.rows[0];
}

router.get("/", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT c.*, cli.nome_completo AS cliente_nome
       FROM contratos c
       LEFT JOIN clientes cli ON cli.id_cliente = c.id_cliente
       ORDER BY c.data_cadastro DESC`
    );
    res.json({ total: r.rows.length, contratos: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao buscar contratos" });
  }
});

router.post("/importar", async (req, res) => {
  try {
    const { contratos } = req.body;

    if (!Array.isArray(contratos) || !contratos.length) {
      return res.status(400).json({ erro: "Envie uma lista de contratos" });
    }

    let inseridos = 0;
    let atualizados = 0;
    let ignorados = 0;
    const erros = [];

    for (const item of contratos) {
      try {
        const dados = montarDadosContrato(item);

        if (!dados.id_cliente) {
          ignorados++;
          erros.push({ id_contrato: dados.id_contrato, erro: "ID_CLIENTE não informado" });
          continue;
        }

        if (!(await validarCliente(dados.id_cliente))) {
          ignorados++;
          erros.push({
            id_contrato: dados.id_contrato,
            id_cliente: dados.id_cliente,
            erro: "Cliente não encontrado no PostgreSQL"
          });
          continue;
        }

        let existente = null;

        if (dados.id_contrato) {
          const b = await db.query(
            "SELECT id FROM contratos WHERE id_contrato = $1 LIMIT 1",
            [dados.id_contrato]
          );
          existente = b.rows[0] || null;
        }

        if (existente) {
          await atualizarContrato({ id: existente.id, dados });
          atualizados++;
        } else {
          await inserirContrato({ dados, usuarioId: req.usuario.id });
          inseridos++;
        }

      } catch (erroContrato) {
        erros.push({
          id_contrato: item.id_contrato ?? item.ID_CONTRATO ?? null,
          id_cliente: item.id_cliente ?? item.ID_CLIENTE ?? null,
          erro: erroContrato.message
        });
      }
    }

    res.json({
      mensagem: "Importação de contratos concluída",
      total_recebidos: contratos.length,
      inseridos,
      atualizados,
      ignorados,
      erros
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao importar contratos" });
  }
});

router.get("/cliente/:id_cliente", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM contratos WHERE id_cliente = $1 ORDER BY data_cadastro DESC",
      [req.params.id_cliente]
    );
    res.json({ total: r.rows.length, contratos: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao buscar contratos do cliente" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM contratos WHERE id::text = $1 OR id_contrato = $1 LIMIT 1",
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ erro: "Contrato não encontrado" });
    res.json({ contrato: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao buscar contrato" });
  }
});

router.post("/", async (req, res) => {
  try {
    const dados = montarDadosContrato(req.body);

    if (!dados.id_cliente) {
      return res.status(400).json({ erro: "ID_CLIENTE é obrigatório" });
    }

    if (!(await validarCliente(dados.id_cliente))) {
      return res.status(400).json({ erro: "Cliente informado não existe" });
    }

    if (dados.id_contrato) {
      const b = await db.query(
        "SELECT id FROM contratos WHERE id_contrato = $1 LIMIT 1",
        [dados.id_contrato]
      );
      if (b.rows.length) {
        return res.status(409).json({ erro: "Já existe contrato com este ID_CONTRATO" });
      }
    }

    const contrato = await inserirContrato({ dados, usuarioId: req.usuario.id });
    res.status(201).json({ mensagem: "Contrato cadastrado com sucesso", contrato });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao cadastrar contrato" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const b = await db.query(
      "SELECT id FROM contratos WHERE id::text = $1 OR id_contrato = $1 LIMIT 1",
      [req.params.id]
    );

    if (!b.rows.length) {
      return res.status(404).json({ erro: "Contrato não encontrado" });
    }

    const dados = montarDadosContrato(req.body);

    if (!dados.id_cliente) {
      return res.status(400).json({ erro: "ID_CLIENTE é obrigatório" });
    }

    if (!(await validarCliente(dados.id_cliente))) {
      return res.status(400).json({ erro: "Cliente informado não existe" });
    }

    const contrato = await atualizarContrato({ id: b.rows[0].id, dados });
    res.json({ mensagem: "Contrato atualizado com sucesso", contrato });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao atualizar contrato" });
  }
});

router.patch("/:id/inativar", async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE contratos SET status='INATIVO',ativo=FALSE,data_atualizacao=NOW()
       WHERE id::text=$1 OR id_contrato=$1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ erro: "Contrato não encontrado" });
    res.json({ mensagem: "Contrato inativado com sucesso", contrato: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao inativar contrato" });
  }
});

router.patch("/:id/ativar", async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE contratos SET status='ATIVO',ativo=TRUE,data_atualizacao=NOW()
       WHERE id::text=$1 OR id_contrato=$1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ erro: "Contrato não encontrado" });
    res.json({ mensagem: "Contrato ativado com sucesso", contrato: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao ativar contrato" });
  }
});

module.exports = router;
