const verificarToken = require("../middleware/auth");
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../database/db");

const router = express.Router();

/* ============================================================
   AVANTE CX - AUTH
   1) /login e /me = autenticação técnica/legada já existente
   2) /crm-login e /crm-me = autenticação do AVANTE CX (usuarios_legado)

   IMPORTANTE:
   - O token CRM usa segredo separado, derivado de JWT_SECRET (ou CRM_JWT_SECRET, se definido).
   - AVANTE_AUTH_SECRET_V1 deve receber exatamente o mesmo segredo
     da Script Property AVANTE_AUTH_SECRET_V1 usada pelo Apps Script.
   ============================================================ */

const CRM_TOKEN_TTL = "6h";
const CRM_LOGIN_MAX_TENTATIVAS = 5;
const CRM_LOGIN_BLOQUEIO_MS = 15 * 60 * 1000;

const tentativasLoginCrm = new Map();

const PERFIS_AVANTE = {
  ADMINISTRADOR: { PODE_DASHBOARD:true, PODE_CLIENTES:true, PODE_JORNADA:true, PODE_FINANCEIRO:true, PODE_PRODUTOS:true, PODE_AGENDA:true, PODE_FUNCIONARIOS:true, PODE_RELATORIOS:true, PODE_CONFIGURACOES:true, PODE_USUARIOS:true },
  GESTOR: { PODE_DASHBOARD:true, PODE_CLIENTES:true, PODE_JORNADA:true, PODE_FINANCEIRO:true, PODE_PRODUTOS:true, PODE_AGENDA:true, PODE_FUNCIONARIOS:true, PODE_RELATORIOS:true, PODE_CONFIGURACOES:true, PODE_USUARIOS:false },
  MENTOR: { PODE_DASHBOARD:true, PODE_CLIENTES:true, PODE_JORNADA:true, PODE_FINANCEIRO:false, PODE_PRODUTOS:true, PODE_AGENDA:true, PODE_FUNCIONARIOS:false, PODE_RELATORIOS:false, PODE_CONFIGURACOES:false, PODE_USUARIOS:false },
  FINANCEIRO: { PODE_DASHBOARD:true, PODE_CLIENTES:false, PODE_JORNADA:false, PODE_FINANCEIRO:true, PODE_PRODUTOS:false, PODE_AGENDA:true, PODE_FUNCIONARIOS:false, PODE_RELATORIOS:true, PODE_CONFIGURACOES:false, PODE_USUARIOS:false },
  COLABORADOR: { PODE_DASHBOARD:true, PODE_CLIENTES:true, PODE_JORNADA:true, PODE_FINANCEIRO:false, PODE_PRODUTOS:false, PODE_AGENDA:true, PODE_FUNCIONARIOS:false, PODE_RELATORIOS:false, PODE_CONFIGURACOES:false, PODE_USUARIOS:false },
  VISUALIZADOR: { PODE_DASHBOARD:true, PODE_CLIENTES:true, PODE_JORNADA:false, PODE_FINANCEIRO:false, PODE_PRODUTOS:false, PODE_AGENDA:true, PODE_FUNCIONARIOS:false, PODE_RELATORIOS:true, PODE_CONFIGURACOES:false, PODE_USUARIOS:false },
  SEM_ACESSO: { PODE_DASHBOARD:false, PODE_CLIENTES:false, PODE_JORNADA:false, PODE_FINANCEIRO:false, PODE_PRODUTOS:false, PODE_AGENDA:false, PODE_FUNCIONARIOS:false, PODE_RELATORIOS:false, PODE_CONFIGURACOES:false, PODE_USUARIOS:false }
};

function boolSistema(valor) {
  if (valor === true || valor === 1) return true;
  const v = String(valor ?? "").trim().toUpperCase();
  return ["TRUE", "1", "SIM", "S", "YES", "Y"].includes(v);
}

function perfilSeguro(perfil) {
  const chave = String(perfil || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(PERFIS_AVANTE, chave) ? chave : "SEM_ACESSO";
}

function resolverPermissoes(usuario) {
  const perfil = perfilSeguro(usuario.perfil);
  if (perfil === "SEM_ACESSO") return { ...PERFIS_AVANTE.SEM_ACESSO };

  const permissoes = { ...PERFIS_AVANTE[perfil] };

  Object.keys(permissoes).forEach((campo) => {
    if (campo === "PODE_AGENDA") {
      permissoes[campo] = true;
      return;
    }
    const coluna = campo.toLowerCase();
    if (usuario[coluna] !== "" && usuario[coluna] !== null && usuario[coluna] !== undefined) {
      permissoes[campo] = boolSistema(usuario[coluna]);
    }
  });

  permissoes.PODE_AGENDA = true;
  return permissoes;
}

function resolverFotoUrl(usuario) {
  const fotoId = String(usuario.foto_id || "").trim();
  if (fotoId) {
    return "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fotoId) + "&sz=w300";
  }
  return String(usuario.foto_url || "").trim();
}

function montarUsuarioPublico(usuario) {
  return {
    id: usuario.usuario_id,
    nome: usuario.nome || usuario.login || "Usuário",
    email: usuario.email || "",
    fotoId: usuario.foto_id || "",
    fotoUrl: resolverFotoUrl(usuario),
    login: usuario.login || "",
    perfil: perfilSeguro(usuario.perfil),
    idFuncionario: usuario.id_funcionario || "",
    primeiroAcesso: boolSistema(usuario.primeiro_acesso),
    permissoes: resolverPermissoes(usuario)
  };
}

function hashSenhaLegada(senha, salt) {
  const segredo = String(process.env.AVANTE_AUTH_SECRET_V1 || "");
  if (!segredo) throw new Error("AVANTE_AUTH_SECRET_V1 não configurado no Railway");
  return crypto.createHmac("sha256", segredo)
    .update(`${String(salt || "")}|${String(senha || "")}`, "utf8")
    .digest("hex");
}

function segredoCrmJwt() {
  const dedicado = String(process.env.CRM_JWT_SECRET || "").trim();
  if (dedicado) return dedicado;

  const base = String(process.env.JWT_SECRET || "").trim();
  if (!base) throw new Error("JWT_SECRET não configurado no Railway");

  /*
   * Derivação por domínio: o token CRM NÃO valida no middleware
   * técnico que usa JWT_SECRET diretamente.
   */
  return crypto
    .createHmac("sha256", base)
    .update("AVANTE_CRM_WEB_V1", "utf8")
    .digest("hex");
}

function chaveRateLimit(req, identificador) {
  const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
  return `${ip}|${String(identificador || "").trim().toLowerCase()}`;
}

function verificarRateLimitCrm(chave) {
  const atual = tentativasLoginCrm.get(chave);
  if (!atual) return;
  if (atual.bloqueadoAte && atual.bloqueadoAte > Date.now()) {
    const erro = new Error("Muitas tentativas de login. Aguarde alguns minutos e tente novamente.");
    erro.statusCode = 429;
    throw erro;
  }
  if (atual.bloqueadoAte && atual.bloqueadoAte <= Date.now()) tentativasLoginCrm.delete(chave);
}

function registrarFalhaCrm(chave) {
  const atual = tentativasLoginCrm.get(chave) || { tentativas: 0, bloqueadoAte: 0 };
  atual.tentativas += 1;
  if (atual.tentativas >= CRM_LOGIN_MAX_TENTATIVAS) atual.bloqueadoAte = Date.now() + CRM_LOGIN_BLOQUEIO_MS;
  tentativasLoginCrm.set(chave, atual);
}

function limparFalhasCrm(chave) {
  tentativasLoginCrm.delete(chave);
}

function verificarTokenCrm(req, res, next) {
  try {
    const cabecalho = String(req.headers.authorization || "");
    const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7).trim() : "";
    if (!token) return res.status(401).json({ autenticado:false, erro:"Sessão não informada" });

    const payload = jwt.verify(token, segredoCrmJwt(), {
      issuer: "avante-cx",
      audience: "avante-cx-web"
    });

    if (payload.tipo !== "crm") return res.status(401).json({ autenticado:false, erro:"Sessão inválida" });
    req.usuarioCrm = payload;
    next();
  } catch (erro) {
    return res.status(401).json({ autenticado:false, expirada:erro?.name === "TokenExpiredError", erro:"Sessão inválida ou expirada" });
  }
}

