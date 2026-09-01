const express = require("express");
const db = require("../database/db");
const verificarToken = require("../middleware/auth");

const router = express.Router();
router.use(verificarToken);

const vazioNull = (v) =>
  v === undefined || v === null || v === "" ? null : v;

const numeroNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function novoId(prefixo, id) {
  return `${prefixo}${String(id).padStart(6, "0")}`;
}

async function existeCliente(idCliente) {
  if (!idCliente) return true;
  const r = await db.query(
    "SELECT id FROM clientes WHERE id_cliente=$1 LIMIT 1",
    [idCliente]
  );
  return r.rows.length > 0;
}

async function existeLead(leadId) {
  if (!leadId) return true;
  const r = await db.query(
    "SELECT id FROM leads WHERE lead_id=$1 LIMIT 1",
    [leadId]
  );
  return r.rows.length > 0;
}

async function existeMentor(mentorId) {
  if (!mentorId) return true;
  const r = await db.query(
    "SELECT id FROM mentores WHERE mentor_id=$1 LIMIT 1",
    [mentorId]
  );
  return r.rows.length > 0;
}

async function existeProduto(produtoId) {
  if (!produtoId) return true;
  const r = await db.query(
    "SELECT id FROM produtos WHERE produto_id=$1 LIMIT 1",
    [produtoId]
  );
  return r.rows.length > 0;
}

// ======================================================
// LEADS
// ======================================================

router.get("/leads", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM leads ORDER BY data_entrada DESC NULLS LAST, id DESC"
    );
    res.json({ total: r.rows.length, leads: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar leads" });
  }
});

router.post("/leads/importar", async (req, res) => {
  try {
    const itens = req.body.leads;

    if (!Array.isArray(itens)) {
      return res.status(400).json({ erro: "Envie leads como array" });
    }

    let inseridos = 0, atualizados = 0, ignorados = 0;
    const erros = [];

    for (const item of itens) {
      try {
        const d = {
          lead_id: vazioNull(item.LEAD_ID ?? item.lead_id),
          data_entrada: vazioNull(item.DATA_ENTRADA ?? item.data_entrada),
          nome: vazioNull(item.NOME ?? item.nome),
          whatsapp: vazioNull(item.WHATSAPP ?? item.whatsapp),
          email: vazioNull(item.EMAIL ?? item.email),
          origem: vazioNull(item.ORIGEM ?? item.origem),
          interesse: vazioNull(item.INTERESSE ?? item.interesse),
          etapa: vazioNull(item.ETAPA ?? item.etapa),
          status: vazioNull(item.STATUS ?? item.status),
          observacoes: vazioNull(item.OBSERVACOES ?? item.observacoes),
          produto_interesse: vazioNull(item.PRODUTO_INTERESSE ?? item.produto_interesse),
          responsavel_id: vazioNull(item.RESPONSAVEL_ID ?? item.responsavel_id),
          score: numeroNull(item.SCORE ?? item.score),
          valor_potencial: numeroNull(item.VALOR_POTENCIAL ?? item.valor_potencial),
          ultimo_contato: vazioNull(item.ULTIMO_CONTATO ?? item.ultimo_contato),
          proximo_contato: vazioNull(item.PROXIMO_CONTATO ?? item.proximo_contato),
          motivo_perda: vazioNull(item.MOTIVO_PERDA ?? item.motivo_perda)
        };

        let existente = null;

        if (d.lead_id) {
          const b = await db.query(
            "SELECT id FROM leads WHERE lead_id=$1 LIMIT 1",
            [d.lead_id]
          );
          existente = b.rows[0] || null;
        }

        if (existente) {
          await db.query(
            `UPDATE leads SET
              data_entrada=$1,nome=$2,whatsapp=$3,email=$4,origem=$5,interesse=$6,
              etapa=$7,status=$8,observacoes=$9,produto_interesse=$10,responsavel_id=$11,
              score=$12,valor_potencial=$13,ultimo_contato=$14,proximo_contato=$15,
              motivo_perda=$16,atualizado_em=NOW()
             WHERE id=$17`,
            [
              d.data_entrada,d.nome,d.whatsapp,d.email,d.origem,d.interesse,d.etapa,d.status,
              d.observacoes,d.produto_interesse,d.responsavel_id,d.score,d.valor_potencial,
              d.ultimo_contato,d.proximo_contato,d.motivo_perda,existente.id
            ]
          );
          atualizados++;
        } else {
          const r = await db.query(
            `INSERT INTO leads
             (lead_id,data_entrada,nome,whatsapp,email,origem,interesse,etapa,status,
              observacoes,produto_interesse,responsavel_id,score,valor_potencial,
              ultimo_contato,proximo_contato,motivo_perda)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING id,lead_id`,
            [
              d.lead_id,d.data_entrada,d.nome,d.whatsapp,d.email,d.origem,d.interesse,d.etapa,
              d.status,d.observacoes,d.produto_interesse,d.responsavel_id,d.score,
              d.valor_potencial,d.ultimo_contato,d.proximo_contato,d.motivo_perda
            ]
          );

          if (!r.rows[0].lead_id) {
            await db.query(
              "UPDATE leads SET lead_id=$1 WHERE id=$2",
              [novoId("LEAD", r.rows[0].id), r.rows[0].id]
            );
          }

          inseridos++;
        }
      } catch (e) {
        erros.push({
          lead_id: item.LEAD_ID ?? item.lead_id ?? null,
          erro: e.message
        });
      }
    }

    res.json({ modulo:"LEADS", total_recebidos:itens.length, inseridos, atualizados, ignorados, erros });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao importar leads" });
  }
});

