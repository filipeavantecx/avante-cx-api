const express = require("express");
const db = require("../database/db");
const verificarToken = require("../middleware/auth");

const router = express.Router();
router.use(verificarToken);

// ============================================================
// HELPERS
// ============================================================

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

const booleanOuPadrao = (v, padrao = true) => {
  if (v === undefined || v === null || v === "") return padrao;
  if (typeof v === "boolean") return v;
  const t = String(v).trim().toLowerCase();
  if (["false", "0", "nao", "não", "n", "inativo"].includes(t)) return false;
  if (["true", "1", "sim", "s", "ativo"].includes(t)) return true;
  return padrao;
};

const pegar = (body, upper, lower) =>
  vazioNull(body?.[upper] ?? body?.[lower]);

const pegarNumero = (body, upper, lower) =>
  numeroNull(body?.[upper] ?? body?.[lower]);

const pegarInteiro = (body, upper, lower) =>
  inteiroNull(body?.[upper] ?? body?.[lower]);

function idFormatado(prefixo, id) {
  return `${prefixo}${String(id).padStart(6, "0")}`;
}

async function proximoIdAtomico(client, tabela, campo, prefixo) {
  const r = await client.query(
    `SELECT nextval(pg_get_serial_sequence($1, 'id')) AS id`,
    [tabela]
  );
  const id = Number(r.rows[0].id);
  return { id, legado: idFormatado(prefixo, id) };
}

function usuarioReq(req) {
  return (
    req.user?.email ||
    req.user?.nome ||
    req.user?.id ||
    "API"
  );
}

function montarContaBase(body = {}, atual = {}) {
  const valor = pegarNumero(body, "VALOR", "valor") ?? numeroNull(atual.valor) ?? 0;
  const desconto = pegarNumero(body, "DESCONTO", "desconto") ?? numeroNull(atual.desconto) ?? 0;
  const juros = pegarNumero(body, "JUROS", "juros") ?? numeroNull(atual.juros) ?? 0;
  const multa = pegarNumero(body, "MULTA", "multa") ?? numeroNull(atual.multa) ?? 0;
  const valorFinal = Math.max(0, valor - desconto + juros + multa);
  const valorPago = pegarNumero(body, "VALOR_PAGO", "valor_pago") ?? numeroNull(atual.valor_pago) ?? 0;
  const saldoAberto = Math.max(0, valorFinal - valorPago);

  let status = String(
    pegar(body, "STATUS", "status") ?? atual.status ?? "PENDENTE"
  ).trim().toUpperCase();

  if (status !== "CANCELADO") {
    status = saldoAberto <= 0.009 && valorFinal > 0
      ? "PAGO"
      : valorPago > 0
        ? "PARCIAL"
        : "PENDENTE";
  }

  return {
    valor,
    desconto,
    juros,
    multa,
    valor_final: valorFinal,
    valor_pago: valorPago,
    saldo_aberto: saldoAberto,
    status
  };
}