router.get("/crm-auth-status", async (req, res) => {
  try {
    const banco = await db.query(`SELECT COUNT(*)::int AS total FROM usuarios_legado`);
    res.json({
      sucesso:true,
      authCrm:"pronto",
      banco:"conectado",
      usuariosLegado:banco.rows[0]?.total || 0,
      segredoSenhaConfigurado:!!process.env.AVANTE_AUTH_SECRET_V1,
      segredoJwtConfigurado:!!(process.env.CRM_JWT_SECRET || process.env.JWT_SECRET)
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ sucesso:false, erro:"Falha ao validar autenticação CRM" });
  }
});

router.post("/crm-login", async (req, res) => {
  try {
    const identificador = String(req.body?.identificador || req.body?.login || req.body?.email || "").trim();
    const senha = String(req.body?.senha || "");

    if (!identificador || !senha) return res.status(400).json({ erro:"Informe login e senha." });

    const chaveRate = chaveRateLimit(req, identificador);
    verificarRateLimitCrm(chaveRate);

    const resultado = await db.query(`
      SELECT *
      FROM usuarios_legado
      WHERE LOWER(COALESCE(login, '')) = LOWER($1)
         OR LOWER(COALESCE(email, '')) = LOWER($1)
      LIMIT 1
    `, [identificador]);

    if (!resultado.rows.length) {
      registrarFalhaCrm(chaveRate);
      return res.status(401).json({ erro:"Login ou senha inválidos." });
    }

    const usuario = resultado.rows[0];

    if (String(usuario.status || "").trim().toUpperCase() !== "ATIVO") {
      registrarFalhaCrm(chaveRate);
      return res.status(401).json({ erro:"Login ou senha inválidos." });
    }

    if (!usuario.senha_hash || !usuario.senha_salt) {
      registrarFalhaCrm(chaveRate);
      return res.status(401).json({ erro:"Login ou senha inválidos." });
    }

    const hashInformado = hashSenhaLegada(senha, usuario.senha_salt);
    const hashSalvo = String(usuario.senha_hash || "");
    const a = Buffer.from(hashInformado, "utf8");
    const b = Buffer.from(hashSalvo, "utf8");
    const senhaCorreta = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!senhaCorreta) {
      registrarFalhaCrm(chaveRate);
      return res.status(401).json({ erro:"Login ou senha inválidos." });
    }

    limparFalhasCrm(chaveRate);

    const usuarioPublico = montarUsuarioPublico(usuario);
    const token = jwt.sign({
      tipo:"crm",
      id:usuario.usuario_id,
      login:usuario.login || "",
      email:usuario.email || "",
      perfil:usuarioPublico.perfil
    }, segredoCrmJwt(), {
      expiresIn:CRM_TOKEN_TTL,
      issuer:"avante-cx",
      audience:"avante-cx-web"
    });

    db.query(`
      UPDATE usuarios_legado
      SET último_acesso = NOW(), data_atualizacao = NOW()
      WHERE usuario_id = $1
    `, [usuario.usuario_id]).catch((erro) => {
      console.warn("Não foi possível atualizar último_acesso:", erro?.message || erro);
    });

    res.json({
      sucesso:true,
      sessionToken:token,
      usuario:usuarioPublico,
      primeiroAcesso:usuarioPublico.primeiroAcesso,
      expiraEmSegundos:6 * 60 * 60
    });
  } catch (erro) {
    console.error(erro);
    const status = Number(erro?.statusCode) || 500;
    res.status(status).json({ erro:status === 429 ? erro.message : "Erro ao realizar login no AVANTE CX." });
  }
});