// ======================================================
// OPORTUNIDADES
// ======================================================

router.get("/oportunidades", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM oportunidades ORDER BY data_criacao DESC NULLS LAST, id DESC"
    );
    res.json({ total:r.rows.length, oportunidades:r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro:"Erro ao listar oportunidades" });
  }
});

router.post("/oportunidades/importar", async (req, res) => {
  try {
    const itens = req.body.oportunidades;

    if (!Array.isArray(itens)) {
      return res.status(400).json({ erro:"Envie oportunidades como array" });
    }

    let inseridos=0, atualizados=0, ignorados=0;
    const erros=[];

    for (const item of itens) {
      try {
        const d = {
          oportunidade_id: vazioNull(item.OPORTUNIDADE_ID ?? item.oportunidade_id),
          data_criacao: vazioNull(item.DATA_CRIACAO ?? item.data_criacao),
          lead_id: vazioNull(item.LEAD_ID ?? item.lead_id),
          id_cliente: vazioNull(item.ID_CLIENTE ?? item.id_cliente),
          titulo: vazioNull(item.TITULO ?? item.titulo),
          valor: numeroNull(item.VALOR ?? item.valor),
          etapa: vazioNull(item.ETAPA ?? item.etapa),
          status: vazioNull(item.STATUS ?? item.status),
          probabilidade: numeroNull(item.PROBABILIDADE ?? item.probabilidade),
          data_fechamento: vazioNull(item.DATA_FECHAMENTO ?? item.data_fechamento),
          motivo_perda: vazioNull(item.MOTIVO_PERDA ?? item.motivo_perda),
          observacoes: vazioNull(item.OBSERVACOES ?? item.observacoes)
        };

        if (!(await existeLead(d.lead_id))) {
          ignorados++;
          erros.push({ oportunidade_id:d.oportunidade_id, erro:"LEAD_ID inválido" });
          continue;
        }

        if (!(await existeCliente(d.id_cliente))) {
          ignorados++;
          erros.push({ oportunidade_id:d.oportunidade_id, erro:"ID_CLIENTE inválido" });
          continue;
        }

        let existente=null;

        if (d.oportunidade_id) {
          const b=await db.query(
            "SELECT id FROM oportunidades WHERE oportunidade_id=$1 LIMIT 1",
            [d.oportunidade_id]
          );
          existente=b.rows[0] || null;
        }

        if (existente) {
          await db.query(
            `UPDATE oportunidades SET
              data_criacao=$1,lead_id=$2,id_cliente=$3,titulo=$4,valor=$5,etapa=$6,
              status=$7,probabilidade=$8,data_fechamento=$9,motivo_perda=$10,
              observacoes=$11,atualizado_em=NOW()
             WHERE id=$12`,
            [
              d.data_criacao,d.lead_id,d.id_cliente,d.titulo,d.valor,d.etapa,d.status,
              d.probabilidade,d.data_fechamento,d.motivo_perda,d.observacoes,existente.id
            ]
          );
          atualizados++;
        } else {
          const r=await db.query(
            `INSERT INTO oportunidades
             (oportunidade_id,data_criacao,lead_id,id_cliente,titulo,valor,etapa,status,
              probabilidade,data_fechamento,motivo_perda,observacoes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             RETURNING id,oportunidade_id`,
            [
              d.oportunidade_id,d.data_criacao,d.lead_id,d.id_cliente,d.titulo,d.valor,
              d.etapa,d.status,d.probabilidade,d.data_fechamento,d.motivo_perda,d.observacoes
            ]
          );

          if (!r.rows[0].oportunidade_id) {
            await db.query(
              "UPDATE oportunidades SET oportunidade_id=$1 WHERE id=$2",
              [novoId("OPO", r.rows[0].id), r.rows[0].id]
            );
          }

          inseridos++;
        }
      } catch (e) {
        erros.push({
          oportunidade_id:item.OPORTUNIDADE_ID ?? item.oportunidade_id ?? null,
          erro:e.message
        });
      }
    }

    res.json({ modulo:"OPORTUNIDADES", total_recebidos:itens.length, inseridos, atualizados, ignorados, erros });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro:"Erro ao importar oportunidades" });
  }
});

