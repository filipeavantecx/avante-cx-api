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

const booleanOuNull = v => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "boolean") return v;

  const t = String(v).trim().toLowerCase();

  if (["true","1","sim","s","ativo"].includes(t)) return true;
  if (["false","0","nao","não","n","inativo"].includes(t)) return false;

  return null;
};

function pegar(obj, campo) {
  return vazioNull(obj[campo] ?? obj[campo.toLowerCase()]);
}

function num(obj, campo) {
  return numeroNull(obj[campo] ?? obj[campo.toLowerCase()]);
}

function bool(obj, campo) {
  return booleanOuNull(obj[campo] ?? obj[campo.toLowerCase()]);
}

async function importarPorId({
  itens,
  tabela,
  idCampo,
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
        `SELECT id FROM ${tabela} WHERE ${idCampo}=$1 LIMIT 1`,
        [idLegado]
      );

      const existente = busca.rows[0] || null;

      if (existente) {
        const colunasUpdate = colunas.filter(c => c !== idCampo);
        const sets = colunasUpdate.map((c, i) => `${c}=$${i + 1}`);
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

        await db.query(
          `INSERT INTO ${tabela} (${colunas.join(",")})
           VALUES (${placeholders.join(",")})`,
          valores
        );

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

router.get("/funcionarios", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM funcionarios ORDER BY nome_completo ASC"
    );
    res.json({ total: r.rows.length, funcionarios: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar funcionários" });
  }
});

router.get("/agenda", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM agenda ORDER BY data DESC NULLS LAST, hora_inicio DESC NULLS LAST"
    );
    res.json({ total: r.rows.length, agenda: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar agenda" });
  }
});

router.get("/config-sistema", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM config_sistema ORDER BY parametro ASC"
    );
    res.json({ total: r.rows.length, config: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar configurações" });
  }
});

router.get("/clientes-historico", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM clientes_historico ORDER BY data_hora DESC NULLS LAST, id DESC"
    );
    res.json({ total: r.rows.length, historico: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar histórico" });
  }
});

router.get("/clientes-documentos", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM clientes_documentos ORDER BY data_upload DESC NULLS LAST, id DESC"
    );
    res.json({ total: r.rows.length, documentos: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar documentos" });
  }
});

