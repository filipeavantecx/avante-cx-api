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


// ======================================================
// GOOGLE CALENDAR - REST NATIVO (SEM googleapis)
// Railway env:
// GOOGLE_SERVICE_ACCOUNT_EMAIL
// GOOGLE_PRIVATE_KEY
// GOOGLE_CALENDAR_ID
// GOOGLE_CALENDAR_TIMEZONE (opcional, padrão America/Bahia)
// ======================================================

function googleCalendarConfig_() {
  return {
    email: String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim(),
    privateKey: String(process.env.GOOGLE_PRIVATE_KEY || "")
      .replace(/\\n/g, "\n")
      .trim(),
    calendarId: String(process.env.GOOGLE_CALENDAR_ID || "").trim(),
    timeZone:
      String(process.env.GOOGLE_CALENDAR_TIMEZONE || "").trim() ||
      "America/Bahia"
  };
}

function base64Url_(valor) {
  return Buffer
    .from(valor)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function googleAccessToken_() {
  const cfg = googleCalendarConfig_();

  if (!cfg.email || !cfg.privateKey || !cfg.calendarId) {
    throw new Error(
      "Google Calendar não configurado no Railway."
    );
  }

  const agora = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const claim = {
    iss: cfg.email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: agora,
    exp: agora + 3600
  };

  const parte1 = base64Url_(JSON.stringify(header));
  const parte2 = base64Url_(JSON.stringify(claim));
  const unsigned = `${parte1}.${parte2}`;

  const assinatura = crypto.sign(
    "RSA-SHA256",
    Buffer.from(unsigned),
    cfg.privateKey
  );

  const assertion =
    `${unsigned}.${base64Url_(assinatura)}`;

  const resposta = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },
      body:
        "grant_type=" +
        encodeURIComponent(
          "urn:ietf:params:oauth:grant-type:jwt-bearer"
        ) +
        "&assertion=" +
        encodeURIComponent(assertion)
    }
  );

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok || !dados.access_token) {
    throw new Error(
      dados.error_description ||
      dados.error ||
      "Falha ao autenticar no Google Calendar."
    );
  }

  return dados.access_token;
}

function googleDataHora_(data, hora) {
  let d = "";

  if (data instanceof Date) {
    d = data.toISOString().slice(0, 10);
  } else {
    const textoData = String(data || "").trim();

    const iso = textoData.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) {
      d = iso[1];
    } else {
      const br = textoData.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (br) {
        d = `${br[3]}-${br[2]}-${br[1]}`;
      }
    }
  }

  if (!d) {
    throw new Error("Data inválida para sincronização com Google Calendar.");
  }

  let h = String(hora || "00:00").trim();

  const matchHora = h.match(/^(\d{1,2}):(\d{2})/);
  if (!matchHora) {
    throw new Error("Hora inválida para sincronização com Google Calendar.");
  }

  const hh = String(Number(matchHora[1])).padStart(2, "0");
  const mm = matchHora[2];

  return `${d}T${hh}:${mm}:00`;
}

function googleEventoBody_(d) {
  const cfg = googleCalendarConfig_();

  const convidados =
    String(pegar(d, "CONVIDADOS") || "")
      .split(/[;,]/)
      .map(x => x.trim())
      .filter(Boolean)
      .filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))
      .map(email => ({ email }));

  const inicio =
    googleDataHora_(
      pegar(d, "DATA"),
      pegar(d, "HORA_INICIO") || "09:00"
    );

  let fimHora =
    pegar(d, "HORA_FIM") ||
    pegar(d, "HORA_INICIO") ||
    "10:00";

  if (
    String(fimHora) ===
    String(pegar(d, "HORA_INICIO") || "")
  ) {
    const [hh, mm] =
      String(fimHora || "09:00")
        .split(":")
        .map(Number);

    const minutos =
      (hh * 60 + mm + 60) % (24 * 60);

    fimHora =
      String(Math.floor(minutos / 60)).padStart(2, "0") +
      ":" +
      String(minutos % 60).padStart(2, "0");
  }

  const fim =
    googleDataHora_(
      pegar(d, "DATA"),
      fimHora
    );

  return {
    summary:
      pegar(d, "TITULO") ||
      "Compromisso AVANTE CX",
    location:
      pegar(d, "LOCAL") ||
      undefined,
    description:
      pegar(d, "DESCRICAO") ||
      undefined,
    start: {
      dateTime: inicio,
      timeZone: cfg.timeZone
    },
    end: {
      dateTime: fim,
      timeZone: cfg.timeZone
    },
    attendees:
      convidados.length
        ? convidados
        : undefined
  };
}