function montarReceber(body = {}, atual = {}) {
  const base = montarContaBase(body, atual);
  return {
    id_cliente: pegar(body, "ID_CLIENTE", "id_cliente") ?? atual.id_cliente ?? null,
    descricao: pegar(body, "DESCRICAO", "descricao") ?? atual.descricao ?? null,
    data_emissao: pegar(body, "DATA_EMISSAO", "data_emissao") ?? atual.data_emissao ?? new Date(),
    data_vencimento: pegar(body, "DATA_VENCIMENTO", "data_vencimento") ?? atual.data_vencimento ?? null,
    valor: base.valor,
    valor_final: base.valor_final,
    data_pagamento: pegar(body, "DATA_PAGAMENTO", "data_pagamento") ?? atual.data_pagamento ?? null,
    status: base.status,
    observacoes: pegar(body, "OBSERVACOES", "observacoes") ?? atual.observacoes ?? null,
    forma_pagamento: pegar(body, "FORMA_PAGAMENTO", "forma_pagamento") ?? atual.forma_pagamento ?? null,
    dias_atraso: pegarInteiro(body, "DIAS_ATRASO", "dias_atraso") ?? inteiroNull(atual.dias_atraso),
    cliente_id: pegar(body, "CLIENTE_ID", "cliente_id") ?? atual.cliente_id ?? null,
    cliente_nome: pegar(body, "CLIENTE_NOME", "cliente_nome") ?? atual.cliente_nome ?? null,
    categoria: pegar(body, "CATEGORIA", "categoria") ?? atual.categoria ?? null,
    competencia: pegar(body, "COMPETENCIA", "competencia") ?? atual.competencia ?? null,
    desconto: base.desconto,
    juros: base.juros,
    multa: base.multa,
    valor_pago: base.valor_pago,
    saldo_aberto: base.saldo_aberto,
    banco_id: pegar(body, "BANCO_ID", "banco_id") ?? atual.banco_id ?? null,
    recorrente: pegar(body, "RECORRENTE", "recorrente") ?? atual.recorrente ?? null,
    frequencia: pegar(body, "FREQUENCIA", "frequencia") ?? atual.frequencia ?? null,
    parcela_atual: pegarInteiro(body, "PARCELA_ATUAL", "parcela_atual") ?? inteiroNull(atual.parcela_atual),
    total_parcelas: pegarInteiro(body, "TOTAL_PARCELAS", "total_parcelas") ?? inteiroNull(atual.total_parcelas),
    documento: pegar(body, "DOCUMENTO", "documento") ?? atual.documento ?? null,
    data_cadastro: pegar(body, "DATA_CADASTRO", "data_cadastro") ?? atual.data_cadastro ?? new Date(),
    data_atualizacao: new Date(),
    venda_id: pegar(body, "VENDA_ID", "venda_id") ?? atual.venda_id ?? null,
    origem_venda: pegar(body, "ORIGEM_VENDA", "origem_venda") ?? atual.origem_venda ?? null,
    contrato_id: pegar(body, "CONTRATO_ID", "contrato_id") ?? atual.contrato_id ?? null,
    contrato_titulo: pegar(body, "CONTRATO_TITULO", "contrato_titulo") ?? atual.contrato_titulo ?? null,

    inter_codigo_solicitacao: pegar(body, "INTER_CODIGO_SOLICITACAO", "inter_codigo_solicitacao") ?? atual.inter_codigo_solicitacao ?? null,
    inter_seu_numero: pegar(body, "INTER_SEU_NUMERO", "inter_seu_numero") ?? atual.inter_seu_numero ?? null,
    inter_status: pegar(body, "INTER_STATUS", "inter_status") ?? atual.inter_status ?? null,
    inter_tipo_cobranca: pegar(body, "INTER_TIPO_COBRANCA", "inter_tipo_cobranca") ?? atual.inter_tipo_cobranca ?? null,
    inter_nosso_numero: pegar(body, "INTER_NOSSO_NUMERO", "inter_nosso_numero") ?? atual.inter_nosso_numero ?? null,
    inter_linha_digitavel: pegar(body, "INTER_LINHA_DIGITAVEL", "inter_linha_digitavel") ?? atual.inter_linha_digitavel ?? null,
    inter_pix_copia_cola: pegar(body, "INTER_PIX_COPIA_COLA", "inter_pix_copia_cola") ?? atual.inter_pix_copia_cola ?? null,
    inter_txid: pegar(body, "INTER_TXID", "inter_txid") ?? atual.inter_txid ?? null,
    inter_origem_recebimento: pegar(body, "INTER_ORIGEM_RECEBIMENTO", "inter_origem_recebimento") ?? atual.inter_origem_recebimento ?? null,
    inter_valor_recebido: pegarNumero(body, "INTER_VALOR_RECEBIDO", "inter_valor_recebido") ?? numeroNull(atual.inter_valor_recebido),
    inter_data_criacao: pegar(body, "INTER_DATA_CRIACAO", "inter_data_criacao") ?? atual.inter_data_criacao ?? null,
    inter_data_atualizacao: pegar(body, "INTER_DATA_ATUALIZACAO", "inter_data_atualizacao") ?? atual.inter_data_atualizacao ?? null,
    inter_pago_em: pegar(body, "INTER_PAGO_EM", "inter_pago_em") ?? atual.inter_pago_em ?? null,
    inter_pagador_cpf_cnpj: pegar(body, "INTER_PAGADOR_CPF_CNPJ", "inter_pagador_cpf_cnpj") ?? atual.inter_pagador_cpf_cnpj ?? null,
    inter_pagador_email: pegar(body, "INTER_PAGADOR_EMAIL", "inter_pagador_email") ?? atual.inter_pagador_email ?? null,
    inter_pagador_telefone: pegar(body, "INTER_PAGADOR_TELEFONE", "inter_pagador_telefone") ?? atual.inter_pagador_telefone ?? null,
    inter_pagador_endereco: pegar(body, "INTER_PAGADOR_ENDERECO", "inter_pagador_endereco") ?? atual.inter_pagador_endereco ?? null,
    inter_pagador_numero: pegar(body, "INTER_PAGADOR_NUMERO", "inter_pagador_numero") ?? atual.inter_pagador_numero ?? null,
    inter_pagador_complemento: pegar(body, "INTER_PAGADOR_COMPLEMENTO", "inter_pagador_complemento") ?? atual.inter_pagador_complemento ?? null,
    inter_pagador_bairro: pegar(body, "INTER_PAGADOR_BAIRRO", "inter_pagador_bairro") ?? atual.inter_pagador_bairro ?? null,
    inter_pagador_cidade: pegar(body, "INTER_PAGADOR_CIDADE", "inter_pagador_cidade") ?? atual.inter_pagador_cidade ?? null,
    inter_pagador_uf: pegar(body, "INTER_PAGADOR_UF", "inter_pagador_uf") ?? atual.inter_pagador_uf ?? null,
    inter_pagador_cep: pegar(body, "INTER_PAGADOR_CEP", "inter_pagador_cep") ?? atual.inter_pagador_cep ?? null
  };
}

function montarPagar(body = {}, atual = {}) {
  const base = montarContaBase(body, atual);
  return {
    fornecedor: pegar(body, "FORNECEDOR", "fornecedor") ?? atual.fornecedor ?? null,
    descricao: pegar(body, "DESCRICAO", "descricao") ?? atual.descricao ?? null,
    data_emissao: pegar(body, "DATA_EMISSAO", "data_emissao") ?? atual.data_emissao ?? new Date(),
    data_vencimento: pegar(body, "DATA_VENCIMENTO", "data_vencimento") ?? atual.data_vencimento ?? null,
    valor: base.valor,
    valor_final: base.valor_final,
    data_pagamento: pegar(body, "DATA_PAGAMENTO", "data_pagamento") ?? atual.data_pagamento ?? null,
    status: base.status,
    observacoes: pegar(body, "OBSERVACOES", "observacoes") ?? atual.observacoes ?? null,
    categoria: pegar(body, "CATEGORIA", "categoria") ?? atual.categoria ?? null,
    centro_custo: pegar(body, "CENTRO_CUSTO", "centro_custo") ?? atual.centro_custo ?? null,
    competencia: pegar(body, "COMPETENCIA", "competencia") ?? atual.competencia ?? null,
    desconto: base.desconto,
    juros: base.juros,
    multa: base.multa,
    valor_pago: base.valor_pago,
    saldo_aberto: base.saldo_aberto,
    banco_id: pegar(body, "BANCO_ID", "banco_id") ?? atual.banco_id ?? null,
    forma_pagamento: pegar(body, "FORMA_PAGAMENTO", "forma_pagamento") ?? atual.forma_pagamento ?? null,
    recorrente: pegar(body, "RECORRENTE", "recorrente") ?? atual.recorrente ?? null,
    frequencia: pegar(body, "FREQUENCIA", "frequencia") ?? atual.frequencia ?? null,
    parcela_atual: pegarInteiro(body, "PARCELA_ATUAL", "parcela_atual") ?? inteiroNull(atual.parcela_atual),
    total_parcelas: pegarInteiro(body, "TOTAL_PARCELAS", "total_parcelas") ?? inteiroNull(atual.total_parcelas),
    documento: pegar(body, "DOCUMENTO", "documento") ?? atual.documento ?? null,
    data_cadastro: pegar(body, "DATA_CADASTRO", "data_cadastro") ?? atual.data_cadastro ?? new Date(),
    data_atualizacao: new Date(),
    plano_conta: pegar(body, "PLANO_CONTA", "plano_conta") ?? pegar(body, "CENTRO_CUSTO", "centro_custo") ?? atual.plano_conta ?? atual.centro_custo ?? null
  };
}

