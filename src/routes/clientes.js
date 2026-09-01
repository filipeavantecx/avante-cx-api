const express = require("express");
const db = require("../database/db");
const verificarToken = require("../middleware/auth");

const router = express.Router();

// Todas as rotas abaixo exigem autenticação
router.use(verificarToken);


// ======================================================
// HELPERS
// ======================================================

function valorOuNull(valor) {
  if (valor === undefined || valor === null || valor === "") {
    return null;
  }

  return valor;
}

function booleanOuPadrao(valor, padrao = true) {
  if (valor === undefined || valor === null || valor === "") {
    return padrao;
  }

  if (typeof valor === "boolean") {
    return valor;
  }

  const texto = String(valor).trim().toLowerCase();

  if (["true", "1", "sim", "s", "ativo"].includes(texto)) {
    return true;
  }

  if (["false", "0", "nao", "não", "n", "inativo"].includes(texto)) {
    return false;
  }

  return padrao;
}

function numeroOuNull(valor) {
  if (valor === undefined || valor === null || valor === "") {
    return null;
  }

  const numero = Number(valor);

  return Number.isFinite(numero) ? numero : null;
}

async function verificarDuplicidade({ cpf, cnpj, idIgnorar = null }) {
  if (cpf) {
    const parametros = [cpf];
    let sql = "SELECT id FROM clientes WHERE cpf = $1";

    if (idIgnorar !== null) {
      parametros.push(idIgnorar);
      sql += " AND id <> $2";
    }

    const resultadoCpf = await db.query(sql, parametros);

    if (resultadoCpf.rows.length > 0) {
      return "CPF";
    }
  }

  if (cnpj) {
    const parametros = [cnpj];
    let sql = "SELECT id FROM clientes WHERE cnpj = $1";

    if (idIgnorar !== null) {
      parametros.push(idIgnorar);
      sql += " AND id <> $2";
    }

    const resultadoCnpj = await db.query(sql, parametros);

    if (resultadoCnpj.rows.length > 0) {
      return "CNPJ";
    }
  }

  return null;
}

