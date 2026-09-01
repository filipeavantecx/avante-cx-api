const express = require("express");
const db = require("../database/db");
const verificarToken = require("../middleware/auth");

const router = express.Router();
router.use(verificarToken);

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