router.get("/crm-me", verificarTokenCrm, async (req, res) => {
  try {
    const resultado = await db.query(`
      SELECT *
      FROM usuarios_legado
      WHERE usuario_id = $1
      LIMIT 1
    `, [req.usuarioCrm.id]);

    if (!resultado.rows.length) return res.status(401).json({ autenticado:false, erro:"Usuário não encontrado." });

    const usuario = resultado.rows[0];
    if (String(usuario.status || "").trim().toUpperCase() !== "ATIVO") {
      return res.status(403).json({ autenticado:false, erro:"Usuário inativo." });
    }

    res.json({ autenticado:true, usuario:montarUsuarioPublico(usuario) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ autenticado:false, erro:"Erro ao validar sessão." });
  }
});


/* ============================================================
   DASHBOARD CRM - Node/PostgreSQL
   Usa o mesmo JWT CRM do /crm-login.
   ============================================================ */

router.get("/crm-dashboard", verificarTokenCrm, async (req, res) => {
  try {
    /*
     * Evita qualquer consulta travada segurar o Dashboard.
     * 5 segundos por statement nesta rota.
     */
    await db.query(`SET statement_timeout = '5000ms'`);

    const usuarioResultado = await db.query(
      `SELECT *
       FROM usuarios_legado
       WHERE usuario_id = $1
       LIMIT 1`,
      [req.usuarioCrm.id]
    );

    if (!usuarioResultado.rows.length) {
      return res.status(401).json({
        erro: "Usuário não encontrado."
      });
    }

    const usuario = usuarioResultado.rows[0];
    const publico = montarUsuarioPublico(usuario);

    if (!publico.permissoes?.PODE_DASHBOARD) {
      return res.status(403).json({
        erro: "Você não possui permissão para acessar o Dashboard."
      });
    }

    async function numeroSeguro(sql, params = []) {
      try {
        const r = await db.query(sql, params);
        return Number(r.rows?.[0]?.total || 0);
      } catch (erro) {
        console.warn("Dashboard count ignorado:", erro?.message || erro);
        return 0;
      }
    }

    async function valorSeguro(sql, params = []) {
      try {
        const r = await db.query(sql, params);
        return Number(r.rows?.[0]?.valor || 0);
      } catch (erro) {
        console.warn("Dashboard valor ignorado:", erro?.message || erro);
        return 0;
      }
    }

    async function linhasSeguro(sql, params = []) {
      try {
        const r = await db.query(sql, params);
        return Array.isArray(r.rows) ? r.rows : [];
      } catch (erro) {
        console.warn("Dashboard linhas ignoradas:", erro?.message || erro);
        return [];
      }
    }

    /*
     * Consultas pequenas e paralelas.
     * No usamos SELECT * de tabelas inteiras.
     */
    const [
      totalClientes,
      clientesAtivos,
      totalLeads,
      totalVendas,
      receitaRecebida,
      statusClientes
    ] = await Promise.all([
      numeroSeguro(`SELECT COUNT(*)::int AS total FROM clientes`),

      numeroSeguro(
        `SELECT COUNT(*)::int AS total
         FROM clientes
         WHERE
           COALESCE(ativo, FALSE) = TRUE
           OR UPPER(COALESCE(status_cliente, status, '')) = 'ATIVO'`
      ),

      numeroSeguro(`SELECT COUNT(*)::int AS total FROM leads`),

      numeroSeguro(
        `SELECT COUNT(*)::int AS total
         FROM oportunidades
         WHERE UPPER(COALESCE(status, '')) IN
           ('GANHO','GANHA','FECHADO','FECHADA','VENDIDO','VENDA')`
      ),

      valorSeguro(
        `SELECT COALESCE(SUM(
           COALESCE(
             valor_pago,
             valor_recebido,
             inter_valor_recebido,
             0
           )
         ),0)::numeric AS valor
         FROM contas_receber`
      ),

      linhasSeguro(
        `SELECT
           UPPER(COALESCE(status_cliente, status, 'SEM_STATUS')) AS status,
           COUNT(*)::int AS total
         FROM clientes
         GROUP BY 1
         ORDER BY 1`
      )
    ]);

    const clientesPorStatus = {};

    statusClientes.forEach((item) => {
      clientesPorStatus[String(item.status || "SEM_STATUS")] =
        Number(item.total || 0);
    });

    /*
     * Agenda fica opcional nesta etapa.
     * Se a tabela/colunas ainda diferirem, o Dashboard continua carregando.
     */
    let proximosEventos = [];

    try {
      const agenda = await linhasSeguro(
        `SELECT *
         FROM agenda
         ORDER BY data ASC NULLS LAST
         LIMIT 5`
      );

      proximosEventos = agenda.map((evento) => ({
        AGENDA_ID: evento.agenda_id || evento.id || "",
        TITULO: evento.titulo || evento.nome || "Compromisso",
        DATA: evento.data || evento.data_evento || "",
        HORA_INICIO: evento.hora_inicio || evento.horario || "",
        HORA_FIM: evento.hora_fim || "",
        LOCAL: evento.local || evento.local_evento || "",
        STATUS: evento.status || "AGENDADO"
      }));
    } catch (e) {
      proximosEventos = [];
    }

    return res.json({
      sucesso: true,
      fonte: "API_POSTGRESQL",
      dashboard: {
        empresa: "AVANTE",
        sistema: "AVANTE CX",
        versao: "2.0.0",
        resumo: {
          clientes: totalClientes,
          clientesAtivos,
          leads: totalLeads,
          vendas: totalVendas,
          receitaRecebida
        },
        clientesPorStatus,
        leadsPorEtapa: {},
        oportunidadesPorStatus: {},
        fraseDoDia: {
          data: new Intl.DateTimeFormat(
            "pt-BR",
            { timeZone: "America/Bahia" }
          ).format(new Date())
        },
        proximosCompromissos: proximosEventos,
        proximosEventos,
        agenda: {
          eventos: proximosEventos
        },
        usuario: {
          nome: publico.nome,
          email: publico.email,
          perfil: publico.perfil
        },
        atualizadoEm: new Date().toISOString()
      }
    });

  } catch (erro) {
    console.error("CRM Dashboard:", erro);

    return res.status(500).json({
      erro: "Erro ao carregar Dashboard.",
      detalhe:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(erro?.message || erro)
    });
  }
});



// ======================================================
// CRM - PRIMEIRO ACESSO E RECUPERAÇÃO 100% NODE/POSTGRESQL
// ======================================================

