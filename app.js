const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY;

const conversations = {};

const SYSTEM_PROMPT = `Sos el asistente virtual de KingCell, tienda de celulares en Colón, Montevideo, Uruguay. Atendés clientes interesados en comprar iPhones semi nuevos que vieron un anuncio en Instagram o Facebook.

TONO Y ESTILO:
- Hablá como un amigo que sabe de celulares, en español rioplatense natural
- Mensajes cortos, directos, como WhatsApp real
- NUNCA uses negritas, asteriscos, ni emojis en exceso
- NUNCA hagas listas con guiones, escribí todo en forma conversacional
- Máximo 3-4 líneas por mensaje

PARA CONSULTAR PRECIOS Y STOCK:
- Buscá directamente en: https://kingcelluy.wixsite.com/kingcell/online-store
- También probá buscar: "kingcell.uy iphone precio"
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

app.post('/manychat', async (req, res) => {
  console.log('Mensaje recibido de ManyChat:', JSON.stringify(req.body));
  res.sendStatus(200);

  const subscriberId = req.body.id;
  const userMessage = req.body.last_input_text;

  if (!subscriberId || !userMessage) return;

  try {
    const reply = await getClaudeResponse(subscriberId, userMessage);
    console.log('Respuesta de Claude:', reply);

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
    console.error('Error completo:', JSON.stringify(err.response?.data));
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`KingCell Bot corriendo en puerto ${PORT}`));
