const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CAMPAIGN_IDS = ['120241426447900296'];

const conversations = {};

const SYSTEM_PROMPT = `Sos el asistente virtual de KingCell, tienda de celulares en Colón, Montevideo, Uruguay. Atendés clientes interesados en comprar iPhones semi nuevos que vieron un anuncio. Hablá como un amigo que sabe de celulares, en español rioplatense, mensajes cortos y sin negritas ni asteriscos.

STOCK: iPhone SE 128GB $7.000, iPhone XR 64GB $8.490, iPhone 11 64GB $9.990 (negro y blanco), iPhone 12 Pro 256GB $17.490, iPhone 13 256GB $16.790, iPhone 13 Pro 256GB $18.000, iPhone 14 128GB $19.590. Todos semi nuevos, liberados, con garantía.

CON TARJETA (12% extra): SE $7.840, XR $9.509, 11 $11.189, 12Pro $19.589, 13 $18.805, 13Pro $20.160, 14 $21.941.

Efectivo o transferencia sin recargo. WhatsApp para cerrar compra: 097 129 277. Local en Colón, Montevideo.

Si preguntan algo que no tenga que ver con la compra de iPhones, respondé amablemente que este chat es solo para consultas sobre los iPhones disponibles.`;

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  res.sendStatus(200);

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const event = entry.messaging?.[0];
      if (!event || !event.message || event.message.is_echo) continue;

      const senderId = event.sender.id;
      const text = event.message.text;
      if (!text) continue;

      const campaignId = event.message?.referral?.campaign_id || event.referral?.campaign_id || '';
      const isFromCampaign = CAMPAIGN_IDS.includes(campaignId);
      const isExistingConversation = conversations[senderId];

      // Si no viene de la campaña de iPhones y no es conversación iniciada, ignorar completamente
      if (!isFromCampaign && !isExistingConversation) {
        console.log(`Mensaje ignorado de ${senderId} — no viene de la campaña de iPhones`);
        continue;
      }

      if (!conversations[senderId]) conversations[senderId] = [];
      conversations[senderId].push({ role: 'user', content: text });

      try {
        const response = await axios.post('https://api.anthropic.com/v1/messages', {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          system: SYSTEM_PROMPT,
          messages: conversations[senderId]
        }, {
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          }
        });

        const reply = response.data.content[0].text;
        conversations[senderId].push({ role: 'assistant', content: reply });

        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
          recipient: { id: senderId },
          message: { text: reply }
        });

      } catch (err) {
        console.error('Error:', err.response?.data || err.message);
      }
    }
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`KingCell Bot corriendo en puerto ${PORT}`));
