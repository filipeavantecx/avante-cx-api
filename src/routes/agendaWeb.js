const express = require("express");
const db = require("../database/db");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const router = express.Router();

const vazioNull = v =>
  v === undefined || v === null || v === "" ? null : v;

function pegar(obj, campo) {
  return vazioNull(obj?.[campo] ?? obj?.[campo.toLowerCase()]);
}

function segredoCrmJwtAgenda_() {
  const dedicado = String(process.env.CRM_JWT_SECRET || "").trim();
  if (dedicado) return dedicado;

  const base = String(process.env.JWT_SECRET || "").trim();
  if (!base) throw new Error("JWT_SECRET não configurado no Railway");

  return crypto
    .createHmac("sha256", base)
    .update("AVANTE_CRM_WEB_V1", "utf8")
    .digest("hex");
}

function boolAgenda_(valor) {
  if (valor === true || valor === 1) return true;

  return ["TRUE","1","SIM","S","YES","Y"]
    .includes(String(valor || "").trim().toUpperCase());
}

async function verificarTokenCrmAgenda_(req, res, next) {
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
      segredoCrmJwtAgenda_(),
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
      `SELECT
         usuario_id,
         nome,
         email,
         login,
         perfil,
         status,
         pode_agenda
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

    const permitido =
      boolAgenda_(usuario.pode_agenda) ||
      [
        "ADMINISTRADOR",
        "GESTOR",
        "MENTOR",
        "COLABORADOR",
        "VISUALIZADOR"
      ].includes(perfil);

    if (!permitido) {
      return res.status(403).json({
        erro: "Você não possui permissão para acessar Agenda."
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

router.use(verificarTokenCrmAgenda_);

function agendaDtoWeb_(row = {}) {
  return {
    AGENDA_ID: row.agenda_id || "",
    GOOGLE_EVENT_ID: row.google_event_id || "",
    CALENDAR_ID: row.calendar_id || "",
    TITULO: row.titulo || "Compromisso",
    TIPO_EVENTO: row.tipo_evento || "EVENTO",
    ID_CLIENTE: row.id_cliente || "",
    ID_FUNCIONARIO: row.id_funcionario || "",
    ID_SESSAO: row.id_sessao || "",
    DATA: row.data || "",
    HORA_INICIO: row.hora_inicio || "",
    HORA_FIM: row.hora_fim || "",
    LOCAL: row.local || "",
    DESCRICAO: row.descricao || "",
    CONVIDADOS: row.convidados || "",
    STATUS: row.status || "AGENDADO",
    DATA_CADASTRO: row.data_cadastro || "",
    DATA_ATUALIZACAO: row.data_atualizacao || "",
    USUARIO_CADASTRO: row.usuario_cadastro || ""
  };
}

async function agendaBuscarPorIdWeb_(id) {
  const r = await db.query(
    `SELECT *
     FROM agenda
     WHERE agenda_id=$1 OR id::text=$1
     LIMIT 1`,
    [String(id || "").trim()]
  );

  return r.rows[0] || null;
}

router.get("/modulo", async (req, res) => {
  try {
    const periodoDias = Math.max(
      1,
      Math.min(
        365,
        Number(req.query.periodoDias || 30)
      )
    );

    const [agendaR, clientesR, funcionariosR] = await Promise.all([
      db.query(
        `SELECT *
         FROM agenda
         WHERE
           UPPER(COALESCE(status,'AGENDADO')) <> 'CANCELADO'
           AND (data IS NULL OR data >= CURRENT_DATE)
           AND (
             data IS NULL
             OR data <= CURRENT_DATE + ($1::int * INTERVAL '1 day')
           )
         ORDER BY data ASC NULLS LAST, hora_inicio ASC NULLS LAST, id ASC`,
        [periodoDias]
      ),

      db.query(
        `SELECT id_cliente,nome_completo,email
         FROM clientes
         WHERE
           COALESCE(ativo,TRUE)=TRUE
           AND UPPER(COALESCE(status_cliente,'ATIVO')) <> 'INATIVO'
         ORDER BY nome_completo ASC`
      ),

      db.query(
        `SELECT funcionario_id,nome_completo,email
         FROM funcionarios
         WHERE UPPER(COALESCE(status,'ATIVO'))='ATIVO'
         ORDER BY nome_completo ASC`
      )
    ]);

    return res.json({
      sucesso: true,
      fonte: "API_POSTGRESQL",
      agenda: {
        eventos: agendaR.rows.map(agendaDtoWeb_),
        periodoDias
      },
      clientes: clientesR.rows.map(x => ({
        ID_CLIENTE: x.id_cliente || "",
        NOME_COMPLETO: x.nome_completo || "",
        EMAIL: x.email || ""
      })),
      funcionarios: funcionariosR.rows.map(x => ({
        FUNCIONARIO_ID: x.funcionario_id || "",
        NOME_COMPLETO: x.nome_completo || "",
        EMAIL: x.email || ""
      }))
    });

  } catch (erro) {
    console.error("agendaWeb/modulo:", erro);

    return res.status(500).json({
      erro: "Erro ao carregar Agenda",
      detalhe: erro?.message || null
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const d = req.body || {};

    const titulo = pegar(d,"TITULO");
    const data = pegar(d,"DATA");

    if (!titulo) {
      return res.status(400).json({
        erro: "O título do compromisso é obrigatório."
      });
    }

    if (!data) {
      return res.status(400).json({
        erro: "A data do compromisso é obrigatória."
      });
    }

    const seq = await db.query(
      `SELECT nextval(pg_get_serial_sequence('agenda','id'))::bigint AS id`
    );

    const idNumerico = Number(seq.rows[0].id);
    const agendaId = `AGE${String(idNumerico).padStart(6,"0")}`;

    const r = await db.query(
      `INSERT INTO agenda
       (
         id,agenda_id,titulo,tipo_evento,id_cliente,id_funcionario,id_sessao,
         data,hora_inicio,hora_fim,local,descricao,convidados,status,
         data_cadastro,data_atualizacao,usuario_cadastro
       )
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW(),$15)
       RETURNING *`,
      [
        idNumerico,
        agendaId,
        titulo,
        pegar(d,"TIPO_EVENTO") || "REUNIAO",
        pegar(d,"ID_CLIENTE"),
        pegar(d,"ID_FUNCIONARIO"),
        pegar(d,"ID_SESSAO"),
        data,
        pegar(d,"HORA_INICIO"),
        pegar(d,"HORA_FIM"),
        pegar(d,"LOCAL"),
        pegar(d,"DESCRICAO"),
        pegar(d,"CONVIDADOS"),
        pegar(d,"STATUS") || "AGENDADO",
        req.usuarioCrm?.email ||
          req.usuarioCrm?.login ||
          req.usuarioCrm?.id ||
          "SISTEMA"
      ]
    );

    return res.status(201).json({
      sucesso: true,
      mensagem: "Compromisso salvo no AVANTE CX.",
      sincronizadoGoogle: false,
      evento: agendaDtoWeb_(r.rows[0])
    });

  } catch (erro) {
    console.error("agendaWeb POST:", erro);

    return res.status(500).json({
      erro:
        "Erro ao salvar compromisso: " +
        (erro?.message || "erro interno")
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const atual =
      await agendaBuscarPorIdWeb_(
        req.params.id
      );

    if (!atual) {
      return res.status(404).json({
        erro: "Compromisso não encontrado."
      });
    }

    const d = req.body || {};

    const r = await db.query(
      `UPDATE agenda SET
         titulo=COALESCE($1,titulo),
         tipo_evento=COALESCE($2,tipo_evento),
         id_cliente=$3,
         id_funcionario=$4,
         id_sessao=COALESCE($5,id_sessao),
         data=COALESCE($6,data),
         hora_inicio=$7,
         hora_fim=$8,
         local=$9,
         descricao=$10,
         convidados=$11,
         status=COALESCE($12,status),
         data_atualizacao=NOW()
       WHERE id=$13
       RETURNING *`,
      [
        pegar(d,"TITULO"),
        pegar(d,"TIPO_EVENTO"),
        pegar(d,"ID_CLIENTE"),
        pegar(d,"ID_FUNCIONARIO"),
        pegar(d,"ID_SESSAO"),
        pegar(d,"DATA"),
        pegar(d,"HORA_INICIO"),
        pegar(d,"HORA_FIM"),
        pegar(d,"LOCAL"),
        pegar(d,"DESCRICAO"),
        pegar(d,"CONVIDADOS"),
        pegar(d,"STATUS"),
        atual.id
      ]
    );

    return res.json({
      sucesso: true,
      mensagem: "Compromisso atualizado no AVANTE CX.",
      sincronizadoGoogle: false,
      evento: agendaDtoWeb_(r.rows[0])
    });

  } catch (erro) {
    console.error("agendaWeb PUT:", erro);

    return res.status(500).json({
      erro:
        "Erro ao atualizar compromisso: " +
        (erro?.message || "erro interno")
    });
  }
});

router.patch("/:id/cancelar", async (req, res) => {
  try {
    const atual =
      await agendaBuscarPorIdWeb_(
        req.params.id
      );

    if (!atual) {
      return res.status(404).json({
        erro: "Compromisso não encontrado."
      });
    }

    const r = await db.query(
      `UPDATE agenda
       SET status='CANCELADO',
           data_atualizacao=NOW()
       WHERE id=$1
       RETURNING *`,
      [atual.id]
    );

    return res.json({
      sucesso: true,
      mensagem: "Compromisso cancelado no AVANTE CX.",
      removidoGoogle: false,
      evento: agendaDtoWeb_(r.rows[0])
    });

  } catch (erro) {
    console.error("agendaWeb cancelar:", erro);

    return res.status(500).json({
      erro:
        "Erro ao cancelar compromisso: " +
        (erro?.message || "erro interno")
    });
  }
});

module.exports = router;
