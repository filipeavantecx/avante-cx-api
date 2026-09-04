const express = require("express");
const db = require("../database/db");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const router = express.Router();

function segredoCrmJwtComercial_() {
  const dedicado = String(process.env.CRM_JWT_SECRET || "").trim();
  if (dedicado) return dedicado;

  const base = String(process.env.JWT_SECRET || "").trim();
  if (!base) throw new Error("JWT_SECRET não configurado no Railway");

  return crypto
    .createHmac("sha256", base)
    .update("AVANTE_CRM_WEB_V1", "utf8")
    .digest("hex");
}

async function verificarTokenCrmComercial_(req, res, next) {
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
      segredoCrmJwtComercial_(),
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
      `SELECT usuario_id,nome,email,login,perfil,status,pode_produtos
       FROM usuarios_legado
       WHERE usuario_id=$1
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
    const permissaoExplicita = ["TRUE","1","SIM","S","YES","Y"]
      .includes(String(usuario.pode_produtos ?? "").trim().toUpperCase());

    const permitido =
      permissaoExplicita ||
      ["ADMINISTRADOR","GESTOR","MENTOR"].includes(perfil);

    if (!permitido) {
      return res.status(403).json({
        autenticado: false,
        erro: "Você não possui permissão para acessar Produtos / Serviços."
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

router.use(verificarTokenCrmComercial_);

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
// CATÁLOGO - HELPERS / SCHEMA
// ======================================================

function campo(body, ...nomes) {
  for (const nome of nomes) {
    if (body && body[nome] !== undefined) return body[nome];
  }
  return undefined;
}

function textoNull(v) {
  return (v === undefined || v === null || v === "")
    ? null
    : String(v);
}

function boolCatalogo(v, padrao = true) {
  if (v === undefined || v === null || v === "") return padrao;
  if (typeof v === "boolean") return v;
  return ["TRUE","1","SIM","S","YES","Y","ATIVO"]
    .includes(String(v).trim().toUpperCase());
}

async function garantirSchemaCatalogo_() {
  await db.query(`
    ALTER TABLE produtos
      ADD COLUMN IF NOT EXISTS categoria TEXT,
      ADD COLUMN IF NOT EXISTS subcategoria TEXT,
      ADD COLUMN IF NOT EXISTS codigo TEXT,
      ADD COLUMN IF NOT EXISTS sku TEXT,
      ADD COLUMN IF NOT EXISTS unidade TEXT,
      ADD COLUMN IF NOT EXISTS duracao TEXT,
      ADD COLUMN IF NOT EXISTS responsavel TEXT,
      ADD COLUMN IF NOT EXISTS publico_alvo TEXT,
      ADD COLUMN IF NOT EXISTS preco_venda NUMERIC,
      ADD COLUMN IF NOT EXISTS preco_promocional NUMERIC,
      ADD COLUMN IF NOT EXISTS margem_referencia NUMERIC,
      ADD COLUMN IF NOT EXISTS comissao_percentual NUMERIC,
      ADD COLUMN IF NOT EXISTS parcelamento_max INTEGER,
      ADD COLUMN IF NOT EXISTS recorrente TEXT,
      ADD COLUMN IF NOT EXISTS periodicidade TEXT,
      ADD COLUMN IF NOT EXISTS estoque_controla TEXT,
      ADD COLUMN IF NOT EXISTS estoque_atual NUMERIC,
      ADD COLUMN IF NOT EXISTS estoque_minimo NUMERIC,
      ADD COLUMN IF NOT EXISTS fornecedor TEXT,
      ADD COLUMN IF NOT EXISTS formas_pagamento TEXT,
      ADD COLUMN IF NOT EXISTS link TEXT,
      ADD COLUMN IF NOT EXISTS observacoes TEXT,
      ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE
  `);

  await db.query(`
    ALTER TABLE planos
      ADD COLUMN IF NOT EXISTS periodicidade TEXT,
      ADD COLUMN IF NOT EXISTS parcelamento_max INTEGER,
      ADD COLUMN IF NOT EXISTS observacoes TEXT,
      ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE
  `);

  await db.query(`
    ALTER TABLE mentores
      ADD COLUMN IF NOT EXISTS comissao_percentual NUMERIC,
      ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE
  `);
}

function montarProdutoCatalogo(body = {}, atual = {}) {
  const valor = numeroNull(campo(body,"VALOR","valor","PRECO_VENDA","preco_venda"));
  const precoVenda = numeroNull(campo(body,"PRECO_VENDA","preco_venda","VALOR","valor"));

  return {
    nome: textoNull(campo(body,"NOME","nome")) ?? atual.nome ?? null,
    tipo: textoNull(campo(body,"TIPO","tipo")) ?? atual.tipo ?? "SERVICO",
    descricao: textoNull(campo(body,"DESCRICAO","descricao")) ?? atual.descricao ?? null,
    valor: valor ?? precoVenda ?? atual.valor ?? null,
    status: textoNull(campo(body,"STATUS","status")) ?? atual.status ?? "ATIVO",
    frequencia: textoNull(campo(body,"FREQUENCIA","frequencia","PERIODICIDADE","periodicidade")) ?? atual.frequencia ?? null,
    custo: numeroNull(campo(body,"CUSTO","custo")) ?? atual.custo ?? null,
    margem: numeroNull(campo(body,"MARGEM","margem","MARGEM_REFERENCIA","margem_referencia")) ?? atual.margem ?? null,
    mentor_id: textoNull(campo(body,"MENTOR_ID","mentor_id")) ?? atual.mentor_id ?? null,
    categoria: textoNull(campo(body,"CATEGORIA","categoria")) ?? atual.categoria ?? null,
    subcategoria: textoNull(campo(body,"SUBCATEGORIA","subcategoria")) ?? atual.subcategoria ?? null,
    codigo: textoNull(campo(body,"CODIGO","codigo")) ?? atual.codigo ?? null,
    sku: textoNull(campo(body,"SKU","sku")) ?? atual.sku ?? null,
    unidade: textoNull(campo(body,"UNIDADE","unidade")) ?? atual.unidade ?? null,
    duracao: textoNull(campo(body,"DURACAO","duracao")) ?? atual.duracao ?? null,
    responsavel: textoNull(campo(body,"RESPONSAVEL","responsavel")) ?? atual.responsavel ?? null,
    publico_alvo: textoNull(campo(body,"PUBLICO_ALVO","publico_alvo")) ?? atual.publico_alvo ?? null,
    preco_venda: precoVenda ?? atual.preco_venda ?? valor ?? atual.valor ?? null,
    preco_promocional: numeroNull(campo(body,"PRECO_PROMOCIONAL","preco_promocional")) ?? atual.preco_promocional ?? null,
    margem_referencia: numeroNull(campo(body,"MARGEM_REFERENCIA","margem_referencia")) ?? atual.margem_referencia ?? null,
    comissao_percentual: numeroNull(campo(body,"COMISSAO_PERCENTUAL","comissao_percentual")) ?? atual.comissao_percentual ?? null,
    parcelamento_max: numeroNull(campo(body,"PARCELAMENTO_MAX","parcelamento_max")) ?? atual.parcelamento_max ?? null,
    recorrente: textoNull(campo(body,"RECORRENTE","recorrente")) ?? atual.recorrente ?? "NAO",
    periodicidade: textoNull(campo(body,"PERIODICIDADE","periodicidade")) ?? atual.periodicidade ?? null,
    estoque_controla: textoNull(campo(body,"ESTOQUE_CONTROLA","estoque_controla")) ?? atual.estoque_controla ?? "NAO",
    estoque_atual: numeroNull(campo(body,"ESTOQUE_ATUAL","estoque_atual")) ?? atual.estoque_atual ?? null,
    estoque_minimo: numeroNull(campo(body,"ESTOQUE_MINIMO","estoque_minimo")) ?? atual.estoque_minimo ?? null,
    fornecedor: textoNull(campo(body,"FORNECEDOR","fornecedor")) ?? atual.fornecedor ?? null,
    formas_pagamento: textoNull(campo(body,"FORMAS_PAGAMENTO","formas_pagamento")) ?? atual.formas_pagamento ?? null,
    link: textoNull(campo(body,"LINK","link")) ?? atual.link ?? null,
    observacoes: textoNull(campo(body,"OBSERVACOES","observacoes")) ?? atual.observacoes ?? null,
    ativo: boolCatalogo(campo(body,"ATIVO","ativo"), atual.ativo ?? true)
  };
}

function montarPlanoCatalogo(body = {}, atual = {}) {
  return {
    produto_id: textoNull(campo(body,"PRODUTO_ID","produto_id")) ?? atual.produto_id ?? null,
    nome: textoNull(campo(body,"NOME","nome")) ?? atual.nome ?? null,
    duracao: textoNull(campo(body,"DURACAO","duracao")) ?? atual.duracao ?? null,
    valor: numeroNull(campo(body,"VALOR","valor","PRECO","preco")) ?? atual.valor ?? null,
    descricao: textoNull(campo(body,"DESCRICAO","descricao")) ?? atual.descricao ?? null,
    status: textoNull(campo(body,"STATUS","status")) ?? atual.status ?? "ATIVO",
    grupo: textoNull(campo(body,"GRUPO","grupo")) ?? atual.grupo ?? null,
    materiais: textoNull(campo(body,"MATERIAIS","materiais")) ?? atual.materiais ?? null,
    bonus: textoNull(campo(body,"BONUS","bonus")) ?? atual.bonus ?? null,
    periodicidade: textoNull(campo(body,"PERIODICIDADE","periodicidade")) ?? atual.periodicidade ?? null,
    parcelamento_max: numeroNull(campo(body,"PARCELAMENTO_MAX","parcelamento_max")) ?? atual.parcelamento_max ?? null,
    observacoes: textoNull(campo(body,"OBSERVACOES","observacoes")) ?? atual.observacoes ?? null,
    ativo: boolCatalogo(campo(body,"ATIVO","ativo"), atual.ativo ?? true)
  };
}

function montarMentorCatalogo(body = {}, atual = {}) {
  const comissao = numeroNull(campo(body,"COMISSAO_PERCENTUAL","comissao_percentual","COMISSAO","comissao"));

  return {
    nome: textoNull(campo(body,"NOME","nome")) ?? atual.nome ?? null,
    email: textoNull(campo(body,"EMAIL","email")) ?? atual.email ?? null,
    telefone: textoNull(campo(body,"TELEFONE","telefone")) ?? atual.telefone ?? null,
    especialidade: textoNull(campo(body,"ESPECIALIDADE","especialidade")) ?? atual.especialidade ?? null,
    status: textoNull(campo(body,"STATUS","status")) ?? atual.status ?? "ATIVO",
    valor_hora: numeroNull(campo(body,"VALOR_HORA","valor_hora")) ?? atual.valor_hora ?? null,
    comissao: comissao ?? atual.comissao ?? null,
    comissao_percentual: comissao ?? atual.comissao_percentual ?? atual.comissao ?? null,
    meta: numeroNull(campo(body,"META","meta")) ?? atual.meta ?? null,
    observacoes: textoNull(campo(body,"OBSERVACOES","observacoes")) ?? atual.observacoes ?? null,
    ativo: boolCatalogo(campo(body,"ATIVO","ativo"), atual.ativo ?? true)
  };
}

async function buscarCatalogoPorId_(tabela, colunaId, id) {
  const r = await db.query(
    `SELECT * FROM ${tabela} WHERE id::text=$1 OR ${colunaId}=$1 LIMIT 1`,
    [String(id || "").trim()]
  );
  return r.rows[0] || null;
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


// ======================================================
// CATÁLOGO - CRUD RUNTIME
// ======================================================

router.get("/produtos/:id", async (req,res) => {
  try {
    await garantirSchemaCatalogo_();
    const produto = await buscarCatalogoPorId_("produtos","produto_id",req.params.id);
    if (!produto) return res.status(404).json({ erro:"Produto não encontrado" });
    res.json({ produto });
  } catch(e) {
    console.error(e);
    res.status(500).json({ erro:"Erro ao buscar produto", detalhe:e.message });
  }
});

router.post("/produtos", async (req,res) => {
  const client = await db.connect();
  try {
    await garantirSchemaCatalogo_();
    await client.query("BEGIN");
    const d = montarProdutoCatalogo(req.body);

    if (!d.nome) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro:"O nome do produto é obrigatório." });
    }

    if (d.mentor_id && !(await existeMentor(d.mentor_id))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro:"MENTOR_ID inválido" });
    }

    const seq = await client.query(
      `SELECT nextval(pg_get_serial_sequence('produtos','id'))::bigint AS id`
    );
    const id = Number(seq.rows[0].id);
    const produtoId = `PRO${String(id).padStart(6,"0")}`;

    const r = await client.query(
      `INSERT INTO produtos (
        id,produto_id,data_cadastro,nome,tipo,descricao,valor,status,frequencia,custo,margem,mentor_id,
        categoria,subcategoria,codigo,sku,unidade,duracao,responsavel,publico_alvo,preco_venda,
        preco_promocional,margem_referencia,comissao_percentual,parcelamento_max,recorrente,
        periodicidade,estoque_controla,estoque_atual,estoque_minimo,fornecedor,formas_pagamento,
        link,observacoes,ativo,criado_em,atualizado_em
      ) VALUES (
        $1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,NOW(),NOW()
      ) RETURNING *`,
      [
        id,produtoId,d.nome,d.tipo,d.descricao,d.valor,d.status,d.frequencia,d.custo,d.margem,d.mentor_id,
        d.categoria,d.subcategoria,d.codigo,d.sku,d.unidade,d.duracao,d.responsavel,d.publico_alvo,d.preco_venda,
        d.preco_promocional,d.margem_referencia,d.comissao_percentual,d.parcelamento_max,d.recorrente,
        d.periodicidade,d.estoque_controla,d.estoque_atual,d.estoque_minimo,d.fornecedor,d.formas_pagamento,
        d.link,d.observacoes,d.ativo
      ]
    );

    await client.query("COMMIT");
    res.status(201).json({ sucesso:true, produto:r.rows[0] });
  } catch(e) {
    await client.query("ROLLBACK").catch(()=>{});
    console.error("POST /produtos:", e);
    res.status(500).json({ erro:"Erro ao cadastrar produto", detalhe:e.message });
  } finally {
    client.release();
  }
});

router.put("/produtos/:id", async (req,res) => {
  try {
    await garantirSchemaCatalogo_();
    const atual = await buscarCatalogoPorId_("produtos","produto_id",req.params.id);
    if (!atual) return res.status(404).json({ erro:"Produto não encontrado" });

    const d = montarProdutoCatalogo(req.body, atual);

    if (d.mentor_id && !(await existeMentor(d.mentor_id))) {
      return res.status(400).json({ erro:"MENTOR_ID inválido" });
    }

    const r = await db.query(
      `UPDATE produtos SET
        nome=$1,tipo=$2,descricao=$3,valor=$4,status=$5,frequencia=$6,custo=$7,margem=$8,mentor_id=$9,
        categoria=$10,subcategoria=$11,codigo=$12,sku=$13,unidade=$14,duracao=$15,responsavel=$16,
        publico_alvo=$17,preco_venda=$18,preco_promocional=$19,margem_referencia=$20,
        comissao_percentual=$21,parcelamento_max=$22,recorrente=$23,periodicidade=$24,
        estoque_controla=$25,estoque_atual=$26,estoque_minimo=$27,fornecedor=$28,
        formas_pagamento=$29,link=$30,observacoes=$31,ativo=$32,atualizado_em=NOW()
       WHERE id=$33 RETURNING *`,
      [
        d.nome,d.tipo,d.descricao,d.valor,d.status,d.frequencia,d.custo,d.margem,d.mentor_id,
        d.categoria,d.subcategoria,d.codigo,d.sku,d.unidade,d.duracao,d.responsavel,
        d.publico_alvo,d.preco_venda,d.preco_promocional,d.margem_referencia,
        d.comissao_percentual,d.parcelamento_max,d.recorrente,d.periodicidade,
        d.estoque_controla,d.estoque_atual,d.estoque_minimo,d.fornecedor,
        d.formas_pagamento,d.link,d.observacoes,d.ativo,atual.id
      ]
    );

    res.json({ sucesso:true, produto:r.rows[0] });
  } catch(e) {
    console.error("PUT /produtos:", e);
    res.status(500).json({ erro:"Erro ao atualizar produto", detalhe:e.message });
  }
});

router.patch("/produtos/:id/inativar", async (req,res) => {
  try {
    await garantirSchemaCatalogo_();
    const r = await db.query(
      `UPDATE produtos SET status='INATIVO',ativo=FALSE,atualizado_em=NOW()
       WHERE id::text=$1 OR produto_id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ erro:"Produto não encontrado" });
    res.json({ sucesso:true, produto:r.rows[0] });
  } catch(e) {
    res.status(500).json({ erro:"Erro ao inativar produto", detalhe:e.message });
  }
});