async function buscarPorId(client, tabela, campo, id) {
  const r = await client.query(
    `SELECT * FROM ${tabela} WHERE id::text=$1 OR ${campo}=$1 LIMIT 1`,
    [String(id)]
  );
  return r.rows[0] || null;
}

async function inserirFluxo(client, dados, req) {
  const seq = await proximoIdAtomico(client, "fluxo_caixa", "fluxo_id", "FLX");
  const tipo = String(dados.tipo || "").toUpperCase();
  const valor = Number(dados.valor || 0);

  const r = await client.query(
    `INSERT INTO fluxo_caixa (
      id, fluxo_id, data, tipo, origem, referencia_id, descricao,
      valor, entrada, saida, saldo, forma_pagamento, observacoes,
      categoria, banco_id, usuario, criado_em, atualizado_em
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,
      $8,$9,$10,$11,$12,$13,
      $14,$15,$16,NOW(),NOW()
    ) RETURNING *`,
    [
      seq.id,
      seq.legado,
      dados.data || new Date(),
      tipo,
      dados.origem || null,
      dados.referencia_id || null,
      dados.descricao || null,
      valor,
      tipo === "ENTRADA" ? valor : 0,
      tipo === "SAIDA" ? valor : 0,
      null,
      dados.forma_pagamento || null,
      dados.observacoes || null,
      dados.categoria || null,
      dados.banco_id || null,
      dados.usuario || usuarioReq(req)
    ]
  );

  return r.rows[0];
}

// ============================================================
// CONTAS A RECEBER
// ============================================================

