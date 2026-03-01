import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import crypto from "crypto";

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

// ================= CONFIG =================
const SITE_BASE = process.env.SITE_BASE || "https://complexorp97-jpg.github.io/jnvendas-site/";
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

// ================= EMAIL =================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

// ================= BANCO SIMPLES =================
const db = {
  tokens: new Map(), // token -> { email, purchases:[{productId, code}] }
};

// ================= GERAR CÓDIGO =================
function gerarCodigo(produto) {
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${produto}-${random}`;
}

// ================= CRIAR TOKEN =================
function novoToken() {
  return crypto.randomBytes(24).toString("hex");
}

// ================= HEALTH =================
app.get("/", (req, res) => {
  res.send("API online 🚀");
});

// =======================================================
// 🔹 WEBHOOK MERCADO PAGO
// Configure no MP:
// https://SEUBOT.onrender.com/api/mp/webhook
// =======================================================
app.post("/api/mp/webhook", async (req, res) => {
  try {
    const { status, buyerEmail, productId } = req.body;

    if (status !== "approved") {
      return res.json({ ok: true });
    }

    if (!buyerEmail || !productId) {
      return res.status(400).json({ error: "Dados inválidos" });
    }

    const token = novoToken();
    const code = gerarCodigo(productId);

    db.tokens.set(token, {
      email: buyerEmail,
      purchases: [
        {
          productId,
          code
        }
      ],
      createdAt: new Date()
    });

    const deliveryLink = SITE_BASE + "entrega.html?token=" + token;

    await transporter.sendMail({
      from: "JN VENDAS",
      to: buyerEmail,
      subject: "✅ Pagamento aprovado - JN VENDAS",
      html: `
        <h2>Pagamento aprovado ✅</h2>
        <p>Seu código foi liberado!</p>
        <p><a href="${deliveryLink}">${deliveryLink}</a></p>
        <p>Abra o link e toque no 📥 para ver seu código.</p>
      `
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro no webhook" });
  }
});

// =======================================================
// 🔹 CONSULTAR COMPRAS
// =======================================================
app.get("/api/purchases", (req, res) => {
  const token = req.query.token;

  if (!token) {
    return res.status(400).json({ error: "Token obrigatório" });
  }

  const data = db.tokens.get(token);

  if (!data) {
    return res.status(404).json({ error: "Token inválido" });
  }

  res.json({
    email: data.email,
    purchases: data.purchases
  });
});

// =======================================================
// 🔹 ROTA DE TESTE (SEM MERCADO PAGO)
// =======================================================
app.post("/api/test/approve", async (req, res) => {
  try {
    const { buyerEmail, productId } = req.body;

    if (!buyerEmail || !productId) {
      return res.status(400).json({ error: "Dados inválidos" });
    }

    const token = novoToken();
    const code = gerarCodigo(productId);

    db.tokens.set(token, {
      email: buyerEmail,
      purchases: [
        {
          productId,
          code
        }
      ],
      createdAt: new Date()
    });

    const deliveryLink = SITE_BASE + "entrega.html?token=" + token;

    await transporter.sendMail({
      from: "JN VENDAS",
      to: buyerEmail,
      subject: "✅ TESTE - Código liberado",
      html: `
        <h2>Teste de entrega ✅</h2>
        <p>Link:</p>
        <p><a href="${deliveryLink}">${deliveryLink}</a></p>
      `
    });

    res.json({ ok: true, deliveryLink });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro no teste" });
  }
});

// =======================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