function montarDadosCliente(body = {}) {
  return {
    // Identificação
    id_cliente: valorOuNull(body.id_cliente ?? body.ID_CLIENTE),
    nome_completo: valorOuNull(
      body.nome_completo ??
      body.NOME_COMPLETO ??
      body.nome
    ),

    foto_id: valorOuNull(body.foto_id ?? body.FOTO_ID),
    foto_url: valorOuNull(body.foto_url ?? body.FOTO_URL),

    cpf: valorOuNull(body.cpf ?? body.CPF),
    cnpj: valorOuNull(body.cnpj ?? body.CNPJ),
    data_nascimento: valorOuNull(
      body.data_nascimento ??
      body.DATA_NASCIMENTO
    ),

    // Contato
    telefone: valorOuNull(body.telefone ?? body.TELEFONE),
    whatsapp: valorOuNull(body.whatsapp ?? body.WHATSAPP),
    email: valorOuNull(body.email ?? body.EMAIL),

    // Profissional / empresa
    cargo: valorOuNull(body.cargo ?? body.CARGO),
    empresa: valorOuNull(body.empresa ?? body.EMPRESA),
    razao_social: valorOuNull(body.razao_social ?? body.RAZAO_SOCIAL),
    nome_fantasia: valorOuNull(body.nome_fantasia ?? body.NOME_FANTASIA),
    segmento: valorOuNull(body.segmento ?? body.SEGMENTO),
    porte_empresa: valorOuNull(body.porte_empresa ?? body.PORTE_EMPRESA),
    num_funcionarios: numeroOuNull(
      body.num_funcionarios ??
      body.NUM_FUNCIONARIOS
    ),

    // Localização
    cidade: valorOuNull(body.cidade ?? body.CIDADE),
    estado: valorOuNull(body.estado ?? body.ESTADO),
    cep: valorOuNull(body.cep ?? body.CEP),
    endereco: valorOuNull(body.endereco ?? body.ENDERECO),

    // Presença digital
    site: valorOuNull(body.site ?? body.SITE),
    instagram: valorOuNull(body.instagram ?? body.INSTAGRAM),

    // Comercial
    origem_lead: valorOuNull(
      body.origem_lead ??
      body.ORIGEM_LEAD ??
      body.origem
    ),
    data_entrada: valorOuNull(body.data_entrada ?? body.DATA_ENTRADA),
    responsavel: valorOuNull(body.responsavel ?? body.RESPONSAVEL),

    produto_servico: valorOuNull(
      body.produto_servico ??
      body.PRODUTO_SERVICO
    ),
    valor_contrato: numeroOuNull(
      body.valor_contrato ??
      body.VALOR_CONTRATO
    ),
    forma_pagamento: valorOuNull(
      body.forma_pagamento ??
      body.FORMA_PAGAMENTO
    ),

    status_comercial: valorOuNull(
      body.status_comercial ??
      body.STATUS_COMERCIAL
    ),
    status_cliente:
      valorOuNull(
        body.status_cliente ??
        body.STATUS_CLIENTE ??
        body.status
      ) || "ATIVO",

    // Jornada
    etapa_jornada: valorOuNull(
      body.etapa_jornada ??
      body.ETAPA_JORNADA
    ),
    mentor_consultor: valorOuNull(
      body.mentor_consultor ??
      body.MENTOR_CONSULTOR
    ),

    objetivo_principal: valorOuNull(
      body.objetivo_principal ??
      body.OBJETIVO_PRINCIPAL
    ),
    meta_principal: valorOuNull(
      body.meta_principal ??
      body.META_PRINCIPAL
    ),

    data_inicio: valorOuNull(body.data_inicio ?? body.DATA_INICIO),
    data_previsao_conclusao: valorOuNull(
      body.data_previsao_conclusao ??
      body.DATA_PREVISAO_CONCLUSAO
    ),

    health_score: numeroOuNull(
      body.health_score ??
      body.HEALTH_SCORE
    ),

    ultima_interacao: valorOuNull(
      body.ultima_interacao ??
      body.ULTIMA_INTERACAO
    ),
    proxima_sessao: valorOuNull(
      body.proxima_sessao ??
      body.PROXIMA_SESSAO
    ),

    // Auditoria legada
    data_cadastro: valorOuNull(
      body.data_cadastro ??
      body.DATA_CADASTRO
    ),
    data_atualizacao: valorOuNull(
      body.data_atualizacao ??
      body.DATA_ATUALIZACAO
    ),
    usuario_cadastro: valorOuNull(
      body.usuario_cadastro ??
      body.USUARIO_CADASTRO
    ),
    usuario_atualizacao: valorOuNull(
      body.usuario_atualizacao ??
      body.USUARIO_ATUALIZACAO
    ),

    ativo: booleanOuPadrao(
      body.ativo ??
      body.ATIVO,
      true
    ),

    observacoes: valorOuNull(
      body.observacoes ??
      body.OBSERVACOES
    )
  };
}


// ======================================================
// LISTAR CLIENTES
// ======================================================

