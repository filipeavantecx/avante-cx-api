const express = require("express");
const db = require("../database/db");
const verificarToken = require("../middleware/auth");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const router = express.Router();

function segredoCrmJwtJornada_() {
  const dedicado = String(process.env.CRM_JWT_SECRET || "").trim();
  if (dedicado) return dedicado;

  const base = String(process.env.JWT_SECRET || "").trim();

  if (!base) {
    throw new Error("JWT_SECRET não configurado no Railway");
  }

  return crypto
    .createHmac("sha256", base)
    .update("AVANTE_CRM_WEB_V1", "utf8")
    .digest("hex");
}

function boolJornada_(valor) {
  if (valor === true || valor === 1) return true;

  return ["TRUE", "1", "SIM", "S", "YES", "Y"]
    .includes(String(valor || "").trim().toUpperCase());
}

async function verificarTokenCrmJornada_(req, res, next) {
  try {
    const cabecalho = String(req.headers.authorization || "");
    const token = cabecalho.startsWith("Bearer ")
      ? cabecalho.slice(7).trim()
      : "";

    if (!token) {
      return res.status(401).json({
        autenticado: false,
        erro: "Sessão não informada"
      });
    }

    const payload = jwt.verify(
      token,
      segredoCrmJwtJornada_(),
      {
        issuer: "avante-cx",
        audience: "avante-cx-web"
      }
    );

    if (payload.tipo !== "crm") {
      return res.status(401).json({
        autenticado: false,
        erro: "Token CRM inválido"
      });
    }

    const r = await db.query(
      `SELECT
         usuario_id,
         nome,
         email,
         login,
         perfil,
         status,
         pode_jornada
       FROM usuarios_legado
       WHERE usuario_id = $1
       LIMIT 1`,
      [payload.id]
    );

    if (!r.rows.length) {
      return res.status(401).json({
        autenticado: false,
        erro: "Usuário não encontrado"
      });
    }

    const usuario = r.rows[0];

    if (String(usuario.status || "").trim().toUpperCase() !== "ATIVO") {
      return res.status(403).json({
        autenticado: false,
        erro: "Usuário inativo"
      });
    }

    const perfil = String(usuario.perfil || "").trim().toUpperCase();

    const permitido =
      boolJornada_(usuario.pode_jornada) ||
      ["ADMINISTRADOR", "GESTOR", "MENTOR"].includes(perfil);

    if (!permitido) {
      return res.status(403).json({
        erro: "Você não possui permissão para acessar Jornada."
      });
    }

    req.usuarioCrm = {
      id: usuario.usuario_id,
      nome: usuario.nome || "",
      email: usuario.email || "",
      login: usuario.login || "",
      perfil: usuario.perfil || ""
    };

    return next();

  } catch (erro) {
    return res.status(401).json({
      autenticado: false,
      expirada: erro?.name === "TokenExpiredError",
      erro: "Sessão inválida ou expirada"
    });
  }
}

/*
 * As rotas /crm-jornada/* usam o novo JWT CRM.
 * As rotas antigas continuam usando o token técnico anterior.
 */
router.use((req, res, next) => {
  if (req.path.startsWith("/crm-jornada")) {
    return verificarTokenCrmJornada_(req, res, next);
  }

  return verificarToken(req, res, next);
});

// ======================================================
// HELPERS
// ======================================================

const vazioNull = (v) =>
  v === undefined || v === null || v === "" ? null : v;

const numeroNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function existeCliente(clienteId) {
  if (!clienteId) return false;

  const r = await db.query(
    "SELECT id FROM clientes WHERE id_cliente = $1 LIMIT 1",
    [clienteId]
  );

  return r.rows.length > 0;
}

async function existeContrato(contratoId) {
  if (!contratoId) return true;

  const r = await db.query(
    "SELECT id FROM contratos WHERE id_contrato = $1 LIMIT 1",
    [contratoId]
  );

  return r.rows.length > 0;
}

async function existeSessao(sessaoId) {
  if (!sessaoId) return true;

  const r = await db.query(
    "SELECT id FROM sessoes WHERE sessao_id = $1 LIMIT 1",
    [sessaoId]
  );

  return r.rows.length > 0;
}

function novoId(prefixo, id) {
  return `${prefixo}_${String(id).padStart(6, "0")}`;
}

// ======================================================
// JORNADA
// ======================================================