router.patch("/produtos/:id/ativar", async (req,res) => {
  try {
    await garantirSchemaCatalogo_();
    const r = await db.query(
      `UPDATE produtos SET status='ATIVO',ativo=TRUE,atualizado_em=NOW()
       WHERE id::text=$1 OR produto_id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ erro:"Produto não encontrado" });
    res.json({ sucesso:true, produto:r.rows[0] });
  } catch(e) {
    res.status(500).json({ erro:"Erro ao ativar produto", detalhe:e.message });
  }
});


router.get("/planos/:id", async (req,res) => {
  try {
    await garantirSchemaCatalogo_();
    const plano = await buscarCatalogoPorId_("planos","plano_id",req.params.id);
    if (!plano) return res.status(404).json({ erro:"Plano não encontrado" });
    res.json({ plano });
  } catch(e) {
    res.status(500).json({ erro:"Erro ao buscar plano", detalhe:e.message });
  }
});

router.post("/planos", async (req,res) => {
  const client = await db.connect();
  try {
    await garantirSchemaCatalogo_();
    await client.query("BEGIN");
    const d = montarPlanoCatalogo(req.body);
    if (!d.nome) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro:"O nome do plano é obrigatório." });
    }
    if (d.produto_id && !(await existeProduto(d.produto_id))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro:"PRODUTO_ID inválido" });
    }

    const seq = await client.query(
      `SELECT nextval(pg_get_serial_sequence('planos','id'))::bigint AS id`
    );
    const id = Number(seq.rows[0].id);
    const planoId = `PLA${String(id).padStart(6,"0")}`;

    const r = await client.query(
      `INSERT INTO planos (
        id,plano_id,data_cadastro,produto_id,nome,duracao,valor,descricao,status,grupo,materiais,
        bonus,periodicidade,parcelamento_max,observacoes,ativo,criado_em,atualizado_em
      ) VALUES ($1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
      RETURNING *`,
      [
        id,planoId,d.produto_id,d.nome,d.duracao,d.valor,d.descricao,d.status,d.grupo,d.materiais,
        d.bonus,d.periodicidade,d.parcelamento_max,d.observacoes,d.ativo
      ]
    );

    await client.query("COMMIT");
    res.status(201).json({ sucesso:true, plano:r.rows[0] });
  } catch(e) {
    await client.query("ROLLBACK").catch(()=>{});
    res.status(500).json({ erro:"Erro ao cadastrar plano", detalhe:e.message });
  } finally {
    client.release();
  }
});

router.put("/planos/:id", async (req,res) => {
  try {
    await garantirSchemaCatalogo_();
    const atual = await buscarCatalogoPorId_("planos","plano_id",req.params.id);
    if (!atual) return res.status(404).json({ erro:"Plano não encontrado" });
    const d = montarPlanoCatalogo(req.body, atual);

    if (d.produto_id && !(await existeProduto(d.produto_id))) {
      return res.status(400).json({ erro:"PRODUTO_ID inválido" });
    }

    const r = await db.query(
      `UPDATE planos SET
        produto_id=$1,nome=$2,duracao=$3,valor=$4,descricao=$5,status=$6,grupo=$7,materiais=$8,
        bonus=$9,periodicidade=$10,parcelamento_max=$11,observacoes=$12,ativo=$13,atualizado_em=NOW()
       WHERE id=$14 RETURNING *`,
      [
        d.produto_id,d.nome,d.duracao,d.valor,d.descricao,d.status,d.grupo,d.materiais,
        d.bonus,d.periodicidade,d.parcelamento_max,d.observacoes,d.ativo,atual.id
      ]
    );

    res.json({ sucesso:true, plano:r.rows[0] });
  } catch(e) {
    res.status(500).json({ erro:"Erro ao atualizar plano", detalhe:e.message });
  }
});

router.patch("/planos/:id/inativar", async (req,res) => {
  try {
    await garantirSchemaCatalogo_();
    const r = await db.query(
      `UPDATE planos SET status='INATIVO',ativo=FALSE,atualizado_em=NOW()
       WHERE id::text=$1 OR plano_id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ erro:"Plano não encontrado" });
    res.json({ sucesso:true, plano:r.rows[0] });
  } catch(e) {
    res.status(500).json({ erro:"Erro ao inativar plano", detalhe:e.message });
  }
});