const CRM_TOKEN_MAX_TENTATIVAS = 5;
const CRM_TOKEN_BLOQUEIO_MS = 15 * 60 * 1000;
const CRM_RECUPERACAO_MINUTOS = 30;
const CRM_ATIVACAO_MINUTOS = 30;
const CRM_MIN_SENHA = 8;

const tentativasTokenCrm = new Map();
const tentativasAcaoPublicaCrm = new Map();

function validarSenhaForteCrm_(senha) {
  const valor = String(senha || "");

  if (valor.length < CRM_MIN_SENHA) {
    const erro = new Error(
      "A senha deve possuir pelo menos " +
      CRM_MIN_SENHA +
      " caracteres."
    );
    erro.statusCode = 400;
    throw erro;
  }

  if (!/[A-Za-z]/.test(valor) || !/\d/.test(valor)) {
    const erro = new Error(
      "A senha deve possuir letras e números."
    );
    erro.statusCode = 400;
    throw erro;
  }
}

function gerarSaltSenhaCrm_() {
  return crypto.randomBytes(32).toString("hex");
}

function hashCodigoCrm_(tipo, codigo) {
  const segredo =
    String(process.env.AVANTE_AUTH_SECRET_V1 || "");

  if (!segredo) {
    throw new Error(
      "AVANTE_AUTH_SECRET_V1 não configurado no Railway"
    );
  }

  return crypto
    .createHmac("sha256", segredo)
    .update(
      String(tipo || "").trim().toUpperCase() +
      "|" +
      String(codigo || ""),
      "utf8"
    )
    .digest("hex");
}

function gerarCodigo6Crm_() {
  return String(
    crypto.randomInt(100000, 1000000)
  );
}

function chaveTentativaTokenCrm_(tipo, usuarioId) {
  return (
    String(tipo || "").toUpperCase() +
    "|" +
    String(usuarioId || "")
  );
}

function verificarBloqueioTokenCrm_(tipo, usuarioId) {
  const chave =
    chaveTentativaTokenCrm_(tipo, usuarioId);

  const atual =
    tentativasTokenCrm.get(chave);

  if (!atual) return;

  if (
    atual.bloqueadoAte &&
    atual.bloqueadoAte > Date.now()
  ) {
    const erro = new Error(
      "Muitas tentativas. Aguarde alguns minutos e tente novamente."
    );
    erro.statusCode = 429;
    throw erro;
  }

  if (
    atual.bloqueadoAte &&
    atual.bloqueadoAte <= Date.now()
  ) {
    tentativasTokenCrm.delete(chave);
  }
}

function registrarFalhaTokenCrm_(tipo, usuarioId) {
  const chave =
    chaveTentativaTokenCrm_(tipo, usuarioId);

  const atual =
    tentativasTokenCrm.get(chave) || {
      tentativas: 0,
      bloqueadoAte: 0
    };

  atual.tentativas += 1;

  if (
    atual.tentativas >=
    CRM_TOKEN_MAX_TENTATIVAS
  ) {
    atual.bloqueadoAte =
      Date.now() +
      CRM_TOKEN_BLOQUEIO_MS;
  }

  tentativasTokenCrm.set(chave, atual);
}

function limparFalhasTokenCrm_(tipo, usuarioId) {
  tentativasTokenCrm.delete(
    chaveTentativaTokenCrm_(
      tipo,
      usuarioId
    )
  );
}

function limitarAcaoPublicaCrm_(tipo, alvo) {
  const chave =
    String(tipo || "ACAO").toUpperCase() +
    "|" +
    String(alvo || "GLOBAL")
      .trim()
      .toLowerCase();

  const agora = Date.now();

  const atual =
    tentativasAcaoPublicaCrm.get(chave) || {
      inicio: agora,
      total: 0
    };

  if (
    agora - atual.inicio >
    CRM_TOKEN_BLOQUEIO_MS
  ) {
    atual.inicio = agora;
    atual.total = 0;
  }

  atual.total += 1;
  tentativasAcaoPublicaCrm.set(chave, atual);

  if (atual.total > 5) {
    const erro = new Error(
      "Muitas solicitações. Aguarde alguns minutos e tente novamente."
    );
    erro.statusCode = 429;
    throw erro;
  }
}

async function garantirSchemaAuthCrm_() {
  await db.query(`
    ALTER TABLE usuarios_legado
      ADD COLUMN IF NOT EXISTS token_ativacao_hash TEXT,
      ADD COLUMN IF NOT EXISTS token_ativacao_expira_em TIMESTAMPTZ
  `);
}

async function buscarUsuarioCrmPorIdentificador_(identificador) {
  const alvo =
    String(identificador || "")
      .trim();

  if (!alvo) return null;

  const r =
    await db.query(
      `SELECT *
       FROM usuarios_legado
       WHERE
         LOWER(COALESCE(login,'')) =
           LOWER($1)
         OR
         LOWER(COALESCE(email,'')) =
           LOWER($1)
       LIMIT 1`,
      [alvo]
    );

  return r.rows[0] || null;
}

function assinarTokenCrmParaUsuario_(usuario) {
  const publico =
    montarUsuarioPublico(usuario);

  const token =
    jwt.sign(
      {
        tipo: "crm",
        id: usuario.usuario_id,
        login: usuario.login || "",
        email: usuario.email || "",
        perfil: publico.perfil
      },
      segredoCrmJwt(),
      {
        expiresIn: CRM_TOKEN_TTL,
        issuer: "avante-cx",
        audience: "avante-cx-web"
      }
    );

  return {
    token,
    usuario: publico
  };
}