async function googleCalendarRequest_(metodo, caminho, body) {
  const cfg = googleCalendarConfig_();
  const token = await googleAccessToken_();

  const url =
    "https://www.googleapis.com/calendar/v3/calendars/" +
    encodeURIComponent(cfg.calendarId) +
    caminho;

  const resposta = await fetch(
    url,
    {
      method: metodo,
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body:
        body === undefined
          ? undefined
          : JSON.stringify(body)
    }
  );

  let dados = {};

  if (resposta.status !== 204) {
    dados =
      await resposta
        .json()
        .catch(() => ({}));
  }

  if (!resposta.ok) {
    const erroGoogle = new Error(
      dados?.error?.message ||
      "Falha no Google Calendar."
    );

    erroGoogle.statusGoogle = resposta.status;
    erroGoogle.detalheGoogle = dados?.error || null;

    throw erroGoogle;
  }

  return dados;
}

async function criarEventoGoogleNode_(d) {
  return googleCalendarRequest_(
    "POST",
    "/events?sendUpdates=all",
    googleEventoBody_(d)
  );
}

async function atualizarEventoGoogleNode_(eventId, d) {
  return googleCalendarRequest_(
    "PATCH",
    "/events/" +
      encodeURIComponent(eventId) +
      "?sendUpdates=all",
    googleEventoBody_(d)
  );
}

async function removerEventoGoogleNode_(eventId) {
  return googleCalendarRequest_(
    "DELETE",
    "/events/" +
      encodeURIComponent(eventId) +
      "?sendUpdates=all"
  );
}

