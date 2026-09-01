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

function d(body, campo) {
  return vazioNull(body[campo] ?? body[campo.toLowerCase()]);
}

function n(body, campo) {
  return numeroNull(body[campo] ?? body[campo.toLowerCase()]);
}

function i(body, campo) {
  return inteiroNull(body[campo] ?? body[campo.toLowerCase()]);
}

async function importarGenerico({
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

      let existente = null;

      if (idLegado) {
        const busca = await db.query(
          `SELECT id FROM ${tabela} WHERE ${idCampo}=$1 LIMIT 1`,
          [idLegado]
        );
        existente = busca.rows[0] || null;
      }

      const valores = colunas.map(c => dados[c]);

      if (existente) {
        const sets = colunas
          .filter(c => c !== idCampo)
          .map((c, idx) => `${c}=$${idx + 1}`);

        const valoresUpdate = colunas
          .filter(c => c !== idCampo)
          .map(c => dados[c]);

        valoresUpdate.push(existente.id);

        await db.query(
          `UPDATE ${tabela}
           SET ${sets.join(", ")}, atualizado_em=NOW()
           WHERE id=$${valoresUpdate.length}`,
          valoresUpdate
        );

        atualizados++;
      } else {
        const placeholders = colunas.map((_, idx) => `$${idx + 1}`);

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
// CONTAS A RECEBER
// ======================================================

router.get("/contas-receber", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM contas_receber ORDER BY data_vencimento DESC NULLS LAST, id DESC"
    );

    res.json({
      total: r.rows.length,
      contas_receber: r.rows
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar contas a receber" });
  }
});

router.post("/contas-receber/importar", async (req, res) => {
  try {
    const itens = req.body.contas_receber;

    if (!Array.isArray(itens)) {
      return res.status(400).json({
        erro: "Envie contas_receber como array"
      });
    }

    const colunas = [
      "receber_id","id_cliente","descricao","data_emissao","data_vencimento",
      "valor","valor_final","data_pagamento","status","observacoes",
      "forma_pagamento","dias_atraso","cliente_id","cliente_nome","categoria",
      "competencia","desconto","juros","multa","valor_pago","saldo_aberto",
      "banco_id","recorrente","frequencia","parcela_atual","total_parcelas",
      "documento","data_cadastro","data_atualizacao","venda_id","origem_venda",
      "inter_codigo_solicitacao","inter_seu_numero","inter_status",
      "inter_tipo_cobranca","inter_nosso_numero","inter_linha_digitavel",
      "inter_pix_copia_cola","inter_txid","inter_origem_recebimento",
      "inter_valor_recebido","inter_data_criacao","inter_data_atualizacao",
      "inter_pago_em","inter_pagador_cpf_cnpj","inter_pagador_email",
      "inter_pagador_telefone","inter_pagador_endereco","inter_pagador_numero",
      "inter_pagador_complemento","inter_pagador_bairro","inter_pagador_cidade",
      "inter_pagador_uf","inter_pagador_cep","contrato_id","contrato_titulo"
    ];

    const resultado = await importarGenerico({
      itens,
      tabela: "contas_receber",
      idCampo: "receber_id",
      prefixo: "REC",
      colunas,
      mapear: x => ({
        receber_id: d(x,"RECEBER_ID"),
        id_cliente: d(x,"ID_CLIENTE"),
        descricao: d(x,"DESCRICAO"),
        data_emissao: d(x,"DATA_EMISSAO"),
        data_vencimento: d(x,"DATA_VENCIMENTO"),
        valor: n(x,"VALOR"),
        valor_final: n(x,"VALOR_FINAL"),
        data_pagamento: d(x,"DATA_PAGAMENTO"),
        status: d(x,"STATUS"),
        observacoes: d(x,"OBSERVACOES"),
        forma_pagamento: d(x,"FORMA_PAGAMENTO"),
        dias_atraso: i(x,"DIAS_ATRASO"),
        cliente_id: d(x,"CLIENTE_ID"),
        cliente_nome: d(x,"CLIENTE_NOME"),
        categoria: d(x,"CATEGORIA"),
        competencia: d(x,"COMPETENCIA"),
        desconto: n(x,"DESCONTO"),
        juros: n(x,"JUROS"),
        multa: n(x,"MULTA"),
        valor_pago: n(x,"VALOR_PAGO"),
        saldo_aberto: n(x,"SALDO_ABERTO"),
        banco_id: d(x,"BANCO_ID"),
        recorrente: d(x,"RECORRENTE"),
        frequencia: d(x,"FREQUENCIA"),
        parcela_atual: i(x,"PARCELA_ATUAL"),
        total_parcelas: i(x,"TOTAL_PARCELAS"),
        documento: d(x,"DOCUMENTO"),
        data_cadastro: d(x,"DATA_CADASTRO"),
        data_atualizacao: d(x,"DATA_ATUALIZACAO"),
        venda_id: d(x,"VENDA_ID"),
        origem_venda: d(x,"ORIGEM_VENDA"),
        inter_codigo_solicitacao: d(x,"INTER_CODIGO_SOLICITACAO"),
        inter_seu_numero: d(x,"INTER_SEU_NUMERO"),
        inter_status: d(x,"INTER_STATUS"),
        inter_tipo_cobranca: d(x,"INTER_TIPO_COBRANCA"),
        inter_nosso_numero: d(x,"INTER_NOSSO_NUMERO"),
        inter_linha_digitavel: d(x,"INTER_LINHA_DIGITAVEL"),
        inter_pix_copia_cola: d(x,"INTER_PIX_COPIA_COLA"),
        inter_txid: d(x,"INTER_TXID"),
        inter_origem_recebimento: d(x,"INTER_ORIGEM_RECEBIMENTO"),
        inter_valor_recebido: n(x,"INTER_VALOR_RECEBIDO"),
        inter_data_criacao: d(x,"INTER_DATA_CRIACAO"),
        inter_data_atualizacao: d(x,"INTER_DATA_ATUALIZACAO"),
        inter_pago_em: d(x,"INTER_PAGO_EM"),
        inter_pagador_cpf_cnpj: d(x,"INTER_PAGADOR_CPF_CNPJ"),
        inter_pagador_email: d(x,"INTER_PAGADOR_EMAIL"),
        inter_pagador_telefone: d(x,"INTER_PAGADOR_TELEFONE"),
        inter_pagador_endereco: d(x,"INTER_PAGADOR_ENDERECO"),
        inter_pagador_numero: d(x,"INTER_PAGADOR_NUMERO"),
        inter_pagador_complemento: d(x,"INTER_PAGADOR_COMPLEMENTO"),
        inter_pagador_bairro: d(x,"INTER_PAGADOR_BAIRRO"),
        inter_pagador_cidade: d(x,"INTER_PAGADOR_CIDADE"),
        inter_pagador_uf: d(x,"INTER_PAGADOR_UF"),
        inter_pagador_cep: d(x,"INTER_PAGADOR_CEP"),
        contrato_id: d(x,"CONTRATO_ID"),
        contrato_titulo: d(x,"CONTRATO_TITULO")
      })
    });

    res.json({ modulo: "CONTAS_RECEBER", ...resultado });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao importar contas a receber" });
  }
});

// ======================================================
// CONTAS A PAGAR
// ======================================================

router.get("/contas-pagar", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM contas_pagar ORDER BY data_vencimento DESC NULLS LAST, id DESC"
    );

    res.json({
      total: r.rows.length,
      contas_pagar: r.rows
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar contas a pagar" });
  }
});

router.post("/contas-pagar/importar", async (req, res) => {
  try {
    const itens = req.body.contas_pagar;

    if (!Array.isArray(itens)) {
      return res.status(400).json({
        erro: "Envie contas_pagar como array"
      });
    }

    const colunas = [
      "pagar_id","fornecedor","descricao","data_emissao","data_vencimento",
      "valor","valor_final","data_pagamento","status","observacoes","categoria",
      "centro_custo","competencia","desconto","juros","multa","valor_pago",
      "saldo_aberto","banco_id","forma_pagamento","recorrente","frequencia",
      "parcela_atual","total_parcelas","documento","data_cadastro",
      "data_atualizacao","plano_conta"
    ];

    const resultado = await importarGenerico({
      itens,
      tabela: "contas_pagar",
      idCampo: "pagar_id",
      prefixo: "PAG",
      colunas,
      mapear: x => ({
        pagar_id: d(x,"PAGAR_ID"),
        fornecedor: d(x,"FORNECEDOR"),
        descricao: d(x,"DESCRICAO"),
        data_emissao: d(x,"DATA_EMISSAO"),
        data_vencimento: d(x,"DATA_VENCIMENTO"),
        valor: n(x,"VALOR"),
        valor_final: n(x,"VALOR_FINAL"),
        data_pagamento: d(x,"DATA_PAGAMENTO"),
        status: d(x,"STATUS"),
        observacoes: d(x,"OBSERVACOES"),
        categoria: d(x,"CATEGORIA"),
        centro_custo: d(x,"CENTRO_CUSTO"),
        competencia: d(x,"COMPETENCIA"),
        desconto: n(x,"DESCONTO"),
        juros: n(x,"JUROS"),
        multa: n(x,"MULTA"),
        valor_pago: n(x,"VALOR_PAGO"),
        saldo_aberto: n(x,"SALDO_ABERTO"),
        banco_id: d(x,"BANCO_ID"),
        forma_pagamento: d(x,"FORMA_PAGAMENTO"),
        recorrente: d(x,"RECORRENTE"),
        frequencia: d(x,"FREQUENCIA"),
        parcela_atual: i(x,"PARCELA_ATUAL"),
        total_parcelas: i(x,"TOTAL_PARCELAS"),
        documento: d(x,"DOCUMENTO"),
        data_cadastro: d(x,"DATA_CADASTRO"),
        data_atualizacao: d(x,"DATA_ATUALIZACAO"),
        plano_conta: d(x,"PLANO_CONTA")
      })
    });

    res.json({ modulo: "CONTAS_PAGAR", ...resultado });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao importar contas a pagar" });
  }
});

// ======================================================
// FLUXO DE CAIXA
// ======================================================

router.get("/fluxo-caixa", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM fluxo_caixa ORDER BY data DESC NULLS LAST, id DESC"
    );

    res.json({
      total: r.rows.length,
      fluxo_caixa: r.rows
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar fluxo de caixa" });
  }
});

