const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../database/db");

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

module.exports = router;