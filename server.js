app.post("/api/mp/webhook", async (req, res) => {
  try {
    // MP pode mandar por body ou por query
    const paymentId =
      req.body?.data?.id ||
      req.query?.data_id ||
      req.query?.id;

    if (!paymentId) return res.status(200).json({ ok: true });

    const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
    if (!MP_TOKEN) return res.status(500).json({ error: "MP_ACCESS_TOKEN não configurado" });

    // Busca o pagamento real no Mercado Pago
    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` }
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.log("MP fetch erro:", resp.status, txt);
      return res.status(200).json({ ok: true });
    }

    const payment = await resp.json();

    // Só libera quando aprovado
    if (payment.status !== "approved") return res.status(200).json({ ok: true });

    // Email do comprador
    const buyerEmail = payment.payer?.email;
    if (!buyerEmail) return res.status(200).json({ ok: true });

    // 🔥 Como pegar o productId?
    // Você precisa colocar um identificador no pagamento quando criar a preferência.
    // Aqui vamos tentar achar:
    let productId =
      payment.metadata?.productId ||
      payment.additional_info?.items?.[0]?.id ||
      payment.additional_info?.items?.[0]?.title;

    if (!productId) productId = "PRODUTO";

    // Evita duplicar se o MP mandar o mesmo evento mais de uma vez
    const already = db.tokens.get(String(paymentId));
    if (already) return res.status(200).json({ ok: true });

    const token = novoToken();
    const code = gerarCodigo(productId);

    // Guarda pelo paymentId como chave (anti-duplicação)
    db.tokens.set(String(paymentId), { paid: true, createdAt: new Date() });

    // Guarda o token de entrega
    db.tokens.set(token, {
      email: buyerEmail,
      purchases: [{ productId, code }],
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

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(200).json({ ok: true }); // sempre 200 pro MP não ficar reenviando
  }
});