router.get("/jornada", async (req, res) => {
  try {
    const r = await db.query(`
      SELECT j.*, c.nome_completo AS cliente_nome
      FROM jornada j
      LEFT JOIN clientes c ON c.id_cliente = j.cliente_id
      ORDER BY j.data_entrada DESC NULLS LAST, j.id DESC
    `);

    res.json({ total: r.rows.length, jornada: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar jornada" });
  }
});

router.get("/jornada/cliente/:cliente_id", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT * FROM jornada
       WHERE cliente_id = $1
       ORDER BY data_entrada DESC NULLS LAST`,
      [req.params.cliente_id]
    );

    res.json({ total: r.rows.length, jornada: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao buscar jornada do cliente" });
  }
});

router.post("/jornada/importar", async (req, res) => {
  try {
    const itens = req.body.jornada;

    if (!Array.isArray(itens)) {
      return res.status(400).json({ erro: "Envie jornada como array" });
    }

    let inseridos = 0, atualizados = 0, ignorados = 0;
    const erros = [];

    for (const item of itens) {
      try {
        const dados = {
          jornada_id: vazioNull(item.JORNADA_ID ?? item.jornada_id),
          cliente_id: vazioNull(item.CLIENTE_ID ?? item.cliente_id),
          contrato_id: vazioNull(item.CONTRATO_ID ?? item.contrato_id),
          etapa: vazioNull(item.ETAPA ?? item.etapa),
          data_entrada: vazioNull(item.DATA_ENTRADA ?? item.data_entrada),
          data_saida: vazioNull(item.DATA_SAIDA ?? item.data_saida),
          responsavel_id: vazioNull(item.RESPONSAVEL_ID ?? item.responsavel_id),
          status: vazioNull(item.STATUS ?? item.status) || "ATIVO",
          score: numeroNull(item.SCORE ?? item.score),
          observacoes: vazioNull(item.OBSERVACOES ?? item.observacoes)
        };

        if (!dados.cliente_id || !(await existeCliente(dados.cliente_id))) {
          ignorados++;
          erros.push({ jornada_id: dados.jornada_id, erro: "CLIENTE_ID inválido" });
          continue;
        }

        if (!(await existeContrato(dados.contrato_id))) {
          ignorados++;
          erros.push({ jornada_id: dados.jornada_id, erro: "CONTRATO_ID inválido" });
          continue;
        }

        let existente = null;

        if (dados.jornada_id) {
          const b = await db.query(
            "SELECT id FROM jornada WHERE jornada_id = $1 LIMIT 1",
            [dados.jornada_id]
          );
          existente = b.rows[0] || null;
        }

        if (existente) {
          await db.query(
            `UPDATE jornada SET
              cliente_id=$1, contrato_id=$2, etapa=$3, data_entrada=$4,
              data_saida=$5, responsavel_id=$6, status=$7, score=$8,
              observacoes=$9, atualizado_em=NOW()
             WHERE id=$10`,
            [
              dados.cliente_id,dados.contrato_id,dados.etapa,dados.data_entrada,
              dados.data_saida,dados.responsavel_id,dados.status,dados.score,
              dados.observacoes,existente.id
            ]
          );
          atualizados++;
        } else {
          const r = await db.query(
            `INSERT INTO jornada
             (jornada_id,cliente_id,contrato_id,etapa,data_entrada,data_saida,
              responsavel_id,status,score,observacoes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING id,jornada_id`,
            [
              dados.jornada_id,dados.cliente_id,dados.contrato_id,dados.etapa,
              dados.data_entrada,dados.data_saida,dados.responsavel_id,
              dados.status,dados.score,dados.observacoes
            ]
          );

          if (!r.rows[0].jornada_id) {
            await db.query(
              "UPDATE jornada SET jornada_id=$1 WHERE id=$2",
              [novoId("JOR", r.rows[0].id), r.rows[0].id]
            );
          }

          inseridos++;
        }

      } catch (e) {
        erros.push({
          jornada_id: item.JORNADA_ID ?? item.jornada_id ?? null,
          erro: e.message
        });
      }
    }

    res.json({
      modulo: "JORNADA",
      total_recebidos: itens.length,
      inseridos,
      atualizados,
      ignorados,
      erros
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao importar jornada" });
  }
});

// ======================================================
// SESSÕES
// ======================================================

router.get("/sessoes", async (req, res) => {
  try {
    const r = await db.query(`
      SELECT s.*, c.nome_completo AS cliente_nome
      FROM sessoes s
      LEFT JOIN clientes c ON c.id_cliente = s.cliente_id
      ORDER BY s.data DESC NULLS LAST, s.hora_inicio DESC NULLS LAST
    `);

    res.json({ total: r.rows.length, sessoes: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar sessões" });
  }
});

router.get("/sessoes/cliente/:cliente_id", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT * FROM sessoes WHERE cliente_id=$1
       ORDER BY data DESC NULLS LAST`,
      [req.params.cliente_id]
    );

    res.json({ total: r.rows.length, sessoes: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao buscar sessões do cliente" });
  }
});

router.post("/sessoes/importar", async (req, res) => {
  try {
    const itens = req.body.sessoes;

    if (!Array.isArray(itens)) {
      return res.status(400).json({ erro: "Envie sessoes como array" });
    }

    let inseridos = 0, atualizados = 0, ignorados = 0;
    const erros = [];

    for (const item of itens) {
      try {
        const dados = {
          sessao_id: vazioNull(item.SESSAO_ID ?? item.sessao_id),
          cliente_id: vazioNull(item.CLIENTE_ID ?? item.cliente_id),
          mentor_id: vazioNull(item.MENTOR_ID ?? item.mentor_id),
          contrato_id: vazioNull(item.CONTRATO_ID ?? item.contrato_id),
          data: vazioNull(item.DATA ?? item.data),
          hora_inicio: vazioNull(item.HORA_INICIO ?? item.hora_inicio),
          hora_fim: vazioNull(item.HORA_FIM ?? item.hora_fim),
          tipo: vazioNull(item.TIPO ?? item.tipo),
          tema: vazioNull(item.TEMA ?? item.tema),
          objetivo: vazioNull(item.OBJETIVO ?? item.objetivo),
          status: vazioNull(item.STATUS ?? item.status),
          presenca: vazioNull(item.PRESENCA ?? item.presenca),
          avaliacao: numeroNull(item.AVALIACAO ?? item.avaliacao),
          observacoes: vazioNull(item.OBSERVACOES ?? item.observacoes)
        };

        if (!dados.cliente_id || !(await existeCliente(dados.cliente_id))) {
          ignorados++;
          erros.push({ sessao_id: dados.sessao_id, erro: "CLIENTE_ID inválido" });
          continue;
        }

        if (!(await existeContrato(dados.contrato_id))) {
          ignorados++;
          erros.push({ sessao_id: dados.sessao_id, erro: "CONTRATO_ID inválido" });
          continue;
        }

        let existente = null;

        if (dados.sessao_id) {
          const b = await db.query(
            "SELECT id FROM sessoes WHERE sessao_id=$1 LIMIT 1",
            [dados.sessao_id]
          );
          existente = b.rows[0] || null;
        }

        if (existente) {
          await db.query(
            `UPDATE sessoes SET
              cliente_id=$1,mentor_id=$2,contrato_id=$3,data=$4,hora_inicio=$5,
              hora_fim=$6,tipo=$7,tema=$8,objetivo=$9,status=$10,presenca=$11,
              avaliacao=$12,observacoes=$13,atualizado_em=NOW()
             WHERE id=$14`,
            [
              dados.cliente_id,dados.mentor_id,dados.contrato_id,dados.data,
              dados.hora_inicio,dados.hora_fim,dados.tipo,dados.tema,dados.objetivo,
              dados.status,dados.presenca,dados.avaliacao,dados.observacoes,existente.id
            ]
          );
          atualizados++;
        } else {
          const r = await db.query(
            `INSERT INTO sessoes
             (sessao_id,cliente_id,mentor_id,contrato_id,data,hora_inicio,hora_fim,
              tipo,tema,objetivo,status,presenca,avaliacao,observacoes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             RETURNING id,sessao_id`,
            [
              dados.sessao_id,dados.cliente_id,dados.mentor_id,dados.contrato_id,
              dados.data,dados.hora_inicio,dados.hora_fim,dados.tipo,dados.tema,
              dados.objetivo,dados.status,dados.presenca,dados.avaliacao,dados.observacoes
            ]
          );

          if (!r.rows[0].sessao_id) {
            await db.query(
              "UPDATE sessoes SET sessao_id=$1 WHERE id=$2",
              [novoId("SES", r.rows[0].id), r.rows[0].id]
            );
          }

          inseridos++;
        }

      } catch (e) {
        erros.push({
          sessao_id: item.SESSAO_ID ?? item.sessao_id ?? null,
          erro: e.message
        });
      }
    }

    res.json({
      modulo: "SESSOES",
      total_recebidos: itens.length,
      inseridos,
      atualizados,
      ignorados,
      erros
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao importar sessões" });
  }
});

// ======================================================
// ATIVIDADES
// ======================================================

router.get("/atividades", async (req, res) => {
  try {
    const r = await db.query(`
      SELECT a.*, c.nome_completo AS cliente_nome
      FROM atividades a
      LEFT JOIN clientes c ON c.id_cliente = a.cliente_id
      ORDER BY a.data_criacao DESC NULLS LAST, a.id DESC
    `);

    res.json({ total: r.rows.length, atividades: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar atividades" });
  }
});

router.post("/atividades/importar", async (req, res) => {
  try {
    const itens = req.body.atividades;

    if (!Array.isArray(itens)) {
      return res.status(400).json({ erro: "Envie atividades como array" });
    }

    let inseridos = 0, atualizados = 0, ignorados = 0;
    const erros = [];

    for (const item of itens) {
      try {
        const dados = {
          atividade_id: vazioNull(item.ATIVIDADE_ID ?? item.atividade_id),
          cliente_id: vazioNull(item.CLIENTE_ID ?? item.cliente_id),
          sessao_id: vazioNull(item.SESSAO_ID ?? item.sessao_id),
          mentor_id: vazioNull(item.MENTOR_ID ?? item.mentor_id),
          descricao: vazioNull(item.DESCRICAO ?? item.descricao),
          categoria: vazioNull(item.CATEGORIA ?? item.categoria),
          data_criacao: vazioNull(item.DATA_CRIACAO ?? item.data_criacao),
          prazo: vazioNull(item.PRAZO ?? item.prazo),
          data_conclusao: vazioNull(item.DATA_CONCLUSAO ?? item.data_conclusao),
          prioridade: vazioNull(item.PRIORIDADE ?? item.prioridade),
          status: vazioNull(item.STATUS ?? item.status),
          resultado: vazioNull(item.RESULTADO ?? item.resultado),
          observacoes: vazioNull(item.OBSERVACOES ?? item.observacoes)
        };

        if (!dados.cliente_id || !(await existeCliente(dados.cliente_id))) {
          ignorados++;
          erros.push({ atividade_id: dados.atividade_id, erro: "CLIENTE_ID inválido" });
          continue;
        }

        if (!(await existeSessao(dados.sessao_id))) {
          ignorados++;
          erros.push({ atividade_id: dados.atividade_id, erro: "SESSAO_ID inválido" });
          continue;
        }

        let existente = null;

        if (dados.atividade_id) {
          const b = await db.query(
            "SELECT id FROM atividades WHERE atividade_id=$1 LIMIT 1",
            [dados.atividade_id]
          );
          existente = b.rows[0] || null;
        }

        if (existente) {
          await db.query(
            `UPDATE atividades SET
              cliente_id=$1,sessao_id=$2,mentor_id=$3,descricao=$4,categoria=$5,
              data_criacao=$6,prazo=$7,data_conclusao=$8,prioridade=$9,status=$10,
              resultado=$11,observacoes=$12,atualizado_em=NOW()
             WHERE id=$13`,
            [
              dados.cliente_id,dados.sessao_id,dados.mentor_id,dados.descricao,
              dados.categoria,dados.data_criacao,dados.prazo,dados.data_conclusao,
              dados.prioridade,dados.status,dados.resultado,dados.observacoes,existente.id
            ]
          );
          atualizados++;
        } else {
          const r = await db.query(
            `INSERT INTO atividades
             (atividade_id,cliente_id,sessao_id,mentor_id,descricao,categoria,
              data_criacao,prazo,data_conclusao,prioridade,status,resultado,observacoes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING id,atividade_id`,
            [
              dados.atividade_id,dados.cliente_id,dados.sessao_id,dados.mentor_id,
              dados.descricao,dados.categoria,dados.data_criacao,dados.prazo,
              dados.data_conclusao,dados.prioridade,dados.status,dados.resultado,
              dados.observacoes
            ]
          );

          if (!r.rows[0].atividade_id) {
            await db.query(
              "UPDATE atividades SET atividade_id=$1 WHERE id=$2",
              [novoId("ATI", r.rows[0].id), r.rows[0].id]
            );
          }

          inseridos++;
        }

      } catch (e) {
        erros.push({
          atividade_id: item.ATIVIDADE_ID ?? item.atividade_id ?? null,
          erro: e.message
        });
      }
    }

    res.json({
      modulo: "ATIVIDADES",
      total_recebidos: itens.length,
      inseridos,
      atualizados,
      ignorados,
      erros
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao importar atividades" });
  }
});


// ======================================================
// JORNADA CRM - RUNTIME WEB
// Navegador -> Railway/Node -> PostgreSQL
// ======================================================

function registroMetaWeb_(row) {
  row = row || {};

  return {
    ID_META: row.meta_id || "",
    ID_CLIENTE: row.cliente_id || "",
    JORNADA_ID: row.jornada_id || "",
    TITULO: row.meta || row.descricao || "Meta",
    DESCRICAO: row.descricao || "",
    CATEGORIA: row.categoria || "",
    INDICADOR: row.indicador || "",
    VALOR_INICIAL: Number(row.valor_inicial || 0),
    VALOR_ATUAL: Number(row.valor_atual || 0),
    VALOR_META: Number(row.valor_meta || 0),
    UNIDADE: row.unidade || "",
    DATA_INICIO: row.data_inicio || "",
    DATA_PREVISTA: row.data_limite || "",
    DATA_LIMITE: row.data_limite || "",
    PERCENTUAL_CONCLUSAO: Number(row.percentual || 0),
    STATUS: row.status || "PENDENTE",
    PRIORIDADE: row.prioridade || "MEDIA",
    OBSERVACOES: row.observacoes || ""
  };
}

function registroAtividadeWeb_(row) {
  row = row || {};

  return {
    ID_ATIVIDADE: row.atividade_id || "",
    ID_CLIENTE: row.cliente_id || "",
    ID_SESSAO: row.sessao_id || "",
    TITULO: row.descricao || "Atividade",
    DESCRICAO: row.observacoes || "",
    CATEGORIA: row.categoria || "",
    PRIORIDADE: row.prioridade || "MEDIA",
    STATUS: row.status || "PENDENTE",
    RESPONSAVEL: row.mentor_id || "",
    DATA_CRIACAO: row.data_criacao || "",
    PRAZO: row.prazo || "",
    DATA_CONCLUSAO: row.data_conclusao || "",
    RESULTADO: row.resultado || ""
  };
}

function registroSessaoWeb_(row) {
  row = row || {};

  return {
    ID_SESSAO: row.sessao_id || "",
    ID_CLIENTE: row.cliente_id || "",
    DATA: row.data || "",
    HORA_INICIO: row.hora_inicio || "",
    HORA_FIM: row.hora_fim || "",
    TIPO_SESSAO: row.tipo || "Mentoria",
    FORMATO: row.formato || "",
    MENTOR_CONSULTOR: row.mentor_id || "",
    STATUS: row.status || "AGENDADA",
    PAUTA: row.tema || "",
    RESUMO: row.objetivo || "",
    OBSERVACOES: row.observacoes || ""
  };
}

function percentualMetaWeb_(inicial, meta, atual) {
  inicial = Number(inicial || 0);
  meta = Number(meta || 0);
  atual = Number(atual || 0);

  const distancia = meta - inicial;

  if (!distancia) {
    return atual >= meta && meta !== 0 ? 100 : 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Number((((atual - inicial) / distancia) * 100).toFixed(2))
    )
  );
}

router.get("/crm-jornada/resumo/:cliente_id", async (req, res) => {
  try {
    const clienteId = String(req.params.cliente_id || "").trim();

    if (!clienteId) {
      return res.status(400).json({ erro: "CLIENTE_ID obrigatório" });
    }

    const [clienteR, jornadaR, metasR, atividadesR, sessoesR] =
      await Promise.all([
        db.query(
          `SELECT *
           FROM clientes
           WHERE id_cliente = $1
           LIMIT 1`,
          [clienteId]
        ),

        db.query(
          `SELECT *
           FROM jornada
           WHERE cliente_id = $1
           ORDER BY data_entrada DESC NULLS LAST, id DESC
           LIMIT 1`,
          [clienteId]
        ),

        db.query(
          `SELECT *
           FROM metas
           WHERE cliente_id = $1
           ORDER BY data_limite DESC NULLS LAST, id DESC`,
          [clienteId]
        ),

        db.query(
          `SELECT *
           FROM atividades
           WHERE cliente_id = $1
           ORDER BY data_criacao DESC NULLS LAST, id DESC`,
          [clienteId]
        ),

        db.query(
          `SELECT *
           FROM sessoes
           WHERE cliente_id = $1
           ORDER BY data DESC NULLS LAST, hora_inicio DESC NULLS LAST`,
          [clienteId]
        )
      ]);

    if (!clienteR.rows.length) {
      return res.status(404).json({ erro: "Cliente não encontrado" });
    }

    const c = clienteR.rows[0];
    const j = jornadaR.rows[0] || {};

    return res.json({
      sucesso: true,
      fonte: "API_POSTGRESQL",
      cliente: {
        ID_CLIENTE: c.id_cliente || "",
        NOME_COMPLETO: c.nome_completo || "",
        EMPRESA: c.empresa || "",
        ETAPA_JORNADA: c.etapa_jornada || j.etapa || "",
        HEALTH_SCORE: Number(c.health_score ?? j.score ?? 0),
        OBJETIVO_PRINCIPAL: c.objetivo_principal || "",
        META_PRINCIPAL: c.meta_principal || "",
        PROXIMA_SESSAO: c.proxima_sessao || "",
        MENTOR_CONSULTOR: c.mentor_consultor || ""
      },
      jornada: {
        JORNADA_ID: j.jornada_id || "",
        ID_CLIENTE: clienteId,
        ETAPA_JORNADA: j.etapa || c.etapa_jornada || "",
        HEALTH_SCORE: Number(j.score ?? c.health_score ?? 0),
        OBJETIVO_PRINCIPAL: c.objetivo_principal || "",
        META_PRINCIPAL: c.meta_principal || "",
        MENTOR_CONSULTOR: c.mentor_consultor || ""
      },
      metas: metasR.rows.map(registroMetaWeb_),
      atividades: atividadesR.rows.map(registroAtividadeWeb_),
      sessoes: sessoesR.rows.map(registroSessaoWeb_)
    });

  } catch (erro) {
    console.error("crm-jornada/resumo:", erro);
    return res.status(500).json({
      erro: "Erro ao carregar jornada",
      detalhe: erro?.message || null
    });
  }
});

router.post("/crm-jornada/metas", async (req, res) => {
  try {
    const d = req.body || {};
    const clienteId = vazioNull(d.ID_CLIENTE ?? d.cliente_id);

    if (!clienteId || !(await existeCliente(clienteId))) {
      return res.status(400).json({ erro: "CLIENTE_ID inválido" });
    }

    const titulo = vazioNull(d.TITULO ?? d.meta);
    if (!titulo) {
      return res.status(400).json({ erro: "Título da meta obrigatório" });
    }

    const valorInicial = numeroNull(d.VALOR_INICIAL ?? d.valor_inicial) ?? 0;
    const valorMeta = numeroNull(d.VALOR_META ?? d.valor_meta) ?? 0;
    const valorAtual = numeroNull(d.VALOR_ATUAL ?? d.valor_atual) ?? 0;

    const percentual = percentualMetaWeb_(
      valorInicial,
      valorMeta,
      valorAtual
    );

    const seq = await db.query(
      `SELECT nextval(pg_get_serial_sequence('metas','id'))::bigint AS id`
    );

    const idNumerico = Number(seq.rows[0].id);
    const metaId = novoId("MET", idNumerico);

    const r = await db.query(
      `INSERT INTO metas
       (
         id,
         meta_id,
         cliente_id,
         categoria,
         meta,
         descricao,
         valor_inicial,
         valor_atual,
         valor_meta,
         data_inicio,
         data_limite,
         percentual,
         status,
         observacoes
       )
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        idNumerico,
        metaId,
        clienteId,
        vazioNull(d.CATEGORIA ?? d.categoria),
        titulo,
        vazioNull(d.DESCRICAO ?? d.descricao),
        valorInicial,
        valorAtual,
        valorMeta,
        vazioNull(d.DATA_INICIO ?? d.data_inicio) || new Date(),
        vazioNull(
          d.DATA_PREVISTA ??
          d.DATA_LIMITE ??
          d.data_limite
        ),
        percentual,
        vazioNull(d.STATUS ?? d.status) || "PENDENTE",
        vazioNull(d.OBSERVACOES ?? d.observacoes)
      ]
    );

    const row = r.rows[0];

    return res.status(201).json({
      sucesso: true,
      mensagem: "Meta criada com sucesso.",
      meta: registroMetaWeb_(row)
    });

  } catch (erro) {
    console.error("crm-jornada/metas POST:", erro);
    return res.status(500).json({
      erro: "Erro ao salvar meta: " + (erro?.message || "erro interno")
    });
  }
});

router.put("/crm-jornada/metas/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const d = req.body || {};

    const atualR = await db.query(
      `SELECT * FROM metas
       WHERE meta_id = $1 OR id::text = $1
       LIMIT 1`,
      [id]
    );

    if (!atualR.rows.length) {
      return res.status(404).json({ erro: "Meta não encontrada" });
    }

    const atual = atualR.rows[0];

    const valorInicial =
      numeroNull(d.VALOR_INICIAL ?? d.valor_inicial) ??
      Number(atual.valor_inicial || 0);

    const valorMeta =
      numeroNull(d.VALOR_META ?? d.valor_meta) ??
      Number(atual.valor_meta || 0);

    const valorAtual =
      numeroNull(d.VALOR_ATUAL ?? d.valor_atual) ??
      Number(atual.valor_atual || 0);

    const status =
      vazioNull(d.STATUS ?? d.status) ||
      atual.status ||
      "PENDENTE";

    const percentual =
      String(status).toUpperCase() === "CONCLUIDA"
        ? 100
        : percentualMetaWeb_(valorInicial, valorMeta, valorAtual);

    const r = await db.query(
      `UPDATE metas SET
         categoria = COALESCE($1, categoria),
         meta = COALESCE($2, meta),
         descricao = COALESCE($3, descricao),
         valor_inicial = $4,
         valor_atual = $5,
         valor_meta = $6,
         data_limite = COALESCE($7, data_limite),
         percentual = $8,
         status = $9,
         observacoes = COALESCE($10, observacoes),
         atualizado_em = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        vazioNull(d.CATEGORIA ?? d.categoria),
        vazioNull(d.TITULO ?? d.meta),
        vazioNull(d.DESCRICAO ?? d.descricao),
        valorInicial,
        valorAtual,
        valorMeta,
        vazioNull(
          d.DATA_PREVISTA ??
          d.DATA_LIMITE ??
          d.data_limite
        ),
        percentual,
        status,
        vazioNull(d.OBSERVACOES ?? d.observacoes),
        atual.id
      ]
    );

    return res.json({
      sucesso: true,
      mensagem: "Meta atualizada com sucesso.",
      meta: registroMetaWeb_(r.rows[0])
    });

  } catch (erro) {
    console.error("crm-jornada/metas PUT:", erro);
    return res.status(500).json({
      erro: "Erro ao atualizar meta: " + (erro?.message || "erro interno")
    });
  }
});

router.post("/crm-jornada/atividades", async (req, res) => {
  try {
    const d = req.body || {};
    const clienteId = vazioNull(d.ID_CLIENTE ?? d.cliente_id);

    if (!clienteId || !(await existeCliente(clienteId))) {
      return res.status(400).json({ erro: "CLIENTE_ID inválido" });
    }

    const titulo = vazioNull(d.TITULO ?? d.descricao);

    if (!titulo) {
      return res.status(400).json({ erro: "Título da atividade obrigatório" });
    }

    const seq = await db.query(
      `SELECT nextval(pg_get_serial_sequence('atividades','id'))::bigint AS id`
    );

    const idNumerico = Number(seq.rows[0].id);
    const atividadeId = novoId("ATI", idNumerico);

    const r = await db.query(
      `INSERT INTO atividades
       (
         id,
         atividade_id,
         cliente_id,
         mentor_id,
         descricao,
         categoria,
         data_criacao,
         prazo,
         prioridade,
         status,
         observacoes
       )
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9,$10)
       RETURNING *`,
      [
        idNumerico,
        atividadeId,
        clienteId,
        vazioNull(d.RESPONSAVEL ?? d.mentor_id),
        titulo,
        vazioNull(d.CATEGORIA ?? d.categoria),
        vazioNull(d.PRAZO ?? d.prazo),
        vazioNull(d.PRIORIDADE ?? d.prioridade) || "MEDIA",
        vazioNull(d.STATUS ?? d.status) || "PENDENTE",
        vazioNull(d.DESCRICAO ?? d.observacoes)
      ]
    );

    const row = r.rows[0];

    return res.status(201).json({
      sucesso: true,
      mensagem: "Atividade criada com sucesso.",
      atividade: registroAtividadeWeb_(row)
    });

  } catch (erro) {
    console.error("crm-jornada/atividades POST:", erro);
    return res.status(500).json({
      erro: "Erro ao salvar atividade: " + (erro?.message || "erro interno")
    });
  }
});

router.put("/crm-jornada/atividades/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const d = req.body || {};

    const atualR = await db.query(
      `SELECT * FROM atividades
       WHERE atividade_id = $1 OR id::text = $1
       LIMIT 1`,
      [id]
    );

    if (!atualR.rows.length) {
      return res.status(404).json({ erro: "Atividade não encontrada" });
    }

    const atual = atualR.rows[0];

    const r = await db.query(
      `UPDATE atividades SET
         mentor_id = COALESCE($1, mentor_id),
         descricao = COALESCE($2, descricao),
         categoria = COALESCE($3, categoria),
         prazo = COALESCE($4, prazo),
         prioridade = COALESCE($5, prioridade),
         status = COALESCE($6, status),
         data_conclusao =
           CASE
             WHEN UPPER(COALESCE($6, status, '')) = 'CONCLUIDA'
             THEN COALESCE(data_conclusao, NOW())
             ELSE data_conclusao
           END,
         observacoes = COALESCE($7, observacoes),
         atualizado_em = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        vazioNull(d.RESPONSAVEL ?? d.mentor_id),
        vazioNull(d.TITULO ?? d.descricao),
        vazioNull(d.CATEGORIA ?? d.categoria),
        vazioNull(d.PRAZO ?? d.prazo),
        vazioNull(d.PRIORIDADE ?? d.prioridade),
        vazioNull(d.STATUS ?? d.status),
        vazioNull(d.DESCRICAO ?? d.observacoes),
        atual.id
      ]
    );

    return res.json({
      sucesso: true,
      mensagem: "Atividade atualizada com sucesso.",
      atividade: registroAtividadeWeb_(r.rows[0])
    });

  } catch (erro) {
    console.error("crm-jornada/atividades PUT:", erro);
    return res.status(500).json({
      erro: "Erro ao atualizar atividade: " + (erro?.message || "erro interno")
    });
  }
});

router.post("/crm-jornada/sessoes", async (req, res) => {
  try {
    const d = req.body || {};
    const clienteId = vazioNull(d.ID_CLIENTE ?? d.cliente_id);

    if (!clienteId || !(await existeCliente(clienteId))) {
      return res.status(400).json({ erro: "CLIENTE_ID inválido" });
    }

    const seq = await db.query(
      `SELECT nextval(pg_get_serial_sequence('sessoes','id'))::bigint AS id`
    );

    const idNumerico = Number(seq.rows[0].id);
    const sessaoId = novoId("SES", idNumerico);

    const r = await db.query(
      `INSERT INTO sessoes
       (
         id,
         sessao_id,
         cliente_id,
         mentor_id,
         data,
         hora_inicio,
         hora_fim,
         tipo,
         tema,
         objetivo,
         status,
         observacoes
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        idNumerico,
        sessaoId,
        clienteId,
        vazioNull(d.MENTOR_CONSULTOR ?? d.mentor_id),
        vazioNull(d.DATA ?? d.data) || new Date(),
        vazioNull(d.HORA_INICIO ?? d.hora_inicio),
        vazioNull(d.HORA_FIM ?? d.hora_fim),
        vazioNull(d.TIPO_SESSAO ?? d.tipo) || "Mentoria",
        vazioNull(d.PAUTA ?? d.tema),
        vazioNull(d.RESUMO ?? d.objetivo),
        vazioNull(d.STATUS ?? d.status) || "AGENDADA",
        vazioNull(d.OBSERVACOES ?? d.observacoes)
      ]
    );

    const row = r.rows[0];

    /*
     * Atualiza próxima sessão no cliente quando a coluna existe.
     * Se a instalação ainda não tiver essa coluna, a sessão continua salva.
     */
    try {
      await db.query(
        `UPDATE clientes
         SET proxima_sessao = $1,
             atualizado_em = NOW()
         WHERE id_cliente = $2`,
        [row.data, clienteId]
      );
    } catch (e) {
      console.warn(
        "Sessão salva; próxima sessão do cliente não atualizada:",
        e?.message || e
      );
    }

    return res.status(201).json({
      sucesso: true,
      mensagem: "Sessão criada com sucesso.",
      sessao: registroSessaoWeb_(row),
      sincronizadoGoogle: false
    });

  } catch (erro) {
    console.error("crm-jornada/sessoes POST:", erro);
    return res.status(500).json({
      erro: "Erro ao salvar sessão: " + (erro?.message || "erro interno")
    });
  }
});

// ======================================================
// INTERAÇÕES
// ======================================================

router.get("/interacoes", async (req, res) => {
  try {
    const r = await db.query(`
      SELECT i.*, c.nome_completo AS cliente_nome
      FROM interacoes i
      LEFT JOIN clientes c ON c.id_cliente = i.cliente_id
      ORDER BY i.data DESC NULLS LAST, i.hora DESC NULLS LAST
    `);

    res.json({ total: r.rows.length, interacoes: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar interações" });
  }
});

router.post("/interacoes/importar", async (req, res) => {
  try {
    const itens = req.body.interacoes;

    if (!Array.isArray(itens)) {
      return res.status(400).json({ erro: "Envie interacoes como array" });
    }

    let inseridos = 0, atualizados = 0, ignorados = 0;
    const erros = [];

    for (const item of itens) {
      try {
        const dados = {
          interacao_id: vazioNull(item.INTERACAO_ID ?? item.interacao_id),
          cliente_id: vazioNull(item.CLIENTE_ID ?? item.cliente_id),
          data: vazioNull(item.DATA ?? item.data),
          hora: vazioNull(item.HORA ?? item.hora),
          tipo: vazioNull(item.TIPO ?? item.tipo),
          canal: vazioNull(item.CANAL ?? item.canal),
          responsavel_id: vazioNull(item.RESPONSAVEL_ID ?? item.responsavel_id),
          assunto: vazioNull(item.ASSUNTO ?? item.assunto),
          descricao: vazioNull(item.DESCRICAO ?? item.descricao),
          resultado: vazioNull(item.RESULTADO ?? item.resultado),
          proxima_acao: vazioNull(item.PROXIMA_ACAO ?? item.proxima_acao),
          data_proxima_acao: vazioNull(item.DATA_PROXIMA_ACAO ?? item.data_proxima_acao)
        };

        if (!dados.cliente_id || !(await existeCliente(dados.cliente_id))) {
          ignorados++;
          erros.push({ interacao_id: dados.interacao_id, erro: "CLIENTE_ID inválido" });
          continue;
        }

        let existente = null;

        if (dados.interacao_id) {
          const b = await db.query(
            "SELECT id FROM interacoes WHERE interacao_id=$1 LIMIT 1",
            [dados.interacao_id]
          );
          existente = b.rows[0] || null;
        }

        if (existente) {
          await db.query(
            `UPDATE interacoes SET
              cliente_id=$1,data=$2,hora=$3,tipo=$4,canal=$5,responsavel_id=$6,
              assunto=$7,descricao=$8,resultado=$9,proxima_acao=$10,
              data_proxima_acao=$11,atualizado_em=NOW()
             WHERE id=$12`,
            [
              dados.cliente_id,dados.data,dados.hora,dados.tipo,dados.canal,
              dados.responsavel_id,dados.assunto,dados.descricao,dados.resultado,
              dados.proxima_acao,dados.data_proxima_acao,existente.id
            ]
          );
          atualizados++;
        } else {
          const r = await db.query(
            `INSERT INTO interacoes
             (interacao_id,cliente_id,data,hora,tipo,canal,responsavel_id,assunto,
              descricao,resultado,proxima_acao,data_proxima_acao)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             RETURNING id,interacao_id`,
            [
              dados.interacao_id,dados.cliente_id,dados.data,dados.hora,dados.tipo,
              dados.canal,dados.responsavel_id,dados.assunto,dados.descricao,
              dados.resultado,dados.proxima_acao,dados.data_proxima_acao
            ]
          );

          if (!r.rows[0].interacao_id) {
            await db.query(
              "UPDATE interacoes SET interacao_id=$1 WHERE id=$2",
              [novoId("INT", r.rows[0].id), r.rows[0].id]
            );
          }

          inseridos++;
        }

      } catch (e) {
        erros.push({
          interacao_id: item.INTERACAO_ID ?? item.interacao_id ?? null,
          erro: e.message
        });
      }
    }

    res.json({
      modulo: "INTERACOES",
      total_recebidos: itens.length,
      inseridos,
      atualizados,
      ignorados,
      erros
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao importar interações" });
  }
});

module.exports = router;