router.get("/usuarios-legado", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT
        id, usuario_id, nome, email, login, perfil, status,
        id_funcionario, pode_dashboard, pode_clientes, pode_jornada,
        pode_financeiro, pode_produtos, pode_agenda, pode_funcionarios,
        pode_relatorios, pode_configuracoes, pode_usuarios,
        primeiro_acesso, data_cadastro, data_atualizacao,
        ultimo_acesso, usuario_cadastro, foto_id, foto_url
       FROM usuarios_legado
       ORDER BY nome ASC`
    );

    res.json({
      total: r.rows.length,
      usuarios_legado: r.rows
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar usuários legados" });
  }
});

router.get("/logs-sistema", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM logs_sistema ORDER BY data DESC NULLS LAST, hora DESC NULLS LAST"
    );
    res.json({ total: r.rows.length, logs: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar logs" });
  }
});

router.get("/listas-sistema", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT * FROM listas_sistema ORDER BY id ASC"
    );
    res.json({ total: r.rows.length, listas: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao listar listas" });
  }
});


// ======================================================
// IMPORTAR FUNCIONÁRIOS
// ======================================================

router.post("/funcionarios/importar", async (req, res) => {
  const itens = req.body.funcionarios;

  if (!Array.isArray(itens)) {
    return res.status(400).json({ erro: "Envie funcionarios como array" });
  }

  const resultado = await importarPorId({
    itens,
    tabela: "funcionarios",
    idCampo: "funcionario_id",
    colunas: [
      "funcionario_id","nome_completo","cpf","data_nascimento","telefone",
      "whatsapp","email","cargo","setor","data_admissao","tipo_contrato",
      "salario","gestor","status","foto_url","usuario_sistema",
      "data_cadastro","data_atualizacao","observacoes","foto_data_url"
    ],
    mapear: x => ({
      funcionario_id: pegar(x,"FUNCIONARIO_ID"),
      nome_completo: pegar(x,"NOME_COMPLETO"),
      cpf: pegar(x,"CPF"),
      data_nascimento: pegar(x,"DATA_NASCIMENTO"),
      telefone: pegar(x,"TELEFONE"),
      whatsapp: pegar(x,"WHATSAPP"),
      email: pegar(x,"EMAIL"),
      cargo: pegar(x,"CARGO"),
      setor: pegar(x,"SETOR"),
      data_admissao: pegar(x,"DATA_ADMISSAO"),
      tipo_contrato: pegar(x,"TIPO_CONTRATO"),
      salario: num(x,"SALARIO"),
      gestor: pegar(x,"GESTOR"),
      status: pegar(x,"STATUS"),
      foto_url: pegar(x,"FOTO_URL"),
      usuario_sistema: pegar(x,"USUARIO_SISTEMA"),
      data_cadastro: pegar(x,"DATA_CADASTRO"),
      data_atualizacao: pegar(x,"DATA_ATUALIZACAO"),
      observacoes: pegar(x,"OBSERVACOES"),
      foto_data_url: pegar(x,"FOTO_DATA_URL")
    })
  });

  res.json({ modulo: "FUNCIONARIOS", ...resultado });
});


// ======================================================
// IMPORTAR AGENDA
// ======================================================

router.post("/agenda/importar", async (req, res) => {
  const itens = req.body.agenda;

  if (!Array.isArray(itens)) {
    return res.status(400).json({ erro: "Envie agenda como array" });
  }

  const resultado = await importarPorId({
    itens,
    tabela: "agenda",
    idCampo: "agenda_id",
    colunas: [
      "agenda_id","google_event_id","calendar_id","titulo","tipo_evento",
      "id_cliente","id_funcionario","id_sessao","data","hora_inicio",
      "hora_fim","local","descricao","convidados","status",
      "data_cadastro","data_atualizacao","usuario_cadastro"
    ],
    mapear: x => ({
      agenda_id: pegar(x,"AGENDA_ID"),
      google_event_id: pegar(x,"GOOGLE_EVENT_ID"),
      calendar_id: pegar(x,"CALENDAR_ID"),
      titulo: pegar(x,"TITULO"),
      tipo_evento: pegar(x,"TIPO_EVENTO"),
      id_cliente: pegar(x,"ID_CLIENTE"),
      id_funcionario: pegar(x,"ID_FUNCIONARIO"),
      id_sessao: pegar(x,"ID_SESSAO"),
      data: pegar(x,"DATA"),
      hora_inicio: pegar(x,"HORA_INICIO"),
      hora_fim: pegar(x,"HORA_FIM"),
      local: pegar(x,"LOCAL"),
      descricao: pegar(x,"DESCRICAO"),
      convidados: pegar(x,"CONVIDADOS"),
      status: pegar(x,"STATUS"),
      data_cadastro: pegar(x,"DATA_CADASTRO"),
      data_atualizacao: pegar(x,"DATA_ATUALIZACAO"),
      usuario_cadastro: pegar(x,"USUARIO_CADASTRO")
    })
  });

  res.json({ modulo: "AGENDA", ...resultado });
});


// ======================================================
// IMPORTAR CONFIG
// ======================================================

router.post("/config-sistema/importar", async (req, res) => {
  const itens = req.body.config;

  if (!Array.isArray(itens)) {
    return res.status(400).json({ erro: "Envie config como array" });
  }

  const resultado = await importarPorId({
    itens,
    tabela: "config_sistema",
    idCampo: "config_id",
    colunas: [
      "config_id","parametro","valor","tipo","descricao","ativo"
    ],
    mapear: x => ({
      config_id: pegar(x,"CONFIG_ID"),
      parametro: pegar(x,"PARAMETRO"),
      valor: pegar(x,"VALOR"),
      tipo: pegar(x,"TIPO"),
      descricao: pegar(x,"DESCRICAO"),
      ativo: bool(x,"ATIVO")
    })
  });

  res.json({ modulo: "CONFIG", ...resultado });
});


// ======================================================
// IMPORTAR HISTÓRICO
// ======================================================

router.post("/clientes-historico/importar", async (req, res) => {
  const itens = req.body.historico;

  if (!Array.isArray(itens)) {
    return res.status(400).json({ erro: "Envie historico como array" });
  }

  const resultado = await importarPorId({
    itens,
    tabela: "clientes_historico",
    idCampo: "id_historico",
    colunas: [
      "id_historico","id_cliente","data_hora","tipo_acao","descricao",
      "modulo","usuario","dados_anteriores","dados_novos"
    ],
    mapear: x => ({
      id_historico: pegar(x,"ID_HISTORICO"),
      id_cliente: pegar(x,"ID_CLIENTE"),
      data_hora: pegar(x,"DATA_HORA"),
      tipo_acao: pegar(x,"TIPO_ACAO"),
      descricao: pegar(x,"DESCRICAO"),
      modulo: pegar(x,"MODULO"),
      usuario: pegar(x,"USUARIO"),
      dados_anteriores: pegar(x,"DADOS_ANTERIORES"),
      dados_novos: pegar(x,"DADOS_NOVOS")
    })
  });

  res.json({ modulo: "CLIENTES_HISTORICO", ...resultado });
});


// ======================================================
// IMPORTAR DOCUMENTOS
// ======================================================

router.post("/clientes-documentos/importar", async (req, res) => {
  const itens = req.body.documentos;

  if (!Array.isArray(itens)) {
    return res.status(400).json({ erro: "Envie documentos como array" });
  }

  const resultado = await importarPorId({
    itens,
    tabela: "clientes_documentos",
    idCampo: "id_documento",
    colunas: [
      "id_documento","id_cliente","nome_documento","categoria","descricao",
      "url_arquivo","id_arquivo","data_documento","data_upload",
      "usuario_upload","status","observacoes"
    ],
    mapear: x => ({
      id_documento: pegar(x,"ID_DOCUMENTO"),
      id_cliente: pegar(x,"ID_CLIENTE"),
      nome_documento: pegar(x,"NOME_DOCUMENTO"),
      categoria: pegar(x,"CATEGORIA"),
      descricao: pegar(x,"DESCRICAO"),
      url_arquivo: pegar(x,"URL_ARQUIVO"),
      id_arquivo: pegar(x,"ID_ARQUIVO"),
      data_documento: pegar(x,"DATA_DOCUMENTO"),
      data_upload: pegar(x,"DATA_UPLOAD"),
      usuario_upload: pegar(x,"USUARIO_UPLOAD"),
      status: pegar(x,"STATUS"),
      observacoes: pegar(x,"OBSERVACOES")
    })
  });

  res.json({ modulo: "CLIENTES_DOCUMENTOS", ...resultado });
});


// ======================================================
// IMPORTAR USUÁRIOS LEGADOS
// ======================================================

router.post("/usuarios-legado/importar", async (req, res) => {
  const itens = req.body.usuarios_legado;

  if (!Array.isArray(itens)) {
    return res.status(400).json({ erro: "Envie usuarios_legado como array" });
  }

  const resultado = await importarPorId({
    itens,
    tabela: "usuarios_legado",
    idCampo: "usuario_id",
    colunas: [
      "usuario_id","nome","email","login","senha_hash","senha_salt",
      "perfil","status","id_funcionario","pode_dashboard","pode_clientes",
      "pode_jornada","pode_financeiro","pode_produtos","pode_agenda",
      "pode_funcionarios","pode_relatorios","pode_configuracoes",
      "pode_usuarios","primeiro_acesso","codigo_recuperacao_hash",
      "recuperacao_expira_em","ultima_troca_senha","data_cadastro",
      "data_atualizacao","ultimo_acesso","usuario_cadastro","foto_id","foto_url"
    ],
    mapear: x => ({
      usuario_id: pegar(x,"USUARIO_ID"),
      nome: pegar(x,"NOME"),
      email: pegar(x,"EMAIL"),
      login: pegar(x,"LOGIN"),
      senha_hash: pegar(x,"SENHA_HASH"),
      senha_salt: pegar(x,"SENHA_SALT"),
      perfil: pegar(x,"PERFIL"),
      status: pegar(x,"STATUS"),
      id_funcionario: pegar(x,"ID_FUNCIONARIO"),
      pode_dashboard: bool(x,"PODE_DASHBOARD"),
      pode_clientes: bool(x,"PODE_CLIENTES"),
      pode_jornada: bool(x,"PODE_JORNADA"),
      pode_financeiro: bool(x,"PODE_FINANCEIRO"),
      pode_produtos: bool(x,"PODE_PRODUTOS"),
      pode_agenda: bool(x,"PODE_AGENDA"),
      pode_funcionarios: bool(x,"PODE_FUNCIONARIOS"),
      pode_relatorios: bool(x,"PODE_RELATORIOS"),
      pode_configuracoes: bool(x,"PODE_CONFIGURACOES"),
      pode_usuarios: bool(x,"PODE_USUARIOS"),
      primeiro_acesso: bool(x,"PRIMEIRO_ACESSO"),
      codigo_recuperacao_hash: pegar(x,"CODIGO_RECUPERACAO_HASH"),
      recuperacao_expira_em: pegar(x,"RECUPERACAO_EXPIRA_EM"),
      ultima_troca_senha: pegar(x,"ULTIMA_TROCA_SENHA"),
      data_cadastro: pegar(x,"DATA_CADASTRO"),
      data_atualizacao: pegar(x,"DATA_ATUALIZACAO"),
      ultimo_acesso: pegar(x,"ULTIMO_ACESSO"),
      usuario_cadastro: pegar(x,"USUARIO_CADASTRO"),
      foto_id: pegar(x,"FOTO_ID"),
      foto_url: pegar(x,"FOTO_URL")
    })
  });

  res.json({ modulo: "USUARIOS_LEGADO", ...resultado });
});


// ======================================================
// USUÁRIOS LEGADO - RUNTIME API / POSTGRESQL
// ======================================================

const CAMPOS_USUARIO_LEGADO_RUNTIME = [
  "nome","email","login","senha_hash","senha_salt",
  "perfil","status","id_funcionario","pode_dashboard","pode_clientes",
  "pode_jornada","pode_financeiro","pode_produtos","pode_agenda",
  "pode_funcionarios","pode_relatorios","pode_configuracoes",
  "pode_usuarios","primeiro_acesso","codigo_recuperacao_hash",
  "recuperacao_expira_em","ultima_troca_senha","data_cadastro",
  "data_atualizacao","ultimo_acesso","usuario_cadastro","foto_id","foto_url"
];

function mapearUsuarioLegadoRuntime(x = {}) {
  return {
    nome: pegar(x,"NOME"),
    email: pegar(x,"EMAIL"),
    login: pegar(x,"LOGIN"),
    senha_hash: pegar(x,"SENHA_HASH"),
    senha_salt: pegar(x,"SENHA_SALT"),
    perfil: pegar(x,"PERFIL"),
    status: pegar(x,"STATUS"),
    id_funcionario: pegar(x,"ID_FUNCIONARIO"),
    pode_dashboard: bool(x,"PODE_DASHBOARD"),
    pode_clientes: bool(x,"PODE_CLIENTES"),
    pode_jornada: bool(x,"PODE_JORNADA"),
    pode_financeiro: bool(x,"PODE_FINANCEIRO"),
    pode_produtos: bool(x,"PODE_PRODUTOS"),
    pode_agenda: bool(x,"PODE_AGENDA"),
    pode_funcionarios: bool(x,"PODE_FUNCIONARIOS"),
    pode_relatorios: bool(x,"PODE_RELATORIOS"),
    pode_configuracoes: bool(x,"PODE_CONFIGURACOES"),
    pode_usuarios: bool(x,"PODE_USUARIOS"),
    primeiro_acesso: bool(x,"PRIMEIRO_ACESSO"),
    codigo_recuperacao_hash: pegar(x,"CODIGO_RECUPERACAO_HASH"),
    recuperacao_expira_em: pegar(x,"RECUPERACAO_EXPIRA_EM"),
    ultima_troca_senha: pegar(x,"ULTIMA_TROCA_SENHA"),
    data_cadastro: pegar(x,"DATA_CADASTRO"),
    data_atualizacao: pegar(x,"DATA_ATUALIZACAO"),
    ultimo_acesso: pegar(x,"ULTIMO_ACESSO"),
    usuario_cadastro: pegar(x,"USUARIO_CADASTRO"),
    foto_id: pegar(x,"FOTO_ID"),
    foto_url: pegar(x,"FOTO_URL")
  };
}

function normalizarUsuarioRuntime(row) {
  return row || null;
}

router.get("/usuarios-legado/auth/buscar", async (req, res) => {
  try {
    const identificador = String(req.query.identificador || "").trim().toLowerCase();

    if (!identificador) {
      return res.status(400).json({ erro: "identificador é obrigatório" });
    }

    const r = await db.query(
      `SELECT *
       FROM usuarios_legado
       WHERE LOWER(COALESCE(email,''))=$1
          OR LOWER(COALESCE(login,''))=$1
       LIMIT 1`,
      [identificador]
    );

    if (!r.rows.length) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    res.json({ usuario: normalizarUsuarioRuntime(r.rows[0]) });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao buscar usuário para autenticação" });
  }
});

router.get("/usuarios-legado/:usuarioId", async (req, res) => {
  try {
    const usuarioId = String(req.params.usuarioId || "").trim();

    const r = await db.query(
      `SELECT *
       FROM usuarios_legado
       WHERE usuario_id=$1
       LIMIT 1`,
      [usuarioId]
    );

    if (!r.rows.length) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    res.json({ usuario: normalizarUsuarioRuntime(r.rows[0]) });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao buscar usuário" });
  }
});

router.post("/usuarios-legado", async (req, res) => {
  try {
    const dados = mapearUsuarioLegadoRuntime(req.body || {});

    if (!dados.nome || !dados.email || !dados.login) {
      return res.status(400).json({
        erro: "NOME, EMAIL e LOGIN são obrigatórios"
      });
    }

    const duplicado = await db.query(
      `SELECT usuario_id
       FROM usuarios_legado
       WHERE LOWER(COALESCE(email,''))=LOWER($1)
          OR LOWER(COALESCE(login,''))=LOWER($2)
       LIMIT 1`,
      [dados.email, dados.login]
    );

    if (duplicado.rows.length) {
      return res.status(409).json({
        erro: "Já existe usuário com este e-mail ou login"
      });
    }

    const colunas = CAMPOS_USUARIO_LEGADO_RUNTIME;
    const valores = colunas.map(c => dados[c]);
    const placeholders = valores.map((_, i) => `$${i + 1}`);

    const sql = `
      WITH trava AS (
        SELECT pg_advisory_xact_lock(hashtext('avante_usuarios_legado_id'))
      ),
      proximo AS (
        SELECT
          'USR' ||
          LPAD(
            (
              COALESCE(
                MAX(
                  CASE
                    WHEN usuario_id ~ '^USR[0-9]+$'
                    THEN SUBSTRING(usuario_id FROM 4)::int
                    ELSE NULL
                  END
                ),
                0
              ) + 1
            )::text,
            6,
            '0'
          ) AS usuario_id
        FROM usuarios_legado, trava
      )
      INSERT INTO usuarios_legado
      (usuario_id, ${colunas.join(",")})
      SELECT proximo.usuario_id, ${placeholders.join(",")}
      FROM proximo
      RETURNING *
    `;

    const r = await db.query(sql, valores);

    res.status(201).json({
      sucesso: true,
      usuario: normalizarUsuarioRuntime(r.rows[0])
    });

  } catch (e) {
    console.error(e);

    if (e && e.code === "23505") {
      return res.status(409).json({
        erro: "Já existe usuário com este e-mail ou login"
      });
    }

    res.status(500).json({ erro: "Erro ao criar usuário" });
  }
});

async function atualizarUsuarioLegadoRuntime(req, res) {
  try {
    const usuarioId = String(req.params.usuarioId || "").trim();

    if (!usuarioId) {
      return res.status(400).json({ erro: "usuarioId é obrigatório" });
    }

    const atual = await db.query(
      `SELECT *
       FROM usuarios_legado
       WHERE usuario_id=$1
       LIMIT 1`,
      [usuarioId]
    );

    if (!atual.rows.length) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    const dados = mapearUsuarioLegadoRuntime(req.body || {});
    const sets = [];
    const valores = [];

    CAMPOS_USUARIO_LEGADO_RUNTIME.forEach(campo => {
      const entradaDireta =
        Object.prototype.hasOwnProperty.call(req.body || {}, campo) ||
        Object.prototype.hasOwnProperty.call(req.body || {}, campo.toUpperCase());

      if (!entradaDireta) return;

      valores.push(dados[campo]);
      sets.push(`${campo}=$${valores.length}`);
    });

    if (!sets.length) {
      return res.json({
        sucesso: true,
        usuario: normalizarUsuarioRuntime(atual.rows[0]),
        alterado: false
      });
    }

    sets.push("data_atualizacao=NOW()");
    valores.push(usuarioId);

    const r = await db.query(
      `UPDATE usuarios_legado
       SET ${sets.join(", ")}
       WHERE usuario_id=$${valores.length}
       RETURNING *`,
      valores
    );

    res.json({
      sucesso: true,
      usuario: normalizarUsuarioRuntime(r.rows[0]),
      alterado: true
    });

  } catch (e) {
    console.error(e);

    if (e && e.code === "23505") {
      return res.status(409).json({
        erro: "E-mail ou login já utilizado por outro usuário"
      });
    }

    res.status(500).json({ erro: "Erro ao atualizar usuário" });
  }
}

router.put("/usuarios-legado/:usuarioId", atualizarUsuarioLegadoRuntime);
router.patch("/usuarios-legado/:usuarioId", atualizarUsuarioLegadoRuntime);


router.delete("/usuarios-legado/:usuarioId", async (req, res) => {
  try {
    const usuarioId = String(req.params.usuarioId || "").trim();

    if (!usuarioId) {
      return res.status(400).json({ erro: "usuarioId é obrigatório" });
    }

    const r = await db.query(
      `DELETE FROM usuarios_legado
       WHERE usuario_id=$1
       RETURNING usuario_id`,
      [usuarioId]
    );

    if (!r.rows.length) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    res.json({
      sucesso: true,
      excluido: true,
      usuario_id: r.rows[0].usuario_id
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao excluir usuário" });
  }
});


// ======================================================
// IMPORTAR LOGS
// ======================================================

router.post("/logs-sistema/importar", async (req, res) => {
  const itens = req.body.logs;

  if (!Array.isArray(itens)) {
    return res.status(400).json({ erro: "Envie logs como array" });
  }

  const resultado = await importarPorId({
    itens,
    tabela: "logs_sistema",
    idCampo: "log_id",
    colunas: [
      "log_id","data","hora","usuario","acao","modulo",
      "registro_id","descricao","ip"
    ],
    mapear: x => ({
      log_id: pegar(x,"LOG_ID"),
      data: pegar(x,"DATA"),
      hora: pegar(x,"HORA"),
      usuario: pegar(x,"USUARIO"),
      acao: pegar(x,"ACAO"),
      modulo: pegar(x,"MODULO"),
      registro_id: pegar(x,"REGISTRO_ID"),
      descricao: pegar(x,"DESCRICAO"),
      ip: pegar(x,"IP")
    })
  });

  res.json({ modulo: "LOGS", ...resultado });
});


// ======================================================
// IMPORTAR LISTAS
// LISTAS não possui ID próprio: substitui o conteúdo em cada importação.
// ======================================================

router.post("/listas-sistema/importar", async (req, res) => {
  try {
    const itens = req.body.listas;

    if (!Array.isArray(itens)) {
      return res.status(400).json({ erro: "Envie listas como array" });
    }

    await db.query("DELETE FROM listas_sistema");

    let inseridos = 0;
    const erros = [];

    for (const x of itens) {
      try {
        await db.query(
          `INSERT INTO listas_sistema
           (
             status_cliente,temperatura,etapa_comercial,etapa_jornada,
             status_pagamento,forma_pagamento,status_sessao,presenca,
             prioridade,status_atividade,perfil_usuario,status_geral,
             tipo_movimento,canal
           )
           VALUES
           ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            pegar(x,"STATUS_CLIENTE"),
            pegar(x,"TEMPERATURA"),
            pegar(x,"ETAPA_COMERCIAL"),
            pegar(x,"ETAPA_JORNADA"),
            pegar(x,"STATUS_PAGAMENTO"),
            pegar(x,"FORMA_PAGAMENTO"),
            pegar(x,"STATUS_SESSAO"),
            pegar(x,"PRESENCA"),
            pegar(x,"PRIORIDADE"),
            pegar(x,"STATUS_ATIVIDADE"),
            pegar(x,"PERFIL_USUARIO"),
            pegar(x,"STATUS_GERAL"),
            pegar(x,"TIPO_MOVIMENTO"),
            pegar(x,"CANAL")
          ]
        );

        inseridos++;
      } catch (e) {
        erros.push({ erro: e.message });
      }
    }

    res.json({
      modulo: "LISTAS",
      total_recebidos: itens.length,
      inseridos,
      atualizados: 0,
      ignorados: 0,
      erros
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao importar listas" });
  }
});


// ======================================================
// RESUMO ADMINISTRATIVO
// ======================================================

router.get("/administrativo/resumo-migracao", async (req, res) => {
  try {
    const tabelas = [
      "funcionarios",
      "agenda",
      "config_sistema",
      "clientes_historico",
      "clientes_documentos",
      "usuarios_legado",
      "logs_sistema",
      "listas_sistema"
    ];

    const resumo = {};

    for (const tabela of tabelas) {
      const r = await db.query(
        `SELECT COUNT(*)::int AS total FROM ${tabela}`
      );

      resumo[tabela] = r.rows[0].total;
    }

    res.json({ administrativo: resumo });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao gerar resumo administrativo" });
  }
});

module.exports = router;