async function enviarEmailCrm_({
  para,
  assunto,
  html
}) {
  const apiKey =
    String(
      process.env.RESEND_API_KEY || ""
    ).trim();

  const remetente =
    String(
      process.env.AVANTE_EMAIL_FROM || ""
    ).trim();

  if (!apiKey || !remetente) {
    throw new Error(
      "Serviço de e-mail não configurado no Railway. Configure RESEND_API_KEY e AVANTE_EMAIL_FROM."
    );
  }

  const resposta =
    await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          "Authorization":
            "Bearer " + apiKey,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          from: remetente,
          to: [String(para || "").trim()],
          subject: assunto,
          html
        })
      }
    );

  const dados =
    await resposta
      .json()
      .catch(() => ({}));

  if (!resposta.ok) {
    const detalhe =
      dados?.message ||
      dados?.error ||
      ("HTTP " + resposta.status);

    throw new Error(
      "Não foi possível enviar o e-mail. " +
      String(detalhe)
    );
  }

  return dados;
}

function escaparHtmlCrm_(valor) {
  return String(valor || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


// ------------------------------------------------------
// CADASTRO PÚBLICO
// ------------------------------------------------------

router.post(
  "/crm-primeiro-acesso/cadastrar",
  async (req, res) => {
    const client =
      await db.connect();

    let usuarioId = "";

    try {
      await garantirSchemaAuthCrm_();

      const nome =
        String(req.body?.nome || "")
          .trim();

      const email =
        String(req.body?.email || "")
          .trim()
          .toLowerCase();

      const login =
        String(req.body?.login || "")
          .trim()
          .toLowerCase();

      const senha =
        String(req.body?.senha || "");

      if (
        !nome ||
        !email ||
        !login ||
        !senha
      ) {
        return res.status(400).json({
          erro:
            "Preencha nome, e-mail, login e senha."
        });
      }

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
          .test(email)
      ) {
        return res.status(400).json({
          erro:
            "Informe um e-mail válido."
        });
      }

      validarSenhaForteCrm_(senha);
      limitarAcaoPublicaCrm_(
        "CADASTRO",
        email
      );

      const salt =
        gerarSaltSenhaCrm_();

      const codigo =
        gerarCodigo6Crm_();

      const expira =
        new Date(
          Date.now() +
          CRM_ATIVACAO_MINUTOS *
          60 * 1000
        );

      await client.query("BEGIN");

      await client.query(
        `SELECT pg_advisory_xact_lock(
           hashtext('avante_usuarios_legado_cadastro')
         )`
      );

      const duplicado =
        await client.query(
          `SELECT usuario_id,email,login
           FROM usuarios_legado
           WHERE
             LOWER(COALESCE(email,'')) =
               LOWER($1)
             OR
             LOWER(COALESCE(login,'')) =
               LOWER($2)
           LIMIT 1`,
          [email, login]
        );

      if (duplicado.rows.length) {
        await client.query("ROLLBACK");

        const existente =
          duplicado.rows[0];

        if (
          String(existente.email || "")
            .toLowerCase() === email
        ) {
          return res.status(409).json({
            erro:
              "Já existe um usuário cadastrado com este e-mail."
          });
        }

        return res.status(409).json({
          erro:
            "Este login já está em uso."
        });
      }

      const proximo =
        await client.query(`
          SELECT
            COALESCE(
              MAX(
                CASE
                  WHEN usuario_id ~ '^USR[0-9]+$'
                  THEN
                    SUBSTRING(
                      usuario_id
                      FROM 4
                    )::bigint
                  ELSE 0
                END
              ),
              0
            ) + 1 AS numero
          FROM usuarios_legado
        `);

      usuarioId =
        "USR" +
        String(
          Number(
            proximo.rows[0]?.numero ||
            1
          )
        ).padStart(6, "0");

      await client.query(
        `INSERT INTO usuarios_legado (
          usuario_id,
          nome,
          email,
          login,
          senha_hash,
          senha_salt,
          perfil,
          status,
          id_funcionario,
          pode_dashboard,
          pode_clientes,
          pode_jornada,
          pode_financeiro,
          pode_produtos,
          pode_agenda,
          pode_funcionarios,
          pode_relatorios,
          pode_configuracoes,
          pode_usuarios,
          primeiro_acesso,
          token_ativacao_hash,
          token_ativacao_expira_em,
          data_cadastro,
          data_atualizacao,
          usuario_cadastro
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          'SEM_ACESSO','PENDENTE','',
          FALSE,FALSE,FALSE,FALSE,FALSE,
          FALSE,FALSE,FALSE,FALSE,FALSE,
          FALSE,$7,$8,NOW(),NOW(),
          'AUTO_CADASTRO'
        )`,
        [
          usuarioId,
          nome,
          email,
          login,
          hashSenhaLegada(
            senha,
            salt
          ),
          salt,
          hashCodigoCrm_(
            "ATIVACAO",
            codigo
          ),
          expira
        ]
      );

      await client.query("COMMIT");

      try {
        await enviarEmailCrm_({
          para: email,
          assunto:
            "AVANTE CX | Token de liberação do primeiro acesso",
          html:
            "<h2>AVANTE CX</h2>" +
            "<p>Olá, " +
            escaparHtmlCrm_(nome) +
            ".</p>" +
            "<p>Seu token de liberação é:</p>" +
            "<h1 style=\"letter-spacing:6px\">" +
            codigo +
            "</h1>" +
            "<p>Este token é de uso único e tem validade de " +
            CRM_ATIVACAO_MINUTOS +
            " minutos.</p>"
        });

      } catch (erroEmail) {
        await db.query(
          `DELETE FROM usuarios_legado
           WHERE usuario_id=$1
             AND status='PENDENTE'`,
          [usuarioId]
        ).catch(() => {});

        throw erroEmail;
      }

      return res.status(201).json({
        sucesso: true,
        identificador: email,
        mensagem:
          "Cadastro realizado. Enviamos um token de 6 dígitos para o seu e-mail."
      });

    } catch (erro) {
      await client
        .query("ROLLBACK")
        .catch(() => {});

      console.error(
        "crm-primeiro-acesso/cadastrar:",
        erro
      );

      const status =
        Number(erro?.statusCode) ||
        500;

      return res.status(status).json({
        erro:
          status === 500
            ? (
                erro?.message ||
                "Não foi possível realizar o cadastro."
              )
            : erro.message
      });

    } finally {
      client.release();
    }
  }
);


// ------------------------------------------------------
// ATIVAR CADASTRO PENDENTE
// ------------------------------------------------------

router.post(
  "/crm-primeiro-acesso/ativar",
  async (req, res) => {
    try {
      await garantirSchemaAuthCrm_();

      const identificador =
        String(
          req.body?.identificador ||
          ""
        ).trim();

      const codigo =
        String(
          req.body?.token ||
          req.body?.codigo ||
          ""
        ).trim();

      const usuario =
        await buscarUsuarioCrmPorIdentificador_(
          identificador
        );

      if (
        !usuario ||
        String(usuario.status || "")
          .toUpperCase() !==
          "PENDENTE"
      ) {
        return res.status(400).json({
          erro:
            "Token inválido ou cadastro não encontrado."
        });
      }

      if (
        !usuario.token_ativacao_hash ||
        !usuario.token_ativacao_expira_em
      ) {
        return res.status(400).json({
          erro:
            "Token inválido ou expirado."
        });
      }

      const expira =
        new Date(
          usuario.token_ativacao_expira_em
        );

      if (
        !expira.getTime() ||
        expira.getTime() < Date.now()
      ) {
        return res.status(400).json({
          erro:
            "Token inválido ou expirado."
        });
      }

      verificarBloqueioTokenCrm_(
        "ATIVACAO",
        usuario.usuario_id
      );

      const hash =
        hashCodigoCrm_(
          "ATIVACAO",
          codigo
        );

      if (
        hash !==
        String(
          usuario.token_ativacao_hash
        )
      ) {
        registrarFalhaTokenCrm_(
          "ATIVACAO",
          usuario.usuario_id
        );

        return res.status(400).json({
          erro:
            "Token inválido ou expirado."
        });
      }

      limparFalhasTokenCrm_(
        "ATIVACAO",
        usuario.usuario_id
      );

      await db.query(
        `UPDATE usuarios_legado
         SET
           status='ATIVO',
           token_ativacao_hash=NULL,
           token_ativacao_expira_em=NULL,
           data_atualizacao=NOW()
         WHERE usuario_id=$1`,
        [usuario.usuario_id]
      );

      return res.json({
        sucesso: true,
        login:
          usuario.login ||
          usuario.email,
        mensagem:
          "Acesso liberado com sucesso. Agora você já pode entrar no AVANTE CX."
      });

    } catch (erro) {
      console.error(
        "crm-primeiro-acesso/ativar:",
        erro
      );

      return res
        .status(
          Number(erro?.statusCode) ||
          500
        )
        .json({
          erro:
            erro?.message ||
            "Não foi possível liberar o acesso."
        });
    }
  }
);


// ------------------------------------------------------
// REENVIAR TOKEN DE ATIVAÇÃO
// ------------------------------------------------------

router.post(
  "/crm-primeiro-acesso/reenviar",
  async (req, res) => {
    const respostaGenerica = {
      sucesso: true,
      mensagem:
        "Se houver um cadastro pendente, um novo token será enviado ao e-mail."
    };

    try {
      await garantirSchemaAuthCrm_();

      const identificador =
        String(
          req.body?.identificador ||
          ""
        ).trim();

      limitarAcaoPublicaCrm_(
        "REENVIO_ATIVACAO",
        identificador ||
        "GLOBAL"
      );

      const usuario =
        await buscarUsuarioCrmPorIdentificador_(
          identificador
        );

      if (
        !usuario ||
        String(usuario.status || "")
          .toUpperCase() !==
          "PENDENTE" ||
        !usuario.email
      ) {
        return res.json(
          respostaGenerica
        );
      }

      const codigo =
        gerarCodigo6Crm_();

      const expira =
        new Date(
          Date.now() +
          CRM_ATIVACAO_MINUTOS *
          60 * 1000
        );

      limparFalhasTokenCrm_(
        "ATIVACAO",
        usuario.usuario_id
      );

      await db.query(
        `UPDATE usuarios_legado
         SET
           token_ativacao_hash=$1,
           token_ativacao_expira_em=$2,
           data_atualizacao=NOW()
         WHERE usuario_id=$3`,
        [
          hashCodigoCrm_(
            "ATIVACAO",
            codigo
          ),
          expira,
          usuario.usuario_id
        ]
      );

      await enviarEmailCrm_({
        para: usuario.email,
        assunto:
          "AVANTE CX | Novo token de liberação",
        html:
          "<h2>AVANTE CX</h2>" +
          "<p>Seu novo token de liberação é:</p>" +
          "<h1 style=\"letter-spacing:6px\">" +
          codigo +
          "</h1>" +
          "<p>Validade: " +
          CRM_ATIVACAO_MINUTOS +
          " minutos.</p>"
      });

      return res.json(
        respostaGenerica
      );

    } catch (erro) {
      console.error(
        "crm-primeiro-acesso/reenviar:",
        erro
      );

      const status =
        Number(erro?.statusCode) ||
        500;

      return res.status(status).json({
        erro:
          status === 429
            ? erro.message
            : (
                erro?.message ||
                "Não foi possível reenviar o token."
              )
      });
    }
  }
);


// ------------------------------------------------------
// PRIMEIRO ACESSO DE USUÁRIO CRIADO PELO ADMIN
// ------------------------------------------------------

router.post(
  "/crm-primeiro-acesso/senha",
  verificarTokenCrm,
  async (req, res) => {
    try {
      const senha =
        String(
          req.body?.senha || ""
        );

      validarSenhaForteCrm_(senha);

      const r =
        await db.query(
          `SELECT *
           FROM usuarios_legado
           WHERE usuario_id=$1
           LIMIT 1`,
          [req.usuarioCrm.id]
        );

      if (!r.rows.length) {
        return res.status(401).json({
          erro:
            "Usuário não encontrado."
        });
      }

      const usuario =
        r.rows[0];

      if (
        String(usuario.status || "")
          .toUpperCase() !==
        "ATIVO"
      ) {
        return res.status(403).json({
          erro:
            "Usuário inativo."
        });
      }

      if (
        !boolSistema(
          usuario.primeiro_acesso
        )
      ) {
        return res.status(400).json({
          erro:
            "O primeiro acesso já foi concluído."
        });
      }

      const salt =
        gerarSaltSenhaCrm_();

      const atualizado =
        await db.query(
          `UPDATE usuarios_legado
           SET
             senha_hash=$1,
             senha_salt=$2,
             primeiro_acesso=FALSE,
             ultima_troca_senha=NOW(),
             data_atualizacao=NOW()
           WHERE usuario_id=$3
           RETURNING *`,
          [
            hashSenhaLegada(
              senha,
              salt
            ),
            salt,
            usuario.usuario_id
          ]
        );

      const novo =
        assinarTokenCrmParaUsuario_(
          atualizado.rows[0]
        );

      return res.json({
        sucesso: true,
        mensagem:
          "Senha definida com sucesso.",
        sessionToken:
          novo.token,
        usuario:
          novo.usuario
      });

    } catch (erro) {
      console.error(
        "crm-primeiro-acesso/senha:",
        erro
      );

      return res
        .status(
          Number(erro?.statusCode) ||
          500
        )
        .json({
          erro:
            erro?.message ||
            "Não foi possível definir a senha."
        });
    }
  }
);


// ------------------------------------------------------
// SOLICITAR RECUPERAÇÃO
// ------------------------------------------------------

router.post(
  "/crm-recuperacao/solicitar",
  async (req, res) => {
    const respostaGenerica = {
      sucesso: true,
      mensagem:
        "Se o usuário estiver cadastrado e ativo, enviaremos um código ao e-mail informado no cadastro."
    };

    try {
      const identificador =
        String(
          req.body?.identificador ||
          ""
        ).trim();

      limitarAcaoPublicaCrm_(
        "RECUPERACAO",
        identificador ||
        "GLOBAL"
      );

      const usuario =
        await buscarUsuarioCrmPorIdentificador_(
          identificador
        );

      if (
        !usuario ||
        String(usuario.status || "")
          .toUpperCase() !==
          "ATIVO" ||
        !usuario.email
      ) {
        return res.json(
          respostaGenerica
        );
      }

      const codigo =
        gerarCodigo6Crm_();

      const expira =
        new Date(
          Date.now() +
          CRM_RECUPERACAO_MINUTOS *
          60 * 1000
        );

      limparFalhasTokenCrm_(
        "RECUPERACAO",
        usuario.usuario_id
      );

      await db.query(
        `UPDATE usuarios_legado
         SET
           codigo_recuperacao_hash=$1,
           recuperacao_expira_em=$2,
           data_atualizacao=NOW()
         WHERE usuario_id=$3`,
        [
          hashCodigoCrm_(
            "RECUPERACAO",
            codigo
          ),
          expira,
          usuario.usuario_id
        ]
      );

      await enviarEmailCrm_({
        para: usuario.email,
        assunto:
          "AVANTE CX | Recuperação de senha",
        html:
          "<h2>AVANTE CX</h2>" +
          "<p>Seu código de recuperação é:</p>" +
          "<h1 style=\"letter-spacing:6px\">" +
          codigo +
          "</h1>" +
          "<p>Validade: " +
          CRM_RECUPERACAO_MINUTOS +
          " minutos.</p>"
      });

      return res.json(
        respostaGenerica
      );

    } catch (erro) {
      console.error(
        "crm-recuperacao/solicitar:",
        erro
      );

      const status =
        Number(erro?.statusCode) ||
        500;

      if (status === 429) {
        return res.status(429).json({
          erro: erro.message
        });
      }

      /*
       * Mantém resposta genérica para não revelar
       * existência ou estado da conta.
       */
      return res.json(
        respostaGenerica
      );
    }
  }
);


// ------------------------------------------------------
// REDEFINIR SENHA COM CÓDIGO
// ------------------------------------------------------

router.post(
  "/crm-recuperacao/redefinir",
  async (req, res) => {
    try {
      const identificador =
        String(
          req.body?.identificador ||
          ""
        ).trim();

      const codigo =
        String(
          req.body?.codigo ||
          ""
        ).trim();

      const senha =
        String(
          req.body?.senha ||
          ""
        );

      if (
        !identificador ||
        !codigo
      ) {
        return res.status(400).json({
          erro:
            "Código inválido ou expirado."
        });
      }

      validarSenhaForteCrm_(senha);

      const usuario =
        await buscarUsuarioCrmPorIdentificador_(
          identificador
        );

      if (
        !usuario ||
        !usuario.codigo_recuperacao_hash ||
        !usuario.recuperacao_expira_em
      ) {
        return res.status(400).json({
          erro:
            "Código inválido ou expirado."
        });
      }

      const expira =
        new Date(
          usuario.recuperacao_expira_em
        );

      if (
        !expira.getTime() ||
        expira.getTime() < Date.now()
      ) {
        return res.status(400).json({
          erro:
            "Código inválido ou expirado."
        });
      }

      verificarBloqueioTokenCrm_(
        "RECUPERACAO",
        usuario.usuario_id
      );

      const hash =
        hashCodigoCrm_(
          "RECUPERACAO",
          codigo
        );

      if (
        hash !==
        String(
          usuario.codigo_recuperacao_hash
        )
      ) {
        registrarFalhaTokenCrm_(
          "RECUPERACAO",
          usuario.usuario_id
        );

        return res.status(400).json({
          erro:
            "Código inválido ou expirado."
        });
      }

      limparFalhasTokenCrm_(
        "RECUPERACAO",
        usuario.usuario_id
      );

      const salt =
        gerarSaltSenhaCrm_();

      await db.query(
        `UPDATE usuarios_legado
         SET
           senha_hash=$1,
           senha_salt=$2,
           primeiro_acesso=FALSE,
           codigo_recuperacao_hash=NULL,
           recuperacao_expira_em=NULL,
           ultima_troca_senha=NOW(),
           data_atualizacao=NOW()
         WHERE usuario_id=$3`,
        [
          hashSenhaLegada(
            senha,
            salt
          ),
          salt,
          usuario.usuario_id
        ]
      );

      return res.json({
        sucesso: true,
        mensagem:
          "Senha redefinida com sucesso."
      });

    } catch (erro) {
      console.error(
        "crm-recuperacao/redefinir:",
        erro
      );

      return res
        .status(
          Number(erro?.statusCode) ||
          500
        )
        .json({
          erro:
            erro?.message ||
            "Não foi possível redefinir a senha."
        });
    }
  }
);


/* ROTAS TÉCNICAS EXISTENTES - preservadas */
router.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro:"Email e senha são obrigatórios" });

    const resultado = await db.query(`
      SELECT id, nome, email, senha_hash, perfil, ativo
      FROM usuarios
      WHERE email = $1
      LIMIT 1
    `, [email]);

    if (resultado.rows.length === 0) return res.status(401).json({ erro:"Email ou senha inválidos" });
    const usuario = resultado.rows[0];
    if (!usuario.ativo) return res.status(403).json({ erro:"Usuário inativo" });

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaCorreta) return res.status(401).json({ erro:"Email ou senha inválidos" });

    const token = jwt.sign({ id:usuario.id, email:usuario.email, perfil:usuario.perfil }, process.env.JWT_SECRET, { expiresIn:"8h" });

    res.json({
      mensagem:"Login realizado com sucesso",
      usuario:{ id:usuario.id, nome:usuario.nome, email:usuario.email, perfil:usuario.perfil },
      token
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro:"Erro ao realizar login" });
  }
});