// ======================================================
// MENTORES
// ======================================================

router.get("/mentores", async (req,res) => {
  try {
    const r=await db.query("SELECT * FROM mentores ORDER BY nome ASC");
    res.json({ total:r.rows.length, mentores:r.rows });
  } catch(e) {
    console.error(e);
    res.status(500).json({ erro:"Erro ao listar mentores" });
  }
});

router.post("/mentores/importar", async (req,res) => {
  try {
    const itens=req.body.mentores;

    if (!Array.isArray(itens)) {
      return res.status(400).json({ erro:"Envie mentores como array" });
    }

    let inseridos=0, atualizados=0, ignorados=0;
    const erros=[];

    for (const item of itens) {
      try {
        const d={
          mentor_id:vazioNull(item.MENTOR_ID ?? item.mentor_id),
          data_cadastro:vazioNull(item.DATA_CADASTRO ?? item.data_cadastro),
          nome:vazioNull(item.NOME ?? item.nome),
          email:vazioNull(item.EMAIL ?? item.email),
          telefone:vazioNull(item.TELEFONE ?? item.telefone),
          especialidade:vazioNull(item.ESPECIALIDADE ?? item.especialidade),
          status:vazioNull(item.STATUS ?? item.status),
          valor_hora:numeroNull(item.VALOR_HORA ?? item.valor_hora),
          comissao:numeroNull(item.COMISSAO ?? item.comissao),
          meta:numeroNull(item.META ?? item.meta),
          observacoes:vazioNull(item.OBSERVACOES ?? item.observacoes)
        };

        let existente=null;

        if (d.mentor_id) {
          const b=await db.query("SELECT id FROM mentores WHERE mentor_id=$1 LIMIT 1",[d.mentor_id]);
          existente=b.rows[0] || null;
        }

        if (existente) {
          await db.query(
            `UPDATE mentores SET
              data_cadastro=$1,nome=$2,email=$3,telefone=$4,especialidade=$5,status=$6,
              valor_hora=$7,comissao=$8,meta=$9,observacoes=$10,atualizado_em=NOW()
             WHERE id=$11`,
            [
              d.data_cadastro,d.nome,d.email,d.telefone,d.especialidade,d.status,d.valor_hora,
              d.comissao,d.meta,d.observacoes,existente.id
            ]
          );
          atualizados++;
        } else {
          const r=await db.query(
            `INSERT INTO mentores
             (mentor_id,data_cadastro,nome,email,telefone,especialidade,status,valor_hora,
              comissao,meta,observacoes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING id,mentor_id`,
            [
              d.mentor_id,d.data_cadastro,d.nome,d.email,d.telefone,d.especialidade,
              d.status,d.valor_hora,d.comissao,d.meta,d.observacoes
            ]
          );

          if (!r.rows[0].mentor_id) {
            await db.query(
              "UPDATE mentores SET mentor_id=$1 WHERE id=$2",
              [novoId("MEN",r.rows[0].id),r.rows[0].id]
            );
          }

          inseridos++;
        }
      } catch(e) {
        erros.push({ mentor_id:item.MENTOR_ID ?? item.mentor_id ?? null, erro:e.message });
      }
    }

    res.json({ modulo:"MENTORES", total_recebidos:itens.length, inseridos, atualizados, ignorados, erros });
  } catch(e) {
    console.error(e);
    res.status(500).json({ erro:"Erro ao importar mentores" });
  }
});