router.get("/google-status", async (req, res) => {
  try {
    const cfg = googleCalendarConfig_();

    if (!cfg.email || !cfg.privateKey || !cfg.calendarId) {
      return res.json({
        sucesso: true,
        conectado: false,
        configurado: false,
        mensagem:
          "Google Calendar ainda não configurado no Railway."
      });
    }

    await googleCalendarRequest_(
      "GET",
      "?maxResults=1"
    );

    return res.json({
      sucesso: true,
      conectado: true,
      configurado: true,
      calendarId: cfg.calendarId,
      mensagem:
        "Google Calendar conectado ao AVANTE CX."
    });

  } catch (erro) {
    return res.status(502).json({
      sucesso: false,
      conectado: false,
      configurado: true,
      erro:
        erro?.message ||
        "Falha ao conectar Google Calendar."
    });
  }
});


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

    let row = r.rows[0];
    let sincronizadoGoogle = false;
    let avisoGoogle = "";

    try {
      const google =
        await criarEventoGoogleNode_(d);

      const atualizado =
        await db.query(
          `UPDATE agenda
           SET google_event_id=$1,
               calendar_id=$2,
               data_atualizacao=NOW()
           WHERE id=$3
           RETURNING *`,
          [
            google.id || null,
            googleCalendarConfig_().calendarId,
            row.id
          ]
        );

      row = atualizado.rows[0] || row;
      sincronizadoGoogle = !!google.id;

    } catch (erroGoogle) {
      avisoGoogle =
        erroGoogle?.message ||
        "Compromisso salvo, mas não sincronizado com Google Calendar.";

      console.warn(
        "Agenda salva sem sincronização Google:",
        avisoGoogle
      );
    }

    return res.status(201).json({
      sucesso: true,
      mensagem:
        sincronizadoGoogle
          ? "Compromisso salvo no AVANTE CX e sincronizado com Google Calendar."
          : "Compromisso salvo no AVANTE CX.",
      sincronizadoGoogle,
      avisoGoogle,
      evento: agendaDtoWeb_(row)
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
    const atual = await agendaBuscarPorIdWeb_(req.params.id);

    if (!atual) {
      return res.status(404).json({ erro: "Compromisso não encontrado." });
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

    let row = r.rows[0];

    const payloadGoogle = {
      TITULO: row.titulo,
      TIPO_EVENTO: row.tipo_evento,
      ID_CLIENTE: row.id_cliente,
      ID_FUNCIONARIO: row.id_funcionario,
      DATA: row.data,
      HORA_INICIO: row.hora_inicio,
      HORA_FIM: row.hora_fim,
      LOCAL: row.local,
      DESCRICAO: row.descricao,
      CONVIDADOS: row.convidados
    };

    let sincronizadoGoogle = false;
    let avisoGoogle = "";
    let recriadoGoogle = false;

    try {
      if (row.google_event_id) {
        try {
          await atualizarEventoGoogleNode_(row.google_event_id, payloadGoogle);
          sincronizadoGoogle = true;
        } catch (erroAtualizacaoGoogle) {
          if ([404,410].includes(Number(erroAtualizacaoGoogle?.statusGoogle))) {
            const googleNovo = await criarEventoGoogleNode_(payloadGoogle);

            if (googleNovo?.id) {
              const atualizadoGoogle = await db.query(
                `UPDATE agenda
                 SET google_event_id=$1,
                     calendar_id=$2,
                     data_atualizacao=NOW()
                 WHERE id=$3
                 RETURNING *`,
                [googleNovo.id, googleCalendarConfig_().calendarId, row.id]
              );

              row = atualizadoGoogle.rows[0] || row;
              sincronizadoGoogle = true;
              recriadoGoogle = true;
            }
          } else {
            throw erroAtualizacaoGoogle;
          }
        }
      } else {
        const googleNovo = await criarEventoGoogleNode_(payloadGoogle);

        if (googleNovo?.id) {
          const atualizadoGoogle = await db.query(
            `UPDATE agenda
             SET google_event_id=$1,
                 calendar_id=$2,
                 data_atualizacao=NOW()
             WHERE id=$3
             RETURNING *`,
            [googleNovo.id, googleCalendarConfig_().calendarId, row.id]
          );

          row = atualizadoGoogle.rows[0] || row;
          sincronizadoGoogle = true;
          recriadoGoogle = true;
        }
      }
    } catch (erroGoogle) {
      avisoGoogle = erroGoogle?.message || "Evento atualizado no CRM, mas não no Google Calendar.";

      console.warn("Atualização Google Agenda falhou:", {
        agendaId: row?.agenda_id || "",
        googleEventId: row?.google_event_id || "",
        statusGoogle: erroGoogle?.statusGoogle || null,
        erro: avisoGoogle
      });
    }

    return res.json({
      sucesso: true,
      mensagem: sincronizadoGoogle
        ? (recriadoGoogle
            ? "Compromisso atualizado no AVANTE CX e recriado/sincronizado no Google Calendar."
            : "Compromisso atualizado no AVANTE CX e no Google Calendar.")
        : ("Compromisso atualizado no AVANTE CX." +
           (avisoGoogle ? " Google Calendar: " + avisoGoogle : "")),
      sincronizadoGoogle,
      recriadoGoogle,
      avisoGoogle,
      evento: agendaDtoWeb_(row)
    });

  } catch (erro) {
    console.error("agendaWeb PUT:", erro);

    return res.status(500).json({
      erro: "Erro ao atualizar compromisso: " + (erro?.message || "erro interno")
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

    const row = r.rows[0];
    let removidoGoogle = false;
    let avisoGoogle = "";

    try {
      if (row.google_event_id) {
        await removerEventoGoogleNode_(
          row.google_event_id
        );

        removidoGoogle = true;
      }
    } catch (erroGoogle) {
      avisoGoogle =
        erroGoogle?.message ||
        "Compromisso cancelado no CRM, mas não removido do Google Calendar.";

      console.warn(
        "Cancelamento Google Agenda falhou:",
        avisoGoogle
      );
    }

    return res.json({
      sucesso: true,
      mensagem:
        removidoGoogle
          ? "Compromisso cancelado no AVANTE CX e removido do Google Calendar."
          : "Compromisso cancelado no AVANTE CX.",
      removidoGoogle,
      avisoGoogle,
      evento: agendaDtoWeb_(row)
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
