const express = require("express");
const db = require("../database/db");
const verificarToken = require("../middleware/auth");

const router = express.Router();

router.use(verificarToken);


// ======================================================
// HELPERS
// ======================================================

function valorOuNull(valor) {
  if (
    valor === undefined ||
    valor === null ||
    valor === ""
  ) {
    return null;
  }

  return valor;
}

function numeroOuNull(valor) {
  if (
    valor === undefined ||
    valor === null ||
    valor === ""
  ) {
    return null;
  }

  const numero = Number(valor);

  return Number.isFinite(numero)
    ? numero
    : null;
}

function booleanOuPadrao(
  valor,
  padrao = true
) {
  if (
    valor === undefined ||
    valor === null ||
    valor === ""
  ) {
    return padrao;
  }

  if (typeof valor === "boolean") {
    return valor;
  }

  const texto = String(valor)
    .trim()
    .toLowerCase();

  if (
    [
      "false",
      "0",
      "nao",
      "não",
      "n",
      "inativo"
    ].includes(texto)
  ) {
    return false;
  }

  if (
    [
      "true",
      "1",
      "sim",
      "s",
      "ativo"
    ].includes(texto)
  ) {
    return true;
  }

  return padrao;
}

function montarBanco(body = {}) {
  return {
    banco_id:
      valorOuNull(
        body.BANCO_ID ??
        body.banco_id
      ),

    nome:
      valorOuNull(
        body.NOME ??
        body.nome
      ),

    instituicao:
      valorOuNull(
        body.INSTITUICAO ??
        body.instituicao
      ),

    tipo_conta:
      valorOuNull(
        body.TIPO_CONTA ??
        body.tipo_conta
      ),

    agencia:
      valorOuNull(
        body.AGENCIA ??
        body.agencia
      ),

    conta:
      valorOuNull(
        body.CONTA ??
        body.conta
      ),

    pix:
      valorOuNull(
        body.PIX ??
        body.pix
      ),

    saldo_inicial:
      numeroOuNull(
        body.SALDO_INICIAL ??
        body.saldo_inicial
      ) ?? 0,

    ativo:
      booleanOuPadrao(
        body.ATIVO ??
        body.ativo,
        true
      ),

    observacoes:
      valorOuNull(
        body.OBSERVACOES ??
        body.observacoes
      ),

    data_cadastro:
      valorOuNull(
        body.DATA_CADASTRO ??
        body.data_cadastro
      ),

    data_atualizacao:
      valorOuNull(
        body.DATA_ATUALIZACAO ??
        body.data_atualizacao
      )
  };
}


// ======================================================
// LISTAR BANCOS
// ======================================================

router.get("/bancos-financeiro", async (req, res) => {
  try {
    const resultado = await db.query(`
      SELECT *
      FROM bancos_financeiro
      ORDER BY nome ASC, id ASC
    `);

    res.json({
      total: resultado.rows.length,
      bancos_financeiro: resultado.rows
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao listar bancos financeiros"
    });
  }
});


// ======================================================
// BUSCAR BANCO
// ======================================================

router.get(
  "/bancos-financeiro/:id",
  async (req, res) => {
    try {
      const resultado = await db.query(
        `
          SELECT *
          FROM bancos_financeiro
          WHERE
            id::text = $1
            OR banco_id = $1
          LIMIT 1
        `,
        [req.params.id]
      );

      if (!resultado.rows.length) {
        return res.status(404).json({
          erro: "Banco não encontrado"
        });
      }

      res.json({
        banco: resultado.rows[0]
      });

    } catch (erro) {
      console.error(erro);

      res.status(500).json({
        erro: "Erro ao buscar banco"
      });
    }
  }
);


// ======================================================
// IMPORTAR BANCOS
// ======================================================

router.post(
  "/bancos-financeiro/importar",
  async (req, res) => {
    try {
      const bancos =
        req.body.bancos_financeiro;

      if (
        !Array.isArray(bancos) ||
        bancos.length === 0
      ) {
        return res.status(400).json({
          erro:
            "Envie bancos_financeiro como array"
        });
      }

      let inseridos = 0;
      let atualizados = 0;
      let ignorados = 0;

      const erros = [];

      for (const item of bancos) {
        try {
          const dados =
            montarBanco(item);

          if (!dados.banco_id) {
            ignorados++;

            erros.push({
              banco_id: null,
              erro:
                "BANCO_ID não informado"
            });

            continue;
          }

          const existente =
            await db.query(
              `
                SELECT id
                FROM bancos_financeiro
                WHERE banco_id = $1
                LIMIT 1
              `,
              [dados.banco_id]
            );

          if (existente.rows.length) {
            await db.query(
              `
                UPDATE bancos_financeiro
                SET
                  nome = $1,
                  instituicao = $2,
                  tipo_conta = $3,
                  agencia = $4,
                  conta = $5,
                  pix = $6,
                  saldo_inicial = $7,
                  ativo = $8,
                  observacoes = $9,
                  data_cadastro =
                    COALESCE(
                      $10,
                      data_cadastro
                    ),
                  data_atualizacao =
                    COALESCE(
                      $11,
                      NOW()
                    ),
                  atualizado_em = NOW()
                WHERE id = $12
              `,
              [
                dados.nome,
                dados.instituicao,
                dados.tipo_conta,
                dados.agencia,
                dados.conta,
                dados.pix,
                dados.saldo_inicial,
                dados.ativo,
                dados.observacoes,
                dados.data_cadastro,
                dados.data_atualizacao,
                existente.rows[0].id
              ]
            );

            atualizados++;
          } else {
            await db.query(
              `
                INSERT INTO bancos_financeiro
                (
                  banco_id,
                  nome,
                  instituicao,
                  tipo_conta,
                  agencia,
                  conta,
                  pix,
                  saldo_inicial,
                  ativo,
                  observacoes,
                  data_cadastro,
                  data_atualizacao
                )
                VALUES
                (
                  $1,$2,$3,$4,$5,$6,
                  $7,$8,$9,$10,$11,$12
                )
              `,
              [
                dados.banco_id,
                dados.nome,
                dados.instituicao,
                dados.tipo_conta,
                dados.agencia,
                dados.conta,
                dados.pix,
                dados.saldo_inicial,
                dados.ativo,
                dados.observacoes,
                dados.data_cadastro ||
                  new Date(),
                dados.data_atualizacao ||
                  new Date()
              ]
            );

            inseridos++;
          }

        } catch (erroBanco) {
          erros.push({
            banco_id:
              item.BANCO_ID ??
              item.banco_id ??
              null,

            erro:
              erroBanco.message
          });
        }
      }

      res.json({
        modulo:
          "BANCOS_FINANCEIRO",

        total_recebidos:
          bancos.length,

        inseridos,
        atualizados,
        ignorados,
        erros
      });

    } catch (erro) {
      console.error(erro);

      res.status(500).json({
        erro:
          "Erro ao importar bancos financeiros"
      });
    }
  }
);