router.post("/fluxo-caixa/importar", async (req, res) => {
  try {
    const itens = req.body.fluxo_caixa;

    if (!Array.isArray(itens)) {
      return res.status(400).json({
        erro: "Envie fluxo_caixa como array"
      });
    }

    const colunas = [
      "fluxo_id","data","tipo","origem","referencia_id","descricao",
      "valor","entrada","saida","saldo","forma_pagamento","observacoes",
      "categoria","banco_id","usuario"
    ];

    const resultado = await importarGenerico({
      itens,
      tabela: "fluxo_caixa",
      idCampo: "fluxo_id",
      prefixo: "FLX",
      colunas,
      mapear: x => ({
        fluxo_id: d(x,"FLUXO_ID"),
        data: d(x,"DATA"),
        tipo: d(x,"TIPO"),
        origem: d(x,"ORIGEM"),
        referencia_id: d(x,"REFERENCIA_ID"),
        descricao: d(x,"DESCRICAO"),
        valor: n(x,"VALOR"),
        entrada: n(x,"ENTRADA"),
        saida: n(x,"SAIDA"),
        saldo: n(x,"SALDO"),
        forma_pagamento: d(x,"FORMA_PAGAMENTO"),
        observacoes: d(x,"OBSERVACOES"),
        categoria: d(x,"CATEGORIA"),
        banco_id: d(x,"BANCO_ID"),
        usuario: d(x,"USUARIO")
      })
    });

    res.json({ modulo: "FLUXO_CAIXA", ...resultado });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao importar fluxo de caixa" });
  }
});