router.get("/", async (req, res) => {
  try {
    const resultado = await db.query(`
      SELECT
        id,
        id_cliente,
        nome_completo,
        foto_id,
        foto_url,
        cpf,
        cnpj,
        data_nascimento,
        telefone,
        whatsapp,
        email,
        cargo,
        empresa,
        razao_social,
        nome_fantasia,
        segmento,
        porte_empresa,
        num_funcionarios,
        cidade,
        estado,
        site,
        instagram,
        origem_lead,
        data_entrada,
        responsavel,
        produto_servico,
        valor_contrato,
        forma_pagamento,
        status_comercial,
        status_cliente,
        etapa_jornada,
        mentor_consultor,
        objetivo_principal,
        meta_principal,
        data_inicio,
        data_previsao_conclusao,
        health_score,
        ultima_interacao,
        proxima_sessao,
        data_cadastro,
        data_atualizacao,
        usuario_cadastro,
        usuario_atualizacao,
        ativo,
        observacoes,
        cep,
        endereco,
        criado_por,
        criado_em,
        atualizado_em
      FROM clientes
      ORDER BY nome_completo ASC
    `);

    res.json({
      total: resultado.rows.length,
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
// IMPORTAR CLIENTES
// IMPORTANTE: precisa ficar antes das rotas /:id
// ======================================================

router.post("/importar", async (req, res) => {
  try {
    const { clientes } = req.body;

    if (!Array.isArray(clientes) || clientes.length === 0) {
      return res.status(400).json({
        erro: "Envie uma lista de clientes"
      });
    }

    let inseridos = 0;
    let atualizados = 0;
    let ignorados = 0;
    const erros = [];

    for (const item of clientes) {
      try {
        const dados = montarDadosCliente(item);

        if (!dados.nome_completo) {
          ignorados++;

          erros.push({
            id_cliente: dados.id_cliente,
            nome: null,
            erro: "Nome completo não informado"
          });

          continue;
        }

        // Se houver ID legado, ele é a prioridade para localizar o cadastro.
        let existente = null;

        if (dados.id_cliente) {
          const buscaId = await db.query(
            `
              SELECT id
              FROM clientes
              WHERE id_cliente = $1
              LIMIT 1
            `,
            [dados.id_cliente]
          );

          existente = buscaId.rows[0] || null;
        }

        // Fallback por CPF.
        if (!existente && dados.cpf) {
          const buscaCpf = await db.query(
            `
              SELECT id
              FROM clientes
              WHERE cpf = $1
              LIMIT 1
            `,
            [dados.cpf]
          );

          existente = buscaCpf.rows[0] || null;
        }

        // Fallback por CNPJ.
        if (!existente && dados.cnpj) {
          const buscaCnpj = await db.query(
            `
              SELECT id
              FROM clientes
              WHERE cnpj = $1
              LIMIT 1
            `,
            [dados.cnpj]
          );

          existente = buscaCnpj.rows[0] || null;
        }

        if (existente) {
          await atualizarClienteNoBanco({
            id: existente.id,
            dados,
            usuarioId: req.usuario.id
          });

          atualizados++;
          continue;
        }

        await inserirClienteNoBanco({
          dados,
          usuarioId: req.usuario.id
        });

        inseridos++;

      } catch (erroCliente) {
        erros.push({
          id_cliente:
            item.id_cliente ??
            item.ID_CLIENTE ??
            null,
          nome:
            item.nome_completo ??
            item.NOME_COMPLETO ??
            item.nome ??
            "Sem nome",
          erro: erroCliente.message
        });
      }
    }

    res.json({
      mensagem: "Importação concluída",
      total_recebidos: clientes.length,
      inseridos,
      atualizados,
      ignorados,
      erros
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao importar clientes"
    });
  }
});


// ======================================================
// CADASTRAR CLIENTE
// ======================================================

router.post("/", async (req, res) => {
  try {
    const dados = montarDadosCliente(req.body);

    if (!dados.nome_completo) {
      return res.status(400).json({
        erro: "O nome completo do cliente é obrigatório"
      });
    }

    const duplicidade = await verificarDuplicidade({
      cpf: dados.cpf,
      cnpj: dados.cnpj
    });

    if (duplicidade) {
      return res.status(409).json({
        erro: `Já existe um cliente cadastrado com este ${duplicidade}`
      });
    }

    if (dados.id_cliente) {
      const idExistente = await db.query(
        `
          SELECT id
          FROM clientes
          WHERE id_cliente = $1
          LIMIT 1
        `,
        [dados.id_cliente]
      );

      if (idExistente.rows.length > 0) {
        return res.status(409).json({
          erro: "Já existe um cliente cadastrado com este ID_CLIENTE"
        });
      }
    }

    const cliente = await inserirClienteNoBanco({
      dados,
      usuarioId: req.usuario.id
    });

    res.status(201).json({
      mensagem: "Cliente cadastrado com sucesso",
      cliente
    });
  } catch (erro) {
    console.error("ERRO POST /clientes:", erro);

    res.status(500).json({
      erro: "Erro ao cadastrar cliente",
      detalhe: erro && erro.message ? erro.message : null,
      codigo: erro && erro.code ? erro.code : null,
      constraint: erro && erro.constraint ? erro.constraint : null,
      coluna: erro && erro.column ? erro.column : null,
      tabela: erro && erro.table ? erro.table : null
    });
  }
});


// ======================================================
// BUSCAR CLIENTE POR ID INTERNO OU ID_CLIENTE
// ======================================================

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await db.query(
      `
        SELECT *
        FROM clientes
        WHERE
          id::text = $1
          OR id_cliente = $1
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

    const busca = await db.query(
      `
        SELECT id
        FROM clientes
        WHERE
          id::text = $1
          OR id_cliente = $1
        LIMIT 1
      `,
      [id]
    );

    if (busca.rows.length === 0) {
      return res.status(404).json({
        erro: "Cliente não encontrado"
      });
    }

    const idInterno = busca.rows[0].id;
    const dados = montarDadosCliente(req.body);

    if (!dados.nome_completo) {
      return res.status(400).json({
        erro: "O nome completo do cliente é obrigatório"
      });
    }

    const duplicidade = await verificarDuplicidade({
      cpf: dados.cpf,
      cnpj: dados.cnpj,
      idIgnorar: idInterno
    });

    if (duplicidade) {
      return res.status(409).json({
        erro: `Já existe outro cliente cadastrado com este ${duplicidade}`
      });
    }

    if (dados.id_cliente) {
      const idClienteExistente = await db.query(
        `
          SELECT id
          FROM clientes
          WHERE id_cliente = $1
            AND id <> $2
          LIMIT 1
        `,
        [dados.id_cliente, idInterno]
      );

      if (idClienteExistente.rows.length > 0) {
        return res.status(409).json({
          erro: "Já existe outro cliente com este ID_CLIENTE"
        });
      }
    }

    const cliente = await atualizarClienteNoBanco({
      id: idInterno,
      dados,
      usuarioId: req.usuario.id
    });

    res.json({
      mensagem: "Cliente atualizado com sucesso",
      cliente
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao atualizar cliente"
    });
  }
});


// ======================================================
// INATIVAR CLIENTE
// ======================================================

router.patch("/:id/inativar", async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await db.query(
      `
        UPDATE clientes
        SET
          status_cliente = 'INATIVO',
          ativo = FALSE,
          data_atualizacao = NOW(),
          atualizado_em = NOW()
        WHERE
          id::text = $1
          OR id_cliente = $1
        RETURNING
          id,
          id_cliente,
          nome_completo,
          status_cliente,
          ativo
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


// ======================================================
// ATIVAR CLIENTE
// ======================================================

router.patch("/:id/ativar", async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await db.query(
      `
        UPDATE clientes
        SET
          status_cliente = 'ATIVO',
          ativo = TRUE,
          data_atualizacao = NOW(),
          atualizado_em = NOW()
        WHERE
          id::text = $1
          OR id_cliente = $1
        RETURNING
          id,
          id_cliente,
          nome_completo,
          status_cliente,
          ativo
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


// ======================================================
// COMPATIBILIDADE COM DELETE ANTIGO
// NÃO APAGA FISICAMENTE: APENAS INATIVA
// ======================================================

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const resultado = await db.query(
      `
        UPDATE clientes
        SET
          status_cliente = 'INATIVO',
          ativo = FALSE,
          data_atualizacao = NOW(),
          atualizado_em = NOW()
        WHERE
          id::text = $1
          OR id_cliente = $1
        RETURNING
          id,
          id_cliente,
          nome_completo,
          status_cliente,
          ativo
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


// ======================================================
// FUNÇÕES DE BANCO
// ======================================================

async function inserirClienteNoBanco({ dados, usuarioId }) {
  const resultado = await db.query(
    `
      INSERT INTO clientes
      (
        id_cliente,
        nome_completo,
        foto_id,
        foto_url,
        cpf,
        cnpj,
        data_nascimento,
        telefone,
        whatsapp,
        email,
        cargo,
        empresa,
        razao_social,
        nome_fantasia,
        segmento,
        porte_empresa,
        num_funcionarios,
        cidade,
        estado,
        site,
        instagram,
        origem_lead,
        data_entrada,
        responsavel,
        produto_servico,
        valor_contrato,
        forma_pagamento,
        status_comercial,
        status_cliente,
        etapa_jornada,
        mentor_consultor,
        objetivo_principal,
        meta_principal,
        data_inicio,
        data_previsao_conclusao,
        health_score,
        ultima_interacao,
        proxima_sessao,
        data_cadastro,
        data_atualizacao,
        usuario_cadastro,
        usuario_atualizacao,
        ativo,
        observacoes,
        cep,
        endereco,
        criado_por
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
        $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
        $41,$42,$43,$44,$45,$46,$47
      )
      RETURNING *
    `,
    [
      dados.id_cliente,
      dados.nome_completo,
      dados.foto_id,
      dados.foto_url,
      dados.cpf,
      dados.cnpj,
      dados.data_nascimento,
      dados.telefone,
      dados.whatsapp,
      dados.email,
      dados.cargo,
      dados.empresa,
      dados.razao_social,
      dados.nome_fantasia,
      dados.segmento,
      dados.porte_empresa,
      dados.num_funcionarios,
      dados.cidade,
      dados.estado,
      dados.site,
      dados.instagram,
      dados.origem_lead,
      dados.data_entrada,
      dados.responsavel,
      dados.produto_servico,
      dados.valor_contrato,
      dados.forma_pagamento,
      dados.status_comercial,
      dados.status_cliente,
      dados.etapa_jornada,
      dados.mentor_consultor,
      dados.objetivo_principal,
      dados.meta_principal,
      dados.data_inicio,
      dados.data_previsao_conclusao,
      dados.health_score,
      dados.ultima_interacao,
      dados.proxima_sessao,
      dados.data_cadastro || new Date(),
      dados.data_atualizacao || new Date(),
      dados.usuario_cadastro,
      dados.usuario_atualizacao,
      dados.ativo,
      dados.observacoes,
      dados.cep,
      dados.endereco,
      usuarioId
    ]
  );

  let cliente = resultado.rows[0];

  // Se o registro veio sem ID_CLIENTE, cria no padrão CLI_000001
  // usando o ID interno do PostgreSQL.
  if (!cliente.id_cliente) {
    const idCliente = `CLI_${String(cliente.id).padStart(6, "0")}`;

    const atualizado = await db.query(
      `
        UPDATE clientes
        SET id_cliente = $1
        WHERE id = $2
        RETURNING *
      `,
      [idCliente, cliente.id]
    );

    cliente = atualizado.rows[0];
  }

  return cliente;
}

async function atualizarClienteNoBanco({ id, dados, usuarioId }) {
  const resultado = await db.query(
    `
      UPDATE clientes
      SET
        id_cliente = COALESCE($1, id_cliente),
        nome_completo = $2,
        foto_id = $3,
        foto_url = $4,
        cpf = $5,
        cnpj = $6,
        data_nascimento = $7,
        telefone = $8,
        whatsapp = $9,
        email = $10,
        cargo = $11,
        empresa = $12,
        razao_social = $13,
        nome_fantasia = $14,
        segmento = $15,
        porte_empresa = $16,
        num_funcionarios = $17,
        cidade = $18,
        estado = $19,
        site = $20,
        instagram = $21,
        origem_lead = $22,
        data_entrada = $23,
        responsavel = $24,
        produto_servico = $25,
        valor_contrato = $26,
        forma_pagamento = $27,
        status_comercial = $28,
        status_cliente = $29,
        etapa_jornada = $30,
        mentor_consultor = $31,
        objetivo_principal = $32,
        meta_principal = $33,
        data_inicio = $34,
        data_previsao_conclusao = $35,
        health_score = $36,
        ultima_interacao = $37,
        proxima_sessao = $38,
        data_atualizacao = COALESCE($39, NOW()),
        usuario_atualizacao = COALESCE($40, usuario_atualizacao),
        ativo = $41,
        observacoes = $42,
        cep = $43,
        endereco = $44,
        atualizado_em = NOW()
      WHERE id = $45
      RETURNING *
    `,
    [
      dados.id_cliente,
      dados.nome_completo,
      dados.foto_id,
      dados.foto_url,
      dados.cpf,
      dados.cnpj,
      dados.data_nascimento,
      dados.telefone,
      dados.whatsapp,
      dados.email,
      dados.cargo,
      dados.empresa,
      dados.razao_social,
      dados.nome_fantasia,
      dados.segmento,
      dados.porte_empresa,
      dados.num_funcionarios,
      dados.cidade,
      dados.estado,
      dados.site,
      dados.instagram,
      dados.origem_lead,
      dados.data_entrada,
      dados.responsavel,
      dados.produto_servico,
      dados.valor_contrato,
      dados.forma_pagamento,
      dados.status_comercial,
      dados.status_cliente,
      dados.etapa_jornada,
      dados.mentor_consultor,
      dados.objetivo_principal,
      dados.meta_principal,
      dados.data_inicio,
      dados.data_previsao_conclusao,
      dados.health_score,
      dados.ultima_interacao,
      dados.proxima_sessao,
      dados.data_atualizacao,
      dados.usuario_atualizacao || `usuario:${usuarioId}`,
      dados.ativo,
      dados.observacoes,
      dados.cep,
      dados.endereco,
      id
    ]
  );

  return resultado.rows[0];
}


module.exports = router;