// ======================================================
// PRODUTOS
// ======================================================

router.get("/produtos", async (req,res) => {
  try {
    const r=await db.query("SELECT * FROM produtos ORDER BY nome ASC");
    res.json({ total:r.rows.length, produtos:r.rows });
  } catch(e) {
    console.error(e);
    res.status(500).json({ erro:"Erro ao listar produtos" });
  }
});

router.post("/produtos/importar", async (req,res) => {
  try {
    const itens=req.body.produtos;

    if (!Array.isArray(itens)) {
      return res.status(400).json({ erro:"Envie produtos como array" });
    }

    let inseridos=0, atualizados=0, ignorados=0;
    const erros=[];

    for (const item of itens) {
      try {
        const d={
          produto_id:vazioNull(item.PRODUTO_ID ?? item.produto_id),
          data_cadastro:vazioNull(item.DATA_CADASTRO ?? item.data_cadastro),
          nome:vazioNull(item.NOME ?? item.nome),
          tipo:vazioNull(item.TIPO ?? item.tipo),
          descricao:vazioNull(item.DESCRICAO ?? item.descricao),
          valor:numeroNull(item.VALOR ?? item.valor),
          status:vazioNull(item.STATUS ?? item.status),
          frequencia:vazioNull(item.FREQUENCIA ?? item.frequencia),
          custo:numeroNull(item.CUSTO ?? item.custo),
          margem:numeroNull(item.MARGEM ?? item.margem),
          mentor_id:vazioNull(item.MENTOR_ID ?? item.mentor_id)
        };

        if (!(await existeMentor(d.mentor_id))) {
          ignorados++;
          erros.push({ produto_id:d.produto_id, erro:"MENTOR_ID inválido" });
          continue;
        }

        let existente=null;

        if (d.produto_id) {
          const b=await db.query("SELECT id FROM produtos WHERE produto_id=$1 LIMIT 1",[d.produto_id]);
          existente=b.rows[0] || null;
        }

        if (existente) {
          await db.query(
            `UPDATE produtos SET
              data_cadastro=$1,nome=$2,tipo=$3,descricao=$4,valor=$5,status=$6,
              frequencia=$7,custo=$8,margem=$9,mentor_id=$10,atualizado_em=NOW()
             WHERE id=$11`,
            [
              d.data_cadastro,d.nome,d.tipo,d.descricao,d.valor,d.status,d.frequencia,
              d.custo,d.margem,d.mentor_id,existente.id
            ]
          );
          atualizados++;
        } else {
          const r=await db.query(
            `INSERT INTO produtos
             (produto_id,data_cadastro,nome,tipo,descricao,valor,status,frequencia,custo,margem,mentor_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING id,produto_id`,
            [
              d.produto_id,d.data_cadastro,d.nome,d.tipo,d.descricao,d.valor,d.status,
              d.frequencia,d.custo,d.margem,d.mentor_id
            ]
          );

          if (!r.rows[0].produto_id) {
            await db.query(
              "UPDATE produtos SET produto_id=$1 WHERE id=$2",
              [novoId("PRO",r.rows[0].id),r.rows[0].id]
            );
          }

          inseridos++;
        }
      } catch(e) {
        erros.push({ produto_id:item.PRODUTO_ID ?? item.produto_id ?? null, erro:e.message });
      }
    }

    res.json({ modulo:"PRODUTOS", total_recebidos:itens.length, inseridos, atualizados, ignorados, erros });
  } catch(e) {
    console.error(e);
    res.status(500).json({ erro:"Erro ao importar produtos" });
  }
});