// ======================================================
// COMISSÕES
// ======================================================

router.get("/comissoes", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM comissoes ORDER BY data DESC NULLS LAST, id DESC"
    );

    res.json({
      total: r.rows.length,
      comissoes: r.rows
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar comissões" });
  }
});

router.post("/comissoes/importar", async (req, res) => {
  try {
    const itens = req.body.comissoes;

    if (!Array.isArray(itens)) {
      return res.status(400).json({
        erro: "Envie comissoes como array"
      });
    }

    const colunas = [
      "comissao_id","mentor_id","cliente_id","contrato_id","venda_id",
      "valor_venda","percentual","valor_comissao","data","status","data_pagamento"
    ];

    const resultado = await importarGenerico({
      itens,
      tabela: "comissoes",
      idCampo: "comissao_id",
      prefixo: "COM",
      colunas,
      mapear: x => ({
        comissao_id: d(x,"COMISSAO_ID"),
        mentor_id: d(x,"MENTOR_ID"),
        cliente_id: d(x,"CLIENTE_ID"),
        contrato_id: d(x,"CONTRATO_ID"),
        venda_id: d(x,"VENDA_ID"),
        valor_venda: n(x,"VALOR_VENDA"),
        percentual: n(x,"PERCENTUAL"),
        valor_comissao: n(x,"VALOR_COMISSAO"),
        data: d(x,"DATA"),
        status: d(x,"STATUS"),
        data_pagamento: d(x,"DATA_PAGAMENTO")
      })
    });

    res.json({ modulo: "COMISSOES", ...resultado });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao importar comissões" });
  }
});

module.exports = router;