// ======================================================
// CADASTRAR BANCO
// ======================================================

router.post(
  "/bancos-financeiro",
  async (req, res) => {
    try {
      const dados =
        montarBanco(req.body);

      if (!dados.banco_id) {
        return res.status(400).json({
          erro:
            "BANCO_ID é obrigatório"
        });
      }

      const existente =
        await db.query(
          `
            SELECT id
            FROM bancos_financeiro
            WHERE banco_id = $1
            LIMIT 1
          `,
          [dados.banco_id]
        );

      if (existente.rows.length) {
        return res.status(409).json({
          erro:
            "Já existe um banco com este BANCO_ID"
        });
      }

      const resultado =
        await db.query(
          `
            INSERT INTO bancos_financeiro
            (
              banco_id,
              nome,
              instituicao,
              tipo_conta,
              agencia,
              conta,
              pix,
              saldo_inicial,
              ativo,
              observacoes,
              data_cadastro,
              data_atualizacao
            )
            VALUES
            (
              $1,$2,$3,$4,$5,$6,
              $7,$8,$9,$10,$11,$12
            )
            RETURNING *
          `,
          [
            dados.banco_id,
            dados.nome,
            dados.instituicao,
            dados.tipo_conta,
            dados.agencia,
            dados.conta,
            dados.pix,
            dados.saldo_inicial,
            dados.ativo,
            dados.observacoes,
            dados.data_cadastro ||
              new Date(),
            dados.data_atualizacao ||
              new Date()
          ]
        );

      res.status(201).json({
        mensagem:
          "Banco cadastrado com sucesso",

        banco:
          resultado.rows[0]
      });

    } catch (erro) {
      console.error(erro);

      res.status(500).json({
        erro:
          "Erro ao cadastrar banco"
      });
    }
  }
);


// ======================================================
// ATUALIZAR BANCO
// ======================================================

router.put(
  "/bancos-financeiro/:id",
  async (req, res) => {
    try {
      const dados =
        montarBanco(req.body);

      const resultado =
        await db.query(
          `
            UPDATE bancos_financeiro
            SET
              nome = $1,
              instituicao = $2,
              tipo_conta = $3,
              agencia = $4,
              conta = $5,
              pix = $6,
              saldo_inicial = $7,
              ativo = $8,
              observacoes = $9,
              data_atualizacao = NOW(),
              atualizado_em = NOW()
            WHERE
              id::text = $10
              OR banco_id = $10
            RETURNING *
          `,
          [
            dados.nome,
            dados.instituicao,
            dados.tipo_conta,
            dados.agencia,
            dados.conta,
            dados.pix,
            dados.saldo_inicial,
            dados.ativo,
            dados.observacoes,
            req.params.id
          ]
        );

      if (!resultado.rows.length) {
        return res.status(404).json({
          erro:
            "Banco não encontrado"
        });
      }

      res.json({
        mensagem:
          "Banco atualizado com sucesso",

        banco:
          resultado.rows[0]
      });

    } catch (erro) {
      console.error(erro);

      res.status(500).json({
        erro:
          "Erro ao atualizar banco"
      });
    }
  }
);


// ======================================================
// RESUMO / VALIDAÇÃO FINANCEIRA
// ======================================================

router.get(
  "/financeiro/resumo-migracao",
  async (req, res) => {
    try {
      const [
        bancos,
        receber,
        pagar,
        fluxo,
        comissoes
      ] = await Promise.all([
        db.query(
          "SELECT COUNT(*)::int AS total FROM bancos_financeiro"
        ),
        db.query(
          "SELECT COUNT(*)::int AS total FROM contas_receber"
        ),
        db.query(
          "SELECT COUNT(*)::int AS total FROM contas_pagar"
        ),
        db.query(
          "SELECT COUNT(*)::int AS total FROM fluxo_caixa"
        ),
        db.query(
          "SELECT COUNT(*)::int AS total FROM comissoes"
        )
      ]);

      res.json({
        financeiro: {
          bancos_financeiro:
            bancos.rows[0].total,

          contas_receber:
            receber.rows[0].total,

          contas_pagar:
            pagar.rows[0].total,

          fluxo_caixa:
            fluxo.rows[0].total,

          comissoes:
            comissoes.rows[0].total
        }
      });

    } catch (erro) {
      console.error(erro);

      res.status(500).json({
        erro:
          "Erro ao gerar resumo financeiro"
      });
    }
  }
);


module.exports = router;