// ======================================================
// PLANOS
// ======================================================

router.get("/planos", async (req,res) => {
  try {
    const r=await db.query("SELECT * FROM planos ORDER BY nome ASC");
    res.json({ total:r.rows.length, planos:r.rows });
  } catch(e) {
    console.error(e);
    res.status(500).json({ erro:"Erro ao listar planos" });
  }
});

router.post("/planos/importar", async (req,res) => {
  try {
    const itens=req.body.planos;

    if (!Array.isArray(itens)) {
      return res.status(400).json({ erro:"Envie planos como array" });
    }

    let inseridos=0, atualizados=0, ignorados=0;
    const erros=[];

    for (const item of itens) {
      try {
        const d={
          plano_id:vazioNull(item.PLANO_ID ?? item.plano_id),
          data_cadastro:vazioNull(item.DATA_CADASTRO ?? item.data_cadastro),
          produto_id:vazioNull(item.PRODUTO_ID ?? item.produto_id),
          nome:vazioNull(item.NOME ?? item.nome),
          duracao:vazioNull(item.DURACAO ?? item.duracao),
          valor:numeroNull(item.VALOR ?? item.valor),
          descricao:vazioNull(item.DESCRICAO ?? item.descricao),
          status:vazioNull(item.STATUS ?? item.status),
          grupo:vazioNull(item.GRUPO ?? item.grupo),
          materiais:vazioNull(item.MATERIAIS ?? item.materiais),
          bonus:vazioNull(item.BONUS ?? item.bonus)
        };

        if (!(await existeProduto(d.produto_id))) {
          ignorados++;
          erros.push({ plano_id:d.plano_id, erro:"PRODUTO_ID inválido" });
          continue;
        }

        let existente=null;

        if (d.plano_id) {
          const b=await db.query("SELECT id FROM planos WHERE plano_id=$1 LIMIT 1",[d.plano_id]);
          existente=b.rows[0] || null;
        }

        if (existente) {
          await db.query(
            `UPDATE planos SET
              data_cadastro=$1,produto_id=$2,nome=$3,duracao=$4,valor=$5,descricao=$6,
              status=$7,grupo=$8,materiais=$9,bonus=$10,atualizado_em=NOW()
             WHERE id=$11`,
            [
              d.data_cadastro,d.produto_id,d.nome,d.duracao,d.valor,d.descricao,
              d.status,d.grupo,d.materiais,d.bonus,existente.id
            ]
          );
          atualizados++;
        } else {
          const r=await db.query(
            `INSERT INTO planos
             (plano_id,data_cadastro,produto_id,nome,duracao,valor,descricao,status,grupo,materiais,bonus)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING id,plano_id`,
            [
              d.plano_id,d.data_cadastro,d.produto_id,d.nome,d.duracao,d.valor,
              d.descricao,d.status,d.grupo,d.materiais,d.bonus
            ]
          );

          if (!r.rows[0].plano_id) {
            await db.query(
              "UPDATE planos SET plano_id=$1 WHERE id=$2",
              [novoId("PLA",r.rows[0].id),r.rows[0].id]
            );
          }

          inseridos++;
        }
      } catch(e) {
        erros.push({ plano_id:item.PLANO_ID ?? item.plano_id ?? null, erro:e.message });
      }
    }

    res.json({ modulo:"PLANOS", total_recebidos:itens.length, inseridos, atualizados, ignorados, erros });
  } catch(e) {
    console.error(e);
    res.status(500).json({ erro:"Erro ao importar planos" });
  }
});

module.exports = router;