router.get("/contas-receber", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT * FROM contas_receber
       ORDER BY data_vencimento DESC NULLS LAST, id DESC`
    );
    res.json({ total: r.rows.length, contas_receber: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar contas a receber", detalhe: e.message });
  }
});

router.get("/contas-receber/:id", async (req, res) => {
  try {
    const conta = await buscarPorId(db, "contas_receber", "receber_id", req.params.id);
    if (!conta) return res.status(404).json({ erro: "Conta a receber não encontrada" });
    res.json({ conta });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao buscar conta a receber", detalhe: e.message });
  }
});

router.post("/contas-receber", async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const dados = montarReceber(req.body);
    if (!dados.descricao) throw new Error("Descrição é obrigatória");
    if (!dados.data_vencimento) throw new Error("Data de vencimento é obrigatória");
    if (!(dados.valor > 0)) throw new Error("Valor deve ser maior que zero");

    const idInformado = pegar(req.body, "RECEBER_ID", "receber_id");
    const seq = await proximoIdAtomico(client, "contas_receber", "receber_id", "REC");
    const receberId = idInformado || seq.legado;

    const cols = [
      "id","receber_id","id_cliente","descricao","data_emissao","data_vencimento",
      "valor","valor_final","data_pagamento","status","observacoes","forma_pagamento",
      "dias_atraso","cliente_id","cliente_nome","categoria","competencia","desconto",
      "juros","multa","valor_pago","saldo_aberto","banco_id","recorrente","frequencia",
      "parcela_atual","total_parcelas","documento","data_cadastro","data_atualizacao",
      "venda_id","origem_venda","contrato_id","contrato_titulo",
      "inter_codigo_solicitacao","inter_seu_numero","inter_status","inter_tipo_cobranca",
      "inter_nosso_numero","inter_linha_digitavel","inter_pix_copia_cola","inter_txid",
      "inter_origem_recebimento","inter_valor_recebido","inter_data_criacao",
      "inter_data_atualizacao","inter_pago_em","inter_pagador_cpf_cnpj","inter_pagador_email",
      "inter_pagador_telefone","inter_pagador_endereco","inter_pagador_numero",
      "inter_pagador_complemento","inter_pagador_bairro","inter_pagador_cidade",
      "inter_pagador_uf","inter_pagador_cep","criado_em","atualizado_em"
    ];

    const vals = [
      seq.id, receberId, dados.id_cliente, dados.descricao, dados.data_emissao, dados.data_vencimento,
      dados.valor, dados.valor_final, dados.data_pagamento, dados.status, dados.observacoes,
      dados.forma_pagamento, dados.dias_atraso, dados.cliente_id, dados.cliente_nome, dados.categoria,
      dados.competencia, dados.desconto, dados.juros, dados.multa, dados.valor_pago, dados.saldo_aberto,
      dados.banco_id, dados.recorrente, dados.frequencia, dados.parcela_atual, dados.total_parcelas,
      dados.documento, dados.data_cadastro, dados.data_atualizacao, dados.venda_id, dados.origem_venda,
      dados.contrato_id, dados.contrato_titulo, dados.inter_codigo_solicitacao, dados.inter_seu_numero,
      dados.inter_status, dados.inter_tipo_cobranca, dados.inter_nosso_numero,
      dados.inter_linha_digitavel, dados.inter_pix_copia_cola, dados.inter_txid,
      dados.inter_origem_recebimento, dados.inter_valor_recebido, dados.inter_data_criacao,
      dados.inter_data_atualizacao, dados.inter_pago_em, dados.inter_pagador_cpf_cnpj,
      dados.inter_pagador_email, dados.inter_pagador_telefone, dados.inter_pagador_endereco,
      dados.inter_pagador_numero, dados.inter_pagador_complemento, dados.inter_pagador_bairro,
      dados.inter_pagador_cidade, dados.inter_pagador_uf, dados.inter_pagador_cep,
      new Date(), new Date()
    ];

    const ph = vals.map((_, i) => `$${i + 1}`).join(",");
    const r = await client.query(
      `INSERT INTO contas_receber (${cols.join(",")}) VALUES (${ph}) RETURNING *`,
      vals
    );
    await client.query("COMMIT");
    res.status(201).json({ mensagem: "Conta a receber cadastrada com sucesso", conta: r.rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ erro: "Erro ao cadastrar conta a receber", detalhe: e.message });
  } finally {
    client.release();
  }
});

async function atualizarReceber(req, res) {
  try {
    const atual = await buscarPorId(db, "contas_receber", "receber_id", req.params.id);
    if (!atual) return res.status(404).json({ erro: "Conta a receber não encontrada" });
    const d = montarReceber(req.body, atual);

    const r = await db.query(
      `UPDATE contas_receber SET
        id_cliente=$1, descricao=$2, data_emissao=$3, data_vencimento=$4,
        valor=$5, valor_final=$6, data_pagamento=$7, status=$8,
        observacoes=$9, forma_pagamento=$10, dias_atraso=$11, cliente_id=$12,
        cliente_nome=$13, categoria=$14, competencia=$15, desconto=$16,
        juros=$17, multa=$18, valor_pago=$19, saldo_aberto=$20, banco_id=$21,
        recorrente=$22, frequencia=$23, parcela_atual=$24, total_parcelas=$25,
        documento=$26, data_atualizacao=NOW(), venda_id=$27, origem_venda=$28,
        contrato_id=$29, contrato_titulo=$30,
        inter_codigo_solicitacao=$31, inter_seu_numero=$32, inter_status=$33,
        inter_tipo_cobranca=$34, inter_nosso_numero=$35, inter_linha_digitavel=$36,
        inter_pix_copia_cola=$37, inter_txid=$38, inter_origem_recebimento=$39,
        inter_valor_recebido=$40, inter_data_criacao=$41, inter_data_atualizacao=$42,
        inter_pago_em=$43, inter_pagador_cpf_cnpj=$44, inter_pagador_email=$45,
        inter_pagador_telefone=$46, inter_pagador_endereco=$47, inter_pagador_numero=$48,
        inter_pagador_complemento=$49, inter_pagador_bairro=$50, inter_pagador_cidade=$51,
        inter_pagador_uf=$52, inter_pagador_cep=$53, atualizado_em=NOW()
       WHERE id=$54 RETURNING *`,
      [
        d.id_cliente,d.descricao,d.data_emissao,d.data_vencimento,d.valor,d.valor_final,
        d.data_pagamento,d.status,d.observacoes,d.forma_pagamento,d.dias_atraso,d.cliente_id,
        d.cliente_nome,d.categoria,d.competencia,d.desconto,d.juros,d.multa,d.valor_pago,
        d.saldo_aberto,d.banco_id,d.recorrente,d.frequencia,d.parcela_atual,d.total_parcelas,
        d.documento,d.venda_id,d.origem_venda,d.contrato_id,d.contrato_titulo,
        d.inter_codigo_solicitacao,d.inter_seu_numero,d.inter_status,d.inter_tipo_cobranca,
        d.inter_nosso_numero,d.inter_linha_digitavel,d.inter_pix_copia_cola,d.inter_txid,
        d.inter_origem_recebimento,d.inter_valor_recebido,d.inter_data_criacao,
        d.inter_data_atualizacao,d.inter_pago_em,d.inter_pagador_cpf_cnpj,d.inter_pagador_email,
        d.inter_pagador_telefone,d.inter_pagador_endereco,d.inter_pagador_numero,
        d.inter_pagador_complemento,d.inter_pagador_bairro,d.inter_pagador_cidade,
        d.inter_pagador_uf,d.inter_pagador_cep,atual.id
      ]
    );
    res.json({ mensagem: "Conta a receber atualizada com sucesso", conta: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao atualizar conta a receber", detalhe: e.message });
  }
}
router.put("/contas-receber/:id", atualizarReceber);
router.patch("/contas-receber/:id", atualizarReceber);

router.patch("/contas-receber/:id/cancelar", async (req, res) => {
  try {
    const conta = await buscarPorId(db, "contas_receber", "receber_id", req.params.id);
    if (!conta) return res.status(404).json({ erro: "Conta a receber não encontrada" });
    if (Number(conta.valor_pago || 0) > 0.009) {
      return res.status(409).json({ erro: "Conta com baixa não pode ser cancelada. Faça estorno antes." });
    }
    const mov = await db.query(
      `SELECT 1 FROM fluxo_caixa WHERE origem='CONTAS_RECEBER' AND referencia_id=$1 LIMIT 1`,
      [conta.receber_id]
    );
    if (mov.rows.length) {
      return res.status(409).json({ erro: "Conta possui movimento no fluxo. Faça estorno antes." });
    }
    const r = await db.query(
      `UPDATE contas_receber SET status='CANCELADO', data_atualizacao=NOW(), atualizado_em=NOW()
       WHERE id=$1 RETURNING *`,
      [conta.id]
    );
    res.json({ mensagem: "Conta a receber cancelada", conta: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao cancelar conta a receber", detalhe: e.message });
  }
});

router.post("/contas-receber/:id/receber", async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const conta = await buscarPorId(client, "contas_receber", "receber_id", req.params.id);
    if (!conta) throw new Error("Conta a receber não encontrada");
    if (String(conta.status || "").toUpperCase() === "CANCELADO") throw new Error("Conta cancelada não pode ser recebida");

    const saldo = Number(conta.saldo_aberto ?? conta.valor_final ?? conta.valor ?? 0);
    const valor = numeroNull(req.body.valorPago ?? req.body.VALOR_PAGO ?? req.body.valor) ?? saldo;
    if (!(valor > 0)) throw new Error("Valor recebido deve ser maior que zero");
    if (valor > saldo + 0.009) throw new Error("Valor recebido maior que o saldo em aberto");

    const pago = Number(conta.valor_pago || 0) + valor;
    const total = Number(conta.valor_final ?? conta.valor ?? 0);
    const novoSaldo = Math.max(0, total - pago);
    const status = novoSaldo <= 0.009 ? "PAGO" : "PARCIAL";
    const data = req.body.dataPagamento ?? req.body.DATA_PAGAMENTO ?? new Date();
    const banco = req.body.bancoId ?? req.body.BANCO_ID ?? conta.banco_id ?? null;
    const forma = req.body.formaPagamento ?? req.body.FORMA_PAGAMENTO ?? conta.forma_pagamento ?? null;
    const obs = req.body.observacoes ?? req.body.OBSERVACOES ?? null;

    const upd = await client.query(
      `UPDATE contas_receber SET
        data_pagamento=$1, status=$2, valor_pago=$3, saldo_aberto=$4,
        banco_id=$5, forma_pagamento=$6, data_atualizacao=NOW(), atualizado_em=NOW()
       WHERE id=$7 RETURNING *`,
      [data,status,pago,novoSaldo,banco,forma,conta.id]
    );

    const fluxo = await inserirFluxo(client, {
      tipo: "ENTRADA", origem: "CONTAS_RECEBER", referencia_id: conta.receber_id,
      descricao: conta.descricao || "Recebimento", valor, categoria: conta.categoria,
      banco_id: banco, forma_pagamento: forma, observacoes: obs, data
    }, req);

    await client.query("COMMIT");
    res.json({ mensagem: "Recebimento registrado com sucesso", conta: upd.rows[0], fluxo });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ erro: "Erro ao registrar recebimento", detalhe: e.message });
  } finally {
    client.release();
  }
});

// ============================================================
// CONTAS A PAGAR
// ============================================================

router.get("/contas-pagar", async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM contas_pagar ORDER BY data_vencimento DESC NULLS LAST, id DESC`);
    res.json({ total: r.rows.length, contas_pagar: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar contas a pagar", detalhe: e.message });
  }
});

