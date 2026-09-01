const express = require("express");
const db = require("../database/db");
const verificarToken = require("../middleware/auth");

const router = express.Router();
router.use(verificarToken);

const vazioNull = v =>
  v === undefined || v === null || v === "" ? null : v;

const numeroNull = v => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const inteiroNull = v => {
  const n = numeroNull(v);
  return n === null ? null : Math.trunc(n);
};

function novoId(prefixo, id) {
  return `${prefixo}${String(id).padStart(6, "0")}`;
}

function pegar(obj, campo) {
  return vazioNull(obj[campo] ?? obj[campo.toLowerCase()]);
}

function num(obj, campo) {
  return numeroNull(obj[campo] ?? obj[campo.toLowerCase()]);
}

function int(obj, campo) {
  return inteiroNull(obj[campo] ?? obj[campo.toLowerCase()]);
}

async function importarModulo({
  itens,
  tabela,
  idCampo,
  prefixo,
  colunas,
  mapear
}) {
  let inseridos = 0;
  let atualizados = 0;
  let ignorados = 0;
  const erros = [];

  for (const item of itens) {
    try {
      const dados = mapear(item);
      const idLegado = dados[idCampo];

      if (!idLegado) {
        ignorados++;
        erros.push({
          id: null,
          erro: `${idCampo.toUpperCase()} não informado`
        });
        continue;
      }

      const busca = await db.query(
        `SELECT id FROM ${tabela} WHERE ${idCampo} = $1 LIMIT 1`,
        [idLegado]
      );

      const existente = busca.rows[0] || null;

      if (existente) {
        const colunasUpdate = colunas.filter(c => c !== idCampo);
        const sets = colunasUpdate.map(
          (c, i) => `${c}=$${i + 1}`
        );

        const valores = colunasUpdate.map(c => dados[c]);
        valores.push(existente.id);

        await db.query(
          `UPDATE ${tabela}
           SET ${sets.join(", ")}, atualizado_em=NOW()
           WHERE id=$${valores.length}`,
          valores
        );

        atualizados++;
      } else {
        const valores = colunas.map(c => dados[c]);
        const placeholders = colunas.map((_, i) => `$${i + 1}`);

        const r = await db.query(
          `INSERT INTO ${tabela} (${colunas.join(",")})
           VALUES (${placeholders.join(",")})
           RETURNING id, ${idCampo}`,
          valores
        );

        if (!r.rows[0][idCampo]) {
          await db.query(
            `UPDATE ${tabela} SET ${idCampo}=$1 WHERE id=$2`,
            [novoId(prefixo, r.rows[0].id), r.rows[0].id]
          );
        }

        inseridos++;
      }

    } catch (e) {
      erros.push({
        id:
          item[idCampo.toUpperCase()] ??
          item[idCampo] ??
          null,
        erro: e.message
      });
    }
  }

  return {
    total_recebidos: itens.length,
    inseridos,
    atualizados,
    ignorados,
    erros
  };
}


// ======================================================
// GETs
// ======================================================

router.get("/satisfacao", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM satisfacao ORDER BY data DESC NULLS LAST, id DESC"
    );
    res.json({ total: r.rows.length, satisfacao: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar satisfação" });
  }
});

router.get("/renovacoes", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM renovacoes ORDER BY data_vencimento DESC NULLS LAST, id DESC"
    );
    res.json({ total: r.rows.length, renovacoes: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar renovações" });
  }
});

router.get("/campanhas", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM campanhas ORDER BY data_inicio DESC NULLS LAST, id DESC"
    );
    res.json({ total: r.rows.length, campanhas: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar campanhas" });
  }
});

router.get("/indicadores", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM indicadores ORDER BY data DESC NULLS LAST, id DESC"
    );
    res.json({ total: r.rows.length, indicadores: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar indicadores" });
  }
});

router.get("/metas", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM metas ORDER BY data_limite DESC NULLS LAST, id DESC"
    );
    res.json({ total: r.rows.length, metas: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar metas" });
  }
});

