const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../database/db");
const verificarToken = require("../middleware/auth");

const router = express.Router();

router.post("/criar-admin", async (req, res) => {
  try {
    const { nome, email, senha } = req.body;

    if (!nome || !email || !senha) {
      return res.status(400).json({
        erro: "Nome, email e senha são obrigatórios"
      });
    }

    const existente = await db.query(
      "SELECT id FROM usuarios WHERE email = $1",
      [email]
    );

    if (existente.rows.length > 0) {
      return res.status(409).json({
        erro: "Já existe um usuário com este email"
      });
    }

    const senhaHash = await bcrypt.hash(senha, 12);

    const resultado = await db.query(
      `
        INSERT INTO usuarios
        (nome, email, senha_hash, perfil)
        VALUES ($1, $2, $3, 'ADMIN')
        RETURNING id, nome, email, perfil, ativo
      `,
      [nome, email, senhaHash]
    );

    res.status(201).json({
      mensagem: "Administrador criado com sucesso",
      usuario: resultado.rows[0]
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao criar administrador"
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({
        erro: "Email e senha são obrigatórios"
      });
    }

    const resultado = await db.query(
      `
        SELECT
          id,
          nome,
          email,
          senha_hash,
          perfil,
          ativo
        FROM usuarios
        WHERE email = $1
        LIMIT 1
      `,
      [email]
    );

    if (resultado.rows.length === 0) {
      return res.status(401).json({
        erro: "Email ou senha inválidos"
      });
    }

    const usuario = resultado.rows[0];

    if (!usuario.ativo) {
      return res.status(403).json({
        erro: "Usuário inativo"
      });
    }

    const senhaCorreta = await bcrypt.compare(
      senha,
      usuario.senha_hash
    );

    if (!senhaCorreta) {
      return res.status(401).json({
        erro: "Email ou senha inválidos"
      });
    }

    const token = jwt.sign(
      {
        id: usuario.id,
        email: usuario.email,
        perfil: usuario.perfil
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "8h"
      }
    );

    res.json({
      mensagem: "Login realizado com sucesso",
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.perfil
      },
      token
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao realizar login"
    });
  }
});

router.get("/me", verificarToken, async (req, res) => {
  try {
    const resultado = await db.query(
      `
        SELECT
          id,
          nome,
          email,
          perfil,
          ativo,
          criado_em
        FROM usuarios
        WHERE id = $1
        LIMIT 1
      `,
      [req.usuario.id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({
        erro: "Usuário não encontrado"
      });
    }

    const usuario = resultado.rows[0];

    if (!usuario.ativo) {
      return res.status(403).json({
        erro: "Usuário inativo"
      });
    }

    res.json({
      usuario
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      erro: "Erro ao buscar usuário"
    });
  }
});

module.exports = router;