router.get("/contas-pagar/:id", async (req, res) => {
  try {
    const conta = await buscarPorId(db, "contas_pagar", "pagar_id", req.params.id);
    if (!conta) return res.status(404).json({ erro: "Conta a pagar não encontrada" });
    res.json({ conta });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao buscar conta a pagar", detalhe: e.message });
  }
});

router.post("/contas-pagar", async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const d = montarPagar(req.body);
    if (!d.descricao) throw new Error("Descrição é obrigatória");
    if (!d.data_vencimento) throw new Error("Data de vencimento é obrigatória");
    if (!(d.valor > 0)) throw new Error("Valor deve ser maior que zero");

    const idInformado = pegar(req.body, "PAGAR_ID", "pagar_id");
    const seq = await proximoIdAtomico(client, "contas_pagar", "pagar_id", "PAG");
    const pagarId = idInformado || seq.legado;

    const r = await client.query(
      `INSERT INTO contas_pagar (
        id,pagar_id,fornecedor,descricao,data_emissao,data_vencimento,valor,valor_final,
        data_pagamento,status,observacoes,categoria,centro_custo,competencia,desconto,juros,
        multa,valor_pago,saldo_aberto,banco_id,forma_pagamento,recorrente,frequencia,
        parcela_atual,total_parcelas,documento,data_cadastro,data_atualizacao,plano_conta,
        criado_em,atualizado_em
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,NOW(),NOW()
      ) RETURNING *`,
      [
        seq.id,pagarId,d.fornecedor,d.descricao,d.data_emissao,d.data_vencimento,d.valor,
        d.valor_final,d.data_pagamento,d.status,d.observacoes,d.categoria,d.centro_custo,
        d.competencia,d.desconto,d.juros,d.multa,d.valor_pago,d.saldo_aberto,d.banco_id,
        d.forma_pagamento,d.recorrente,d.frequencia,d.parcela_atual,d.total_parcelas,
        d.documento,d.data_cadastro,d.data_atualizacao,d.plano_conta
      ]
    );
    await client.query("COMMIT");
    res.status(201).json({ mensagem: "Conta a pagar cadastrada com sucesso", conta: r.rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ erro: "Erro ao cadastrar conta a pagar", detalhe: e.message });
  } finally {
    client.release();
  }
});

