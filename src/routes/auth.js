const verificarToken = require("../middleware/auth");
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../database/db");

const router = express.Router();

/* ============================================================
   AVANTE CX - AUTH
   1) /login e /me = autenticao tcnica/legada j existente
   2) /crm-login e /crm-me = autenticao do AVANTE CX (usuarios_legado)

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
    nome: usuario.nome || usuario.login || "Usurio",
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
  if (!segredo) throw new Error("AVANTE_AUTH_SECRET_V1 no configurado no Railway");
  return crypto.createHmac("sha256", segredo)
    .update(`${String(salt || "")}|${String(senha || "")}`, "utf8")
    .digest("hex");
}

function segredoCrmJwt() {
  const dedicado = String(process.env.CRM_JWT_SECRET || "").trim();
  if (dedicado) return dedicado;

  const base = String(process.env.JWT_SECRET || "").trim();
  if (!base) throw new Error("JWT_SECRET no configurado no Railway");

  /*
   * Derivao por domnio: o token CRM NO valida no middleware
   * tcnico que usa JWT_SECRET diretamente.
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
    if (!token) return res.status(401).json({ autenticado:false, erro:"Sesso no informada" });

    const payload = jwt.verify(token, segredoCrmJwt(), {
      issuer: "avante-cx",
      audience: "avante-cx-web"
    });

    if (payload.tipo !== "crm") return res.status(401).json({ autenticado:false, erro:"Sesso invlida" });
    req.usuarioCrm = payload;
    next();
  } catch (erro) {
    return res.status(401).json({ autenticado:false, expirada:erro?.name === "TokenExpiredError", erro:"Sesso invlida ou expirada" });
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
    res.status(500).json({ sucesso:false, erro:"Falha ao validar autenticao CRM" });
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
      return res.status(401).json({ erro:"Login ou senha invlidos." });
    }

    const usuario = resultado.rows[0];

    if (String(usuario.status || "").trim().toUpperCase() !== "ATIVO") {
      registrarFalhaCrm(chaveRate);
      return res.status(401).json({ erro:"Login ou senha invlidos." });
    }

    if (!usuario.senha_hash || !usuario.senha_salt) {
      registrarFalhaCrm(chaveRate);
      return res.status(401).json({ erro:"Login ou senha invlidos." });
    }

    const hashInformado = hashSenhaLegada(senha, usuario.senha_salt);
    const hashSalvo = String(usuario.senha_hash || "");
    const a = Buffer.from(hashInformado, "utf8");
    const b = Buffer.from(hashSalvo, "utf8");
    const senhaCorreta = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!senhaCorreta) {
      registrarFalhaCrm(chaveRate);
      return res.status(401).json({ erro:"Login ou senha invlidos." });
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
      SET ultimo_acesso = NOW(), data_atualizacao = NOW()
      WHERE usuario_id = $1
    `, [usuario.usuario_id]).catch((erro) => {
      console.warn("No foi possvel atualizar ultimo_acesso:", erro?.message || erro);
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

    if (!resultado.rows.length) return res.status(401).json({ autenticado:false, erro:"Usurio no encontrado." });

    const usuario = resultado.rows[0];
    if (String(usuario.status || "").trim().toUpperCase() !== "ATIVO") {
      return res.status(403).json({ autenticado:false, erro:"Usurio inativo." });
    }

    res.json({ autenticado:true, usuario:montarUsuarioPublico(usuario) });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ autenticado:false, erro:"Erro ao validar sesso." });
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
        erro: "Usurio no encontrado."
      });
    }

    const usuario = usuarioResultado.rows[0];
    const publico = montarUsuarioPublico(usuario);

    if (!publico.permissoes?.PODE_DASHBOARD) {
      return res.status(403).json({
        erro: "Voc no possui permisso para acessar o Dashboard."
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


/* ROTAS TCNICAS EXISTENTES - preservadas */
router.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro:"Email e senha so obrigatrios" });

    const resultado = await db.query(`
      SELECT id, nome, email, senha_hash, perfil, ativo
      FROM usuarios
      WHERE email = $1
      LIMIT 1
    `, [email]);

    if (resultado.rows.length === 0) return res.status(401).json({ erro:"Email ou senha invlidos" });
    const usuario = resultado.rows[0];
    if (!usuario.ativo) return res.status(403).json({ erro:"Usurio inativo" });

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaCorreta) return res.status(401).json({ erro:"Email ou senha invlidos" });

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

    if (resultado.rows.length === 0) return res.status(404).json({ erro:"Usurio no encontrado" });
    const usuario = resultado.rows[0];
    if (!usuario.ativo) return res.status(403).json({ erro:"Usurio inativo" });
    res.json({ usuario });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro:"Erro ao buscar usurio" });
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
        erro:"Usurio no encontrado."
      });
    }

    const usuario = usuarioR.rows[0];
    const perfil = String(usuario.perfil || "").trim().toUpperCase();
    const permitido =
      boolSistema(usuario.pode_financeiro) ||
      ["ADMINISTRADOR","GESTOR"].includes(perfil);

    if (!permitido) {
      return res.status(403).json({
        erro:"Voc no possui permisso para acessar o Financeiro."
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
