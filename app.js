const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const conversations = {};

const SYSTEM_PROMPT = `Sos el asistente virtual de KingCell, tienda de celulares en Colón, Montevideo, Uruguay. Atendés clientes interesados en comprar iPhones semi nuevos que vieron un anuncio en Instagram o Facebook.

TONO Y ESTILO:
- Hablá como un amigo que sabe de celulares, en español rioplatense natural
- Mensajes cortos, directos, como WhatsApp real
- NUNCA uses negritas, asteriscos, ni listas con guiones
- Escribí todo en forma conversacional
- Máximo 3-4 líneas por mensaje

PARA CONSULTAR PRECIOS Y STOCK:
- Buscá en: https://kingcelluy.wixsite.com/kingcell/online-store
- Si no encontrás el precio exacto, usá esta lista de referencia:
  iPhone SE 128GB $7.000, XR 64GB $8.490, 11 64GB $9.990, 12 Pro 256GB $17.490, 13 256GB $16.790, 13 Pro 256GB $18.000, 14 128GB $19.590
- Todos semi nuevos, liberados, con garantía

FORMAS DE PAGO:
- Efectivo o transferencia: sin recargo
- Tarjeta (1 a 12 cuotas): 12% adicional
- Tarjetas: Visa, Mastercard, OCA, Amex, Creditel, Diners, Lider

CONTACTO Y UBICACIÓN:
- Para cerrar la compra: WhatsApp 097 129 277
- Local en Colón, Montevideo
- Ver fotos: https://kingcelluy.wixsite.com/kingcell/online-store

Si preguntan algo fuera de la venta de iPhones, respondé amablemente que este chat es solo para eso.`;

async function getClaudeResponse(subscriberId, userMessage) {
  if (!conversations[subscriberId]) conversations[subscriberId] = [];
  conversations[subscriberId].push({ role: 'user', content: userMessage });

  const messages = conversations[subscriberId];

  let response = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages
  }, {
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    }
  });

  while (response.data.stop_reason === 'tool_use') {
    const assistantContent = response.data.content;
    messages.push({ role: 'assistant', content: assistantContent });

    const toolResults = assistantContent
      .filter(b => b.type === 'tool_use')
      .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Búsqueda completada' }));

    messages.push({ role: 'user', content: toolResults });

    response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages
    }, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });
  }

  const reply = response.data.content.find(b => b.type === 'text')?.text || 'Disculpá, intentá de nuevo.';
  conversations[subscriberId].push({ role: 'assistant', content: reply });
  return reply;
}

// Endpoint para ManyChat (primer mensaje)
app.post('/manychat', async (req, res) => {
  console.log('Mensaje recibido de ManyChat:', req.body.last_input_text);
  res.sendStatus(200);

  const subscriberId = req.body.id;
  const userMessage = req.body.last_input_text;

  if (!subscriberId || !userMessage) return;

  try {
    const reply = await getClaudeResponse(subscriberId, userMessage);
    console.log('Respuesta de Claude (ManyChat):', reply);

    await axios.post('https://api.manychat.com/fb/sending/sendContent', {
      subscriber_id: subscriberId,
      data: {
        version: 'v2',
        content: {
          messages: [{ type: 'text', text: reply }]
        }
      }
    }, {
      headers: {
        'Authorization': `Bearer ${MANYCHAT_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Mensaje enviado correctamente a ManyChat');

  } catch (err) {
    console.error('Error ManyChat:', JSON.stringify(err.response?.data));
  }
});

// Endpoint para Meta webhook (verificación y mensajes siguientes)
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

      console.log('Mensaje recibido de Meta webhook:', text);

      try {
        const reply = await getClaudeResponse(senderId, text);
        console.log('Respuesta de Claude (webhook):', reply);

        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
          recipient: { id: senderId },
          message: { text: reply }
        });

        console.log('Mensaje enviado correctamente via Meta');

      } catch (err) {
        console.error('Error webhook Meta:', err.response?.data || err.message);
      }
    }
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`KingCell Bot corriendo en puerto ${PORT}`));