async function atualizarPagar(req, res) {
  try {
    const atual = await buscarPorId(db, "contas_pagar", "pagar_id", req.params.id);
    if (!atual) return res.status(404).json({ erro: "Conta a pagar não encontrada" });
    const d = montarPagar(req.body, atual);
    const r = await db.query(
      `UPDATE contas_pagar SET
        fornecedor=$1,descricao=$2,data_emissao=$3,data_vencimento=$4,valor=$5,valor_final=$6,
        data_pagamento=$7,status=$8,observacoes=$9,categoria=$10,centro_custo=$11,competencia=$12,
        desconto=$13,juros=$14,multa=$15,valor_pago=$16,saldo_aberto=$17,banco_id=$18,
        forma_pagamento=$19,recorrente=$20,frequencia=$21,parcela_atual=$22,total_parcelas=$23,
        documento=$24,data_atualizacao=NOW(),plano_conta=$25,atualizado_em=NOW()
       WHERE id=$26 RETURNING *`,
      [
        d.fornecedor,d.descricao,d.data_emissao,d.data_vencimento,d.valor,d.valor_final,
        d.data_pagamento,d.status,d.observacoes,d.categoria,d.centro_custo,d.competencia,
        d.desconto,d.juros,d.multa,d.valor_pago,d.saldo_aberto,d.banco_id,d.forma_pagamento,
        d.recorrente,d.frequencia,d.parcela_atual,d.total_parcelas,d.documento,d.plano_conta,atual.id
      ]
    );
    res.json({ mensagem: "Conta a pagar atualizada com sucesso", conta: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao atualizar conta a pagar", detalhe: e.message });
  }
}
router.put("/contas-pagar/:id", atualizarPagar);
router.patch("/contas-pagar/:id", atualizarPagar);

router.patch("/contas-pagar/:id/cancelar", async (req, res) => {
  try {
    const conta = await buscarPorId(db, "contas_pagar", "pagar_id", req.params.id);
    if (!conta) return res.status(404).json({ erro: "Conta a pagar não encontrada" });
    if (Number(conta.valor_pago || 0) > 0.009) {
      return res.status(409).json({ erro: "Conta com baixa não pode ser cancelada. Faça estorno antes." });
    }
    const mov = await db.query(
      `SELECT 1 FROM fluxo_caixa WHERE origem='CONTAS_PAGAR' AND referencia_id=$1 LIMIT 1`,
      [conta.pagar_id]
    );
    if (mov.rows.length) return res.status(409).json({ erro: "Conta possui movimento no fluxo. Faça estorno antes." });
    const r = await db.query(
      `UPDATE contas_pagar SET status='CANCELADO',data_atualizacao=NOW(),atualizado_em=NOW()
       WHERE id=$1 RETURNING *`,
      [conta.id]
    );
    res.json({ mensagem: "Conta a pagar cancelada", conta: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao cancelar conta a pagar", detalhe: e.message });
  }
});

router.post("/contas-pagar/:id/pagar", async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const conta = await buscarPorId(client, "contas_pagar", "pagar_id", req.params.id);
    if (!conta) throw new Error("Conta a pagar não encontrada");
    if (String(conta.status || "").toUpperCase() === "CANCELADO") throw new Error("Conta cancelada não pode ser paga");

    const saldo = Number(conta.saldo_aberto ?? conta.valor_final ?? conta.valor ?? 0);
    const valor = numeroNull(req.body.valorPago ?? req.body.VALOR_PAGO ?? req.body.valor) ?? saldo;
    if (!(valor > 0)) throw new Error("Valor pago deve ser maior que zero");
    if (valor > saldo + 0.009) throw new Error("Valor pago maior que o saldo em aberto");

    const pago = Number(conta.valor_pago || 0) + valor;
    const total = Number(conta.valor_final ?? conta.valor ?? 0);
    const novoSaldo = Math.max(0, total - pago);
    const status = novoSaldo <= 0.009 ? "PAGO" : "PARCIAL";
    const data = req.body.dataPagamento ?? req.body.DATA_PAGAMENTO ?? new Date();
    const banco = req.body.bancoId ?? req.body.BANCO_ID ?? conta.banco_id ?? null;
    const forma = req.body.formaPagamento ?? req.body.FORMA_PAGAMENTO ?? conta.forma_pagamento ?? null;
    const obs = req.body.observacoes ?? req.body.OBSERVACOES ?? null;

    const upd = await client.query(
      `UPDATE contas_pagar SET data_pagamento=$1,status=$2,valor_pago=$3,saldo_aberto=$4,
       banco_id=$5,forma_pagamento=$6,data_atualizacao=NOW(),atualizado_em=NOW()
       WHERE id=$7 RETURNING *`,
      [data,status,pago,novoSaldo,banco,forma,conta.id]
    );

    const fluxo = await inserirFluxo(client, {
      tipo: "SAIDA", origem: "CONTAS_PAGAR", referencia_id: conta.pagar_id,
      descricao: conta.descricao || "Pagamento", valor, categoria: conta.categoria,
      banco_id: banco, forma_pagamento: forma, observacoes: obs, data
    }, req);

    await client.query("COMMIT");
    res.json({ mensagem: "Pagamento registrado com sucesso", conta: upd.rows[0], fluxo });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ erro: "Erro ao registrar pagamento", detalhe: e.message });
  } finally {
    client.release();
  }
});

// ============================================================
// FLUXO DE CAIXA
// ============================================================

router.get("/fluxo-caixa", async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM fluxo_caixa ORDER BY data DESC NULLS LAST, id DESC`);
    res.json({ total: r.rows.length, fluxo_caixa: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar fluxo de caixa", detalhe: e.message });
  }
});

router.post("/fluxo-caixa", async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const tipo = String(req.body.TIPO ?? req.body.tipo ?? "").trim().toUpperCase();
    const valor = numeroNull(req.body.VALOR ?? req.body.valor);
    if (!["ENTRADA", "SAIDA"].includes(tipo)) throw new Error("Tipo deve ser ENTRADA ou SAIDA");
    if (!(valor > 0)) throw new Error("Valor deve ser maior que zero");
    const fluxo = await inserirFluxo(client, {
      tipo,
      origem: req.body.ORIGEM ?? req.body.origem ?? "LANCAMENTO_MANUAL",
      referencia_id: req.body.REFERENCIA_ID ?? req.body.referencia_id ?? null,
      descricao: req.body.DESCRICAO ?? req.body.descricao ?? "Lançamento manual",
      valor,
      categoria: req.body.CATEGORIA ?? req.body.categoria ?? null,
      banco_id: req.body.BANCO_ID ?? req.body.banco_id ?? null,
      forma_pagamento: req.body.FORMA_PAGAMENTO ?? req.body.forma_pagamento ?? null,
      observacoes: req.body.OBSERVACOES ?? req.body.observacoes ?? null,
      data: req.body.DATA ?? req.body.data ?? new Date()
    }, req);
    await client.query("COMMIT");
    res.status(201).json({ mensagem: "Lançamento criado com sucesso", fluxo });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ erro: "Erro ao criar lançamento", detalhe: e.message });
  } finally {
    client.release();
  }
});

// ============================================================
// BANCOS / CAIXAS
// ============================================================

function montarBanco(body = {}, atual = {}) {
  return {
    nome: pegar(body,"NOME","nome") ?? atual.nome ?? pegar(body,"INSTITUICAO","instituicao") ?? atual.instituicao ?? null,
    instituicao: pegar(body,"INSTITUICAO","instituicao") ?? atual.instituicao ?? null,
    tipo_conta: pegar(body,"TIPO_CONTA","tipo_conta") ?? atual.tipo_conta ?? "CONTA_CORRENTE",
    agencia: pegar(body,"AGENCIA","agencia") ?? atual.agencia ?? null,
    conta: pegar(body,"CONTA","conta") ?? atual.conta ?? null,
    pix: pegar(body,"PIX","pix") ?? atual.pix ?? null,
    saldo_inicial: pegarNumero(body,"SALDO_INICIAL","saldo_inicial") ?? numeroNull(atual.saldo_inicial) ?? 0,
    ativo: booleanOuPadrao(body.ATIVO ?? body.ativo, atual.ativo ?? true),
    observacoes: pegar(body,"OBSERVACOES","observacoes") ?? atual.observacoes ?? null,
    data_cadastro: pegar(body,"DATA_CADASTRO","data_cadastro") ?? atual.data_cadastro ?? new Date()
  };
}

router.get("/bancos-financeiro", async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM bancos_financeiro ORDER BY nome ASC NULLS LAST, id ASC`);
    res.json({ total: r.rows.length, bancos_financeiro: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar bancos", detalhe: e.message });
  }
});

