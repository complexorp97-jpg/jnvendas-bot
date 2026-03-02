import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: "*" }));

// ================= CONFIG =================
const SITE_BASE = process.env.SITE_BASE || "https://complexorp97-jpg.github.io/jnvendas-site/";
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const MP_TOKEN = process.env.MP_ACCESS_TOKEN; // APP_USR-...
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

// ================= PATHS =================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================= EMAIL =================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

// ================= MONGO =================
let mongoClient;
let dbMongo;

async function getDb() {
  if (dbMongo) return dbMongo;
  if (!MONGODB_URI) throw new Error("MONGODB_URI não configurado");
  mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  dbMongo = mongoClient.db();
  await Promise.all([
    dbMongo.collection("stock").createIndex({ productId: 1, sold: 1 }),
    dbMongo.collection("purchases").createIndex({ token: 1 }, { unique: true }),
    dbMongo.collection("payments").createIndex({ paymentId: 1 }, { unique: true })
  ]);
  return dbMongo;
}

function novoToken() { return crypto.randomBytes(24).toString("hex"); }

// ================= ADMIN AUTH =================
function checkAdmin(req, res, next) {
  const key = req.headers["x-admin-key"] || "";
  if (!ADMIN_PASSWORD) return res.status(500).send("ADMIN_PASSWORD não configurado no Render");
  if (key !== ADMIN_PASSWORD) return res.status(401).send("Senha inválida");
  next();
}

// ================= HEALTH =================
app.get("/", (req, res) => { res.send("API online 🚀"); });

// ================= SERVE ADMIN =================
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin", "index.html"));
});

// ================= ADMIN APIs =================
app.get("/api/admin/stock", checkAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const ids = ["BRP1","BRP2","BRP3","BRP4","BRP5"];
    const resumo = {};
    await Promise.all(ids.map(async (id) => {
      resumo[id] = await db.collection("stock").countDocuments({ productId: id, sold: false });
    }));
    res.json({ ok:true, resumo });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"Erro carregando estoque" });
  }
});

app.post("/api/admin/stock/add", checkAdmin, async (req, res) => {
  try {
    const { productId, login, senha } = req.body || {};
    const ids = ["BRP1","BRP2","BRP3","BRP4","BRP5"];
    if (!ids.includes(productId)) return res.status(400).json({ ok:false, error:"Produto inválido" });
    if (!login || !senha) return res.status(400).json({ ok:false, error:"login e senha obrigatórios" });

    const db = await getDb();
    await db.collection("stock").insertOne({ productId, login, senha, sold:false, createdAt:new Date() });
    const total = await db.collection("stock").countDocuments({ productId, sold:false });
    res.json({ ok:true, total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"Erro adicionando estoque" });
  }
});

app.get("/api/admin/deliveries", checkAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const list = await db.collection("purchases").find({}, { projection:{ _id:0 } }).sort({ createdAt:-1 }).limit(50).toArray();
    res.json({ ok:true, list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"Erro carregando entregas" });
  }
});

// ================= WEBHOOK MERCADO PAGO =================
app.post("/api/mp/webhook", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id || req.query?.data_id || req.query?.id;
    if (!paymentId) return res.status(200).json({ ok:true });

    if (!MP_TOKEN) {
      console.log("MP_ACCESS_TOKEN não configurado");
      return res.status(200).json({ ok:true });
    }

    const db = await getDb();

    const already = await db.collection("payments").findOne({ paymentId: String(paymentId) });
    if (already) return res.status(200).json({ ok:true });

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` }
    });
    if (!mpRes.ok) {
      const t = await mpRes.text();
      console.log("Erro MP:", mpRes.status, t);
      return res.status(200).json({ ok:true });
    }

    const payment = await mpRes.json();
    if (payment.status !== "approved") return res.status(200).json({ ok:true });

    const buyerEmail = payment.payer?.email;
    if (!buyerEmail) return res.status(200).json({ ok:true });

    const productId =
      (payment.metadata?.productId ||
       payment.additional_info?.items?.[0]?.id ||
       payment.additional_info?.items?.[0]?.title ||
       "BRP1").toString().toUpperCase();

    const stockItem = await db.collection("stock").findOneAndUpdate(
      { productId, sold:false },
      { $set: { sold:true, soldTo:buyerEmail, soldAt:new Date(), paymentId:String(paymentId) } },
      { returnDocument: "after" }
    );

    if (!stockItem.value) {
      await db.collection("payments").insertOne({ paymentId:String(paymentId), status:"approved_no_stock", createdAt:new Date() });
      return res.status(200).json({ ok:true });
    }

    const token = novoToken();
    const deliveryLink = SITE_BASE.replace(/\/?$/, "/") + "entrega.html?token=" + token;

    const purchaseDoc = {
      token,
      email: buyerEmail,
      purchases: [{
        productId,
        account: { login: stockItem.value.login, senha: stockItem.value.senha },
        paymentId: String(paymentId)
      }],
      createdAt: new Date()
    };

    await db.collection("purchases").insertOne(purchaseDoc);
    await db.collection("payments").insertOne({ paymentId:String(paymentId), status:"approved_delivered", createdAt:new Date(), token });

    await transporter.sendMail({
      from: "JN VENDAS",
      to: buyerEmail,
      subject: "✅ Pagamento aprovado - JN VENDAS",
      html: `
        <h2>Pagamento aprovado ✅</h2>
        <p><b>Produto:</b> ${productId}</p>
        <p><a href="${deliveryLink}">${deliveryLink}</a></p>
        <p>Abra o link e toque no 📥 para ver sua conta.</p>
      `
    });

    res.status(200).json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(200).json({ ok:true });
  }
});

// ================= CONSULTAR COMPRAS =================
app.get("/api/purchases", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error:"Token obrigatório" });
    const db = await getDb();
    const data = await db.collection("purchases").findOne({ token:String(token) }, { projection:{ _id:0 } });
    if (!data) return res.status(404).json({ error:"Token inválido" });
    res.json({ email:data.email, purchases:data.purchases });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:"Erro consultando compras" });
  }
});

// ================= TESTE (SEM MP) =================
app.post("/api/test/approve", async (req, res) => {
  try {
    const { buyerEmail, productId } = req.body || {};
    if (!buyerEmail || !productId) return res.status(400).json({ error:"Dados inválidos" });

    const db = await getDb();
    const pid = String(productId).toUpperCase();

    const stockItem = await db.collection("stock").findOneAndUpdate(
      { productId: pid, sold:false },
      { $set: { sold:true, soldTo:buyerEmail, soldAt:new Date(), paymentId:"TEST" } },
      { returnDocument: "after" }
    );
    if (!stockItem.value) return res.status(400).json({ error:"Sem estoque" });

    const token = novoToken();
    const deliveryLink = SITE_BASE.replace(/\/?$/, "/") + "entrega.html?token=" + token;

    await db.collection("purchases").insertOne({
      token,
      email: buyerEmail,
      purchases: [{ productId: pid, account: { login: stockItem.value.login, senha: stockItem.value.senha }, paymentId:"TEST" }],
      createdAt: new Date()
    });

    await transporter.sendMail({
      from: "JN VENDAS",
      to: buyerEmail,
      subject: "✅ TESTE - Código liberado",
      html: `<h2>Teste de entrega ✅</h2><p><a href="${deliveryLink}">${deliveryLink}</a></p>`
    });

    res.json({ ok:true, deliveryLink });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:"Erro no teste" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando na porta " + PORT));
              