router.patch("/planos/:id/ativar", async (req,res) => {
  try {
    await garantirSchemaCatalogo_();
    const r = await db.query(
      `UPDATE planos SET status='ATIVO',ativo=TRUE,atualizado_em=NOW()
       WHERE id::text=$1 OR plano_id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ erro:"Plano não encontrado" });
    res.json({ sucesso:true, plano:r.rows[0] });
  } catch(e) {
    res.status(500).json({ erro:"Erro ao ativar plano", detalhe:e.message });
  }
});


router.get("/mentores/:id", async (req,res) => {
  try {
    await garantirSchemaCatalogo_();
    const mentor = await buscarCatalogoPorId_("mentores","mentor_id",req.params.id);
    if (!mentor) return res.status(404).json({ erro:"Mentor não encontrado" });
    res.json({ mentor });
  } catch(e) {
    res.status(500).json({ erro:"Erro ao buscar mentor", detalhe:e.message });
  }
});

router.post("/mentores", async (req,res) => {
  const client = await db.connect();
  try {
    await garantirSchemaCatalogo_();
    await client.query("BEGIN");
    const d = montarMentorCatalogo(req.body);
    if (!d.nome) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro:"O nome do mentor é obrigatório." });
    }

    const seq = await client.query(
      `SELECT nextval(pg_get_serial_sequence('mentores','id'))::bigint AS id`
    );
    const id = Number(seq.rows[0].id);
    const mentorId = `MEN${String(id).padStart(6,"0")}`;

    const r = await client.query(
      `INSERT INTO mentores (
        id,mentor_id,data_cadastro,nome,email,telefone,especialidade,status,valor_hora,
        comissao,comissao_percentual,meta,observacoes,ativo,criado_em,atualizado_em
      ) VALUES ($1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
      RETURNING *`,
      [
        id,mentorId,d.nome,d.email,d.telefone,d.especialidade,d.status,d.valor_hora,
        d.comissao,d.comissao_percentual,d.meta,d.observacoes,d.ativo
      ]
    );

    await client.query("COMMIT");
    res.status(201).json({ sucesso:true, mentor:r.rows[0] });
  } catch(e) {
    await client.query("ROLLBACK").catch(()=>{});
    res.status(500).json({ erro:"Erro ao cadastrar mentor", detalhe:e.message });
  } finally {
    client.release();
  }
});

router.put("/mentores/:id", async (req,res) => {
  try {
    await garantirSchemaCatalogo_();
    const atual = await buscarCatalogoPorId_("mentores","mentor_id",req.params.id);
    if (!atual) return res.status(404).json({ erro:"Mentor não encontrado" });
    const d = montarMentorCatalogo(req.body, atual);

    const r = await db.query(
      `UPDATE mentores SET
        nome=$1,email=$2,telefone=$3,especialidade=$4,status=$5,valor_hora=$6,
        comissao=$7,comissao_percentual=$8,meta=$9,observacoes=$10,ativo=$11,atualizado_em=NOW()
       WHERE id=$12 RETURNING *`,
      [
        d.nome,d.email,d.telefone,d.especialidade,d.status,d.valor_hora,
        d.comissao,d.comissao_percentual,d.meta,d.observacoes,d.ativo,atual.id
      ]
    );

    res.json({ sucesso:true, mentor:r.rows[0] });
  } catch(e) {
    res.status(500).json({ erro:"Erro ao atualizar mentor", detalhe:e.message });
  }
});

router.patch("/mentores/:id/inativar", async (req,res) => {
  try {
    await garantirSchemaCatalogo_();
    const r = await db.query(
      `UPDATE mentores SET status='INATIVO',ativo=FALSE,atualizado_em=NOW()
       WHERE id::text=$1 OR mentor_id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ erro:"Mentor não encontrado" });
    res.json({ sucesso:true, mentor:r.rows[0] });
  } catch(e) {
    res.status(500).json({ erro:"Erro ao inativar mentor", detalhe:e.message });
  }
});

router.patch("/mentores/:id/ativar", async (req,res) => {
  try {
    await garantirSchemaCatalogo_();
    const r = await db.query(
      `UPDATE mentores SET status='ATIVO',ativo=TRUE,atualizado_em=NOW()
       WHERE id::text=$1 OR mentor_id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ erro:"Mentor não encontrado" });
    res.json({ sucesso:true, mentor:r.rows[0] });
  } catch(e) {
    res.status(500).json({ erro:"Erro ao ativar mentor", detalhe:e.message });
  }
});


module.exports = router;