router.get("/bancos-financeiro/:id", async (req, res) => {
  try {
    const banco = await buscarPorId(db, "bancos_financeiro", "banco_id", req.params.id);
    if (!banco) return res.status(404).json({ erro: "Banco não encontrado" });
    res.json({ banco });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao buscar banco", detalhe: e.message });
  }
});

router.post("/bancos-financeiro", async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const d = montarBanco(req.body);
    if (!d.nome) throw new Error("Nome da conta financeira é obrigatório");
    const idInformado = pegar(req.body,"BANCO_ID","banco_id");
    const seq = await proximoIdAtomico(client, "bancos_financeiro", "banco_id", "BNK");
    const bancoId = idInformado || seq.legado;
    const r = await client.query(
      `INSERT INTO bancos_financeiro (
        id,banco_id,nome,instituicao,tipo_conta,agencia,conta,pix,saldo_inicial,ativo,
        observacoes,data_cadastro,data_atualizacao,criado_em,atualizado_em
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW(),NOW()) RETURNING *`,
      [seq.id,bancoId,d.nome,d.instituicao,d.tipo_conta,d.agencia,d.conta,d.pix,d.saldo_inicial,d.ativo,d.observacoes,d.data_cadastro]
    );
    await client.query("COMMIT");
    res.status(201).json({ mensagem: "Banco cadastrado com sucesso", banco: r.rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ erro: "Erro ao cadastrar banco", detalhe: e.message });
  } finally {
    client.release();
  }
});

