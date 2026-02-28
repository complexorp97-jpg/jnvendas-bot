import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "SEUEMAIL@gmail.com",
    pass: "SENHA_DE_APP"
  }
});

const contas = {
  BRP1: { email: "conta1@email.com", senha: "123456" },
  BRP2: { email: "conta2@email.com", senha: "123456" },
  BRP3: { email: "conta3@email.com", senha: "123456" },
  BRP4: { email: "conta4@email.com", senha: "123456" },
  BRP5: { email: "conta5@email.com", senha: "123456" }
};

app.post("/pagamento-aprovado", async (req, res) => {
  const { produto, compradorEmail } = req.body;

  const conta = contas[produto];

  if (!conta) {
    return res.status(400).json({ erro: "Produto inválido" });
  }

  try {
    await transporter.sendMail({
      from: "JN VENDAS",
      to: compradorEmail,
      subject: "Sua conta BRP foi entregue!",
      html: `
        <h2>Pagamento aprovado ✅</h2>
        <p>Email: ${conta.email}</p>
        <p>Senha: ${conta.senha}</p>
      `
    });

    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ erro: "Erro ao enviar email" });
  }
});

app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});