router.get("/me", verificarToken, async (req, res) => {
  try {
    const resultado = await db.query(`
      SELECT id, nome, email, perfil, ativo, criado_em
      FROM usuarios
      WHERE id = $1
      LIMIT 1
    `, [req.usuario.id]);

    if (resultado.rows.length === 0) return res.status(404).json({ erro:"Usuário não encontrado" });
    const usuario = resultado.rows[0];
    if (!usuario.ativo) return res.status(403).json({ erro:"Usuário inativo" });
    res.json({ usuario });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro:"Erro ao buscar usuário" });
  }
});


// ======================================================
// CRM FINANCEIRO - LEITURA DIRETA NODE / POSTGRESQL
// ======================================================

router.get("/crm-financeiro", verificarTokenCrm, async (req, res) => {
  try {
    const usuarioR = await db.query(
      `SELECT usuario_id,perfil,status,pode_financeiro
       FROM usuarios_legado
       WHERE usuario_id=$1
       LIMIT 1`,
      [req.usuarioCrm.id]
    );

    if (!usuarioR.rows.length) {
      return res.status(401).json({
        autenticado:false,
        erro:"Usuário não encontrado."
      });
    }

    const usuario = usuarioR.rows[0];
    const perfil = String(usuario.perfil || "").trim().toUpperCase();
    const permitido =
      boolSistema(usuario.pode_financeiro) ||
      ["ADMINISTRADOR","GESTOR"].includes(perfil);

    if (!permitido) {
      return res.status(403).json({
        erro:"Você não possui permissão para acessar o Financeiro."
      });
    }

    const [receberR,pagarR,fluxoR,bancosR,clientesR] = await Promise.all([
      db.query(
        `SELECT *
         FROM contas_receber
         ORDER BY data_vencimento ASC NULLS LAST, id DESC`
      ),
      db.query(
        `SELECT *
         FROM contas_pagar
         ORDER BY data_vencimento ASC NULLS LAST, id DESC`
      ),
      db.query(
        `SELECT *
         FROM fluxo_caixa
         ORDER BY data DESC NULLS LAST, id DESC`
      ),
      db.query(
        `SELECT *
         FROM bancos_financeiro
         ORDER BY nome ASC NULLS LAST, id ASC`
      ),
      db.query(
        `SELECT id_cliente,nome_completo,email,telefone,status_cliente,ativo
         FROM clientes
         WHERE COALESCE(ativo,TRUE)=TRUE
         ORDER BY nome_completo ASC`
      )
    ]);

    const num = v => Number(v || 0) || 0;
    const statusAtivo = s =>
      String(s || "").trim().toUpperCase() !== "CANCELADO";

    const recebido = receberR.rows.reduce(
      (s,x) => s + num(x.valor_pago),
      0
    );

    const aReceber = receberR.rows
      .filter(x => statusAtivo(x.status))
      .reduce(
        (s,x) => s + num(
          x.saldo_aberto !== null && x.saldo_aberto !== undefined
            ? x.saldo_aberto
            : Math.max(0, num(x.valor_final || x.valor) - num(x.valor_pago))
        ),
        0
      );

    const pago = pagarR.rows.reduce(
      (s,x) => s + num(x.valor_pago),
      0
    );

    const aPagar = pagarR.rows
      .filter(x => statusAtivo(x.status))
      .reduce(
        (s,x) => s + num(
          x.saldo_aberto !== null && x.saldo_aberto !== undefined
            ? x.saldo_aberto
            : Math.max(0, num(x.valor_final || x.valor) - num(x.valor_pago))
        ),
        0
      );

    res.json({
      sucesso:true,
      financeiro:{
        receber:receberR.rows,
        pagar:pagarR.rows,
        fluxo:fluxoR.rows,
        bancos:bancosR.rows,
        clientes:clientesR.rows,
        resumo:{
          recebido,
          aReceber,
          pago,
          aPagar,
          saldoRealizado:recebido - pago
        },
        relatorios:{
          recebido,
          aReceber,
          pago,
          aPagar,
          saldoRealizado:recebido - pago
        },
        opcoes:{
          tiposConta:[
            "CONTA_CORRENTE","POUPANCA","CONTA_DIGITAL",
            "CARTEIRA","CAIXA","INVESTIMENTO","OUTRO"
          ],
          formasPagamento:[
            "PIX","DINHEIRO","CARTAO_CREDITO","CARTAO_DEBITO",
            "BOLETO","TRANSFERENCIA","DEBITO_AUTOMATICO",
            "CHEQUE","OUTRO"
          ],
          frequencias:[
            "MENSAL","QUINZENAL","SEMANAL",
            "TRIMESTRAL","SEMESTRAL","ANUAL"
          ]
        }
      }
    });

  } catch (erro) {
    console.error("GET /auth/crm-financeiro:", erro);
    res.status(500).json({
      erro:"Erro ao carregar Financeiro.",
      detalhe:erro?.message || null
    });
  }
});

module.exports = router;