router.put("/bancos-financeiro/:id", async (req, res) => {
  try {
    const atual = await buscarPorId(db, "bancos_financeiro", "banco_id", req.params.id);
    if (!atual) return res.status(404).json({ erro: "Banco não encontrado" });
    const d = montarBanco(req.body, atual);
    const r = await db.query(
      `UPDATE bancos_financeiro SET nome=$1,instituicao=$2,tipo_conta=$3,agencia=$4,conta=$5,
       pix=$6,saldo_inicial=$7,ativo=$8,observacoes=$9,data_atualizacao=NOW(),atualizado_em=NOW()
       WHERE id=$10 RETURNING *`,
      [d.nome,d.instituicao,d.tipo_conta,d.agencia,d.conta,d.pix,d.saldo_inicial,d.ativo,d.observacoes,atual.id]
    );
    res.json({ mensagem: "Banco atualizado com sucesso", banco: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao atualizar banco", detalhe: e.message });
  }
});

router.patch("/bancos-financeiro/:id/inativar", async (req, res) => {
  try {
    const banco = await buscarPorId(db, "bancos_financeiro", "banco_id", req.params.id);
    if (!banco) return res.status(404).json({ erro: "Banco não encontrado" });
    const r = await db.query(
      `UPDATE bancos_financeiro SET ativo=false,data_atualizacao=NOW(),atualizado_em=NOW() WHERE id=$1 RETURNING *`,
      [banco.id]
    );
    res.json({ mensagem: "Banco inativado", banco: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao inativar banco", detalhe: e.message });
  }
});

router.patch("/bancos-financeiro/:id/ativar", async (req, res) => {
  try {
    const banco = await buscarPorId(db, "bancos_financeiro", "banco_id", req.params.id);
    if (!banco) return res.status(404).json({ erro: "Banco não encontrado" });
    const r = await db.query(
      `UPDATE bancos_financeiro SET ativo=true,data_atualizacao=NOW(),atualizado_em=NOW() WHERE id=$1 RETURNING *`,
      [banco.id]
    );
    res.json({ mensagem: "Banco reativado", banco: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao reativar banco", detalhe: e.message });
  }
});

// ============================================================
// COMISSÕES
// ============================================================

router.get("/comissoes", async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM comissoes ORDER BY data DESC NULLS LAST, id DESC`);
    res.json({ total: r.rows.length, comissoes: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar comissões", detalhe: e.message });
  }
});

router.post("/comissoes", async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const seq = await proximoIdAtomico(client, "comissoes", "comissao_id", "COM");
    const comissaoId = pegar(req.body,"COMISSAO_ID","comissao_id") || seq.legado;
    const r = await client.query(
      `INSERT INTO comissoes (
        id,comissao_id,mentor_id,cliente_id,contrato_id,venda_id,valor_venda,percentual,
        valor_comissao,data,status,data_pagamento,criado_em,atualizado_em
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW()) RETURNING *`,
      [
        seq.id,comissaoId,pegar(req.body,"MENTOR_ID","mentor_id"),pegar(req.body,"CLIENTE_ID","cliente_id"),
        pegar(req.body,"CONTRATO_ID","contrato_id"),pegar(req.body,"VENDA_ID","venda_id"),
        pegarNumero(req.body,"VALOR_VENDA","valor_venda"),pegarNumero(req.body,"PERCENTUAL","percentual"),
        pegarNumero(req.body,"VALOR_COMISSAO","valor_comissao"),pegar(req.body,"DATA","data") || new Date(),
        pegar(req.body,"STATUS","status") || "PENDENTE",pegar(req.body,"DATA_PAGAMENTO","data_pagamento")
      ]
    );
    await client.query("COMMIT");
    res.status(201).json({ mensagem: "Comissão cadastrada", comissao: r.rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ erro: "Erro ao cadastrar comissão", detalhe: e.message });
  } finally {
    client.release();
  }
});

// ============================================================
// FINALIZAÇÃO DE VENDA - TRANSAÇÃO ÚNICA
// ============================================================

router.post("/financeiro/finalizar-venda", async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const clienteId = String(req.body.CLIENTE_ID ?? req.body.cliente_id ?? "").trim();
    const clienteNome = String(req.body.CLIENTE_NOME ?? req.body.cliente_nome ?? "").trim();
    const produto = String(req.body.PRODUTO_SERVICO ?? req.body.produto_servico ?? "Contrato").trim();
    const valorTotal = Number(req.body.VALOR_TOTAL ?? req.body.valor_total ?? 0);
    const formas = req.body.FORMAS ?? req.body.formas ?? [];
    const contratoId = req.body.CONTRATO_ID ?? req.body.contrato_id ?? null;
    const contratoTitulo = req.body.CONTRATO_TITULO ?? req.body.contrato_titulo ?? null;

    if (!clienteId) throw new Error("Cliente não informado");
    if (!clienteNome) throw new Error("Nome do cliente não informado");
    if (!(valorTotal > 0)) throw new Error("Valor total deve ser maior que zero");
    if (!Array.isArray(formas) || !formas.length) throw new Error("Informe pelo menos uma forma de pagamento");

    const totalDistribuido = formas.reduce((s, f) => s + Number(f.VALOR ?? f.valor ?? 0), 0);
    if (Math.abs(valorTotal - totalDistribuido) > 0.009) {
      throw new Error(`Soma das formas (${totalDistribuido.toFixed(2)}) difere do total (${valorTotal.toFixed(2)})`);
    }

    const vendaId = `VEN${Date.now()}`;
    const dataVenda = req.body.DATA_VENDA ?? req.body.data_venda ?? new Date();
    const criadas = [];
    let recebidoAgora = 0;

    for (const formaItem of formas) {
      const forma = String(formaItem.FORMA_PAGAMENTO ?? formaItem.forma_pagamento ?? "").trim();
      const valorForma = Number(formaItem.VALOR ?? formaItem.valor ?? 0);
      const parcelas = Math.max(1, Math.min(120, parseInt(formaItem.PARCELAS ?? formaItem.parcelas ?? 1, 10) || 1));
      const primeiro = new Date(formaItem.PRIMEIRO_VENCIMENTO ?? formaItem.primeiro_vencimento);
      if (!forma) throw new Error("Forma de pagamento não informada");
      if (!(valorForma > 0)) throw new Error("Valor de forma de pagamento inválido");
      if (isNaN(primeiro.getTime())) throw new Error("Primeiro vencimento inválido");

      const centavos = Math.round(valorForma * 100);
      const base = Math.floor(centavos / parcelas);
      const resto = centavos - base * parcelas;

      for (let p = 1; p <= parcelas; p++) {
        const valorParcela = (base + (p <= resto ? 1 : 0)) / 100;
        const venc = new Date(primeiro.getTime());
        venc.setMonth(venc.getMonth() + (p - 1));

        const seq = await proximoIdAtomico(client, "contas_receber", "receber_id", "REC");
        const desc = `${produto} - ${clienteNome}${parcelas > 1 ? ` (${p}/${parcelas})` : ""}`;
        const recebido = formaItem.RECEBIDO_AGORA === true || String(formaItem.RECEBIDO_AGORA || "").toUpperCase() === "SIM";
        const valorPago = recebido ? valorParcela : 0;
        const saldo = recebido ? 0 : valorParcela;
        const status = recebido ? "PAGO" : "PENDENTE";
        const bancoId = formaItem.BANCO_ID ?? formaItem.banco_id ?? null;

        const r = await client.query(
          `INSERT INTO contas_receber (
            id,receber_id,id_cliente,cliente_id,cliente_nome,descricao,data_emissao,data_vencimento,
            valor,valor_final,valor_pago,saldo_aberto,status,banco_id,forma_pagamento,categoria,
            competencia,parcela_atual,total_parcelas,documento,venda_id,origem_venda,observacoes,
            contrato_id,contrato_titulo,data_pagamento,data_cadastro,data_atualizacao,criado_em,atualizado_em
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,NOW(),NOW(),NOW(),NOW()
          ) RETURNING *`,
          [
            seq.id,seq.legado,clienteId,clienteId,clienteNome,desc,dataVenda,venc,valorParcela,valorParcela,
            valorPago,saldo,status,bancoId,forma,"VENDA",null,p,parcelas,vendaId,vendaId,"CLIENTES",
            req.body.OBSERVACOES ?? req.body.observacoes ?? null,contratoId,contratoTitulo,recebido ? dataVenda : null
          ]
        );
        criadas.push(r.rows[0]);

        if (recebido) {
          await inserirFluxo(client, {
            tipo: "ENTRADA", origem: "CONTAS_RECEBER", referencia_id: seq.legado,
            descricao: desc, valor: valorParcela, categoria: "VENDA", banco_id: bancoId,
            forma_pagamento: forma, observacoes: `Recebimento na finalização da venda ${vendaId}`, data: dataVenda
          }, req);
          recebidoAgora += valorParcela;
        }
      }
    }

    await client.query("COMMIT");
    res.status(201).json({
      sucesso: true,
      venda_id: vendaId,
      quantidade_titulos: criadas.length,
      valor_total: valorTotal,
      valor_recebido_agora: recebidoAgora,
      contas_criadas: criadas.map(c => c.receber_id)
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ erro: "Erro ao finalizar venda", detalhe: e.message });
  } finally {
    client.release();
  }
});

// ============================================================
// RESUMO
// ============================================================

router.get("/financeiro/resumo-migracao", async (req, res) => {
  try {
    const [bancos, receber, pagar, fluxo, comissoes] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS total FROM bancos_financeiro"),
      db.query("SELECT COUNT(*)::int AS total FROM contas_receber"),
      db.query("SELECT COUNT(*)::int AS total FROM contas_pagar"),
      db.query("SELECT COUNT(*)::int AS total FROM fluxo_caixa"),
      db.query("SELECT COUNT(*)::int AS total FROM comissoes")
    ]);
    res.json({ financeiro: {
      bancos_financeiro: bancos.rows[0].total,
      contas_receber: receber.rows[0].total,
      contas_pagar: pagar.rows[0].total,
      fluxo_caixa: fluxo.rows[0].total,
      comissoes: comissoes.rows[0].total
    }});
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao gerar resumo financeiro", detalhe: e.message });
  }
});

module.exports = router;
