const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../database/db");

const router = express.Router();

router.post("/criar-admin", async (req, res) => {
  try {
    const {
      nome,
      email,
      senha
    } = req.body;

    const senhaHash = await bcrypt.hash(senha, 12);

    const resultado = await db.query(
      `
        INSERT INTO usuarios
        (
          nome,
          email,
          senha_hash,
          perfil
        )
        VALUES ($1, $2, $3, 'ADMIN')
        RETURNING id, nome, email, perfil, ativo
      `,
      [
        nome,
        email,
        senhaHash
      ]
    );

    res.status(201).json({
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