router.get("/clientes-tags", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM clientes_tags ORDER BY data_cadastro DESC NULLS LAST, id DESC"
    );
    res.json({ total: r.rows.length, clientes_tags: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar tags" });
  }
});


// ======================================================
// IMPORTAÇÕES
// ======================================================

router.post("/satisfacao/importar", async (req, res) => {
  const itens = req.body.satisfacao;
  if (!Array.isArray(itens)) {
    return res.status(400).json({ erro: "Envie satisfacao como array" });
  }

  const resultado = await importarModulo({
    itens,
    tabela: "satisfacao",
    idCampo: "satisfacao_id",
    prefixo: "SAT",
    colunas: [
      "satisfacao_id","cliente_id","sessao_id","data","tipo","nota","nps",
      "feedback","ponto_positivo","ponto_melhoria","status"
    ],
    mapear: x => ({
      satisfacao_id: pegar(x,"SATISFACAO_ID"),
      cliente_id: pegar(x,"CLIENTE_ID"),
      sessao_id: pegar(x,"SESSAO_ID"),
      data: pegar(x,"DATA"),
      tipo: pegar(x,"TIPO"),
      nota: num(x,"NOTA"),
      nps: num(x,"NPS"),
      feedback: pegar(x,"FEEDBACK"),
      ponto_positivo: pegar(x,"PONTO_POSITIVO"),
      ponto_melhoria: pegar(x,"PONTO_MELHORIA"),
      status: pegar(x,"STATUS")
    })
  });

  res.json({ modulo: "SATISFACAO", ...resultado });
});

router.post("/renovacoes/importar", async (req, res) => {
  const itens = req.body.renovacoes;
  if (!Array.isArray(itens)) {
    return res.status(400).json({ erro: "Envie renovacoes como array" });
  }

  const resultado = await importarModulo({
    itens,
    tabela: "renovacoes",
    idCampo: "renovacao_id",
    prefixo: "REN",
    colunas: [
      "renovacao_id","cliente_id","contrato_id","produto_atual","produto_novo",
      "data_vencimento","data_contato","data_renovacao","valor_atual","novo_valor",
      "status","responsavel_id","motivo_nao_renovacao","observacoes"
    ],
    mapear: x => ({
      renovacao_id: pegar(x,"RENOVACAO_ID"),
      cliente_id: pegar(x,"CLIENTE_ID"),
      contrato_id: pegar(x,"CONTRATO_ID"),
      produto_atual: pegar(x,"PRODUTO_ATUAL"),
      produto_novo: pegar(x,"PRODUTO_NOVO"),
      data_vencimento: pegar(x,"DATA_VENCIMENTO"),
      data_contato: pegar(x,"DATA_CONTATO"),
      data_renovacao: pegar(x,"DATA_RENOVACAO"),
      valor_atual: num(x,"VALOR_ATUAL"),
      novo_valor: num(x,"NOVO_VALOR"),
      status: pegar(x,"STATUS"),
      responsavel_id: pegar(x,"RESPONSAVEL_ID"),
      motivo_nao_renovacao: pegar(x,"MOTIVO_NAO_RENOVACAO"),
      observacoes: pegar(x,"OBSERVACOES")
    })
  });

  res.json({ modulo: "RENOVACOES", ...resultado });
});

router.post("/campanhas/importar", async (req, res) => {
  const itens = req.body.campanhas;
  if (!Array.isArray(itens)) {
    return res.status(400).json({ erro: "Envie campanhas como array" });
  }

  const resultado = await importarModulo({
    itens,
    tabela: "campanhas",
    idCampo: "campanha_id",
    prefixo: "CAM",
    colunas: [
      "campanha_id","nome","canal","data_inicio","data_fim","orcamento",
      "investimento","leads","clientes","vendas","receita","cac","roi","status"
    ],
    mapear: x => ({
      campanha_id: pegar(x,"CAMPANHA_ID"),
      nome: pegar(x,"NOME"),
      canal: pegar(x,"CANAL"),
      data_inicio: pegar(x,"DATA_INICIO"),
      data_fim: pegar(x,"DATA_FIM"),
      orcamento: num(x,"ORCAMENTO"),
      investimento: num(x,"INVESTIMENTO"),
      leads: int(x,"LEADS"),
      clientes: int(x,"CLIENTES"),
      vendas: int(x,"VENDAS"),
      receita: num(x,"RECEITA"),
      cac: num(x,"CAC"),
      roi: num(x,"ROI"),
      status: pegar(x,"STATUS")
    })
  });

  res.json({ modulo: "CAMPANHAS", ...resultado });
});

router.post("/indicadores/importar", async (req, res) => {
  const itens = req.body.indicadores;
  if (!Array.isArray(itens)) {
    return res.status(400).json({ erro: "Envie indicadores como array" });
  }

  const resultado = await importarModulo({
    itens,
    tabela: "indicadores",
    idCampo: "indicador_id",
    prefixo: "IND",
    colunas: [
      "indicador_id","data","categoria","indicador","valor","meta",
      "percentual","periodo","observacao"
    ],
    mapear: x => ({
      indicador_id: pegar(x,"INDICADOR_ID"),
      data: pegar(x,"DATA"),
      categoria: pegar(x,"CATEGORIA"),
      indicador: pegar(x,"INDICADOR"),
      valor: num(x,"VALOR"),
      meta: num(x,"META"),
      percentual: num(x,"PERCENTUAL"),
      periodo: pegar(x,"PERIODO"),
      observacao: pegar(x,"OBSERVACAO")
    })
  });

  res.json({ modulo: "INDICADORES", ...resultado });
});

router.post("/metas/importar", async (req, res) => {
  const itens = req.body.metas;
  if (!Array.isArray(itens)) {
    return res.status(400).json({ erro: "Envie metas como array" });
  }

  const resultado = await importarModulo({
    itens,
    tabela: "metas",
    idCampo: "meta_id",
    prefixo: "MET",
    colunas: [
      "meta_id","cliente_id","jornada_id","categoria","meta","descricao",
      "indicador","valor_inicial","valor_atual","valor_meta","unidade",
      "data_inicio","data_limite","percentual","status","observacoes"
    ],
    mapear: x => ({
      meta_id: pegar(x,"META_ID"),
      cliente_id: pegar(x,"CLIENTE_ID"),
      jornada_id: pegar(x,"JORNADA_ID"),
      categoria: pegar(x,"CATEGORIA"),
      meta: pegar(x,"META"),
      descricao: pegar(x,"DESCRICAO"),
      indicador: pegar(x,"INDICADOR"),
      valor_inicial: num(x,"VALOR_INICIAL"),
      valor_atual: num(x,"VALOR_ATUAL"),
      valor_meta: num(x,"VALOR_META"),
      unidade: pegar(x,"UNIDADE"),
      data_inicio: pegar(x,"DATA_INICIO"),
      data_limite: pegar(x,"DATA_LIMITE"),
      percentual: num(x,"PERCENTUAL"),
      status: pegar(x,"STATUS"),
      observacoes: pegar(x,"OBSERVACOES")
    })
  });

  res.json({ modulo: "METAS", ...resultado });
});

router.post("/clientes-tags/importar", async (req, res) => {
  const itens = req.body.clientes_tags;
  if (!Array.isArray(itens)) {
    return res.status(400).json({ erro: "Envie clientes_tags como array" });
  }

  const resultado = await importarModulo({
    itens,
    tabela: "clientes_tags",
    idCampo: "id_tag",
    prefixo: "TAG",
    colunas: [
      "id_tag","id_cliente","tag","categoria","cor","data_cadastro","usuario"
    ],
    mapear: x => ({
      id_tag: pegar(x,"ID_TAG"),
      id_cliente: pegar(x,"ID_CLIENTE"),
      tag: pegar(x,"TAG"),
      categoria: pegar(x,"CATEGORIA"),
      cor: pegar(x,"COR"),
      data_cadastro: pegar(x,"DATA_CADASTRO"),
      usuario: pegar(x,"USUARIO")
    })
  });

  res.json({ modulo: "CLIENTES_TAGS", ...resultado });
});

module.exports = router;
