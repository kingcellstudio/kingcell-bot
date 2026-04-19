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

INSTRUCCIONES PARA CONSULTAR PRECIOS:
- Cuando un cliente pregunte por un modelo específico o por el stock disponible, usá la herramienta web_search para buscar en https://kingcelluy.wixsite.com/kingcell/online-store el precio actualizado
- Buscá con términos como "KingCell iPhone [modelo] precio site:kingcelluy.wixsite.com"
- Si encontrás el precio en la web, usalo. Si no encontrás el modelo, decile honestamente que no tenés ese modelo disponible en este momento

INFORMACIÓN FIJA:
- Todos los equipos son semi nuevos, liberados para cualquier operador y con garantía del local
- Efectivo o transferencia sin recargo
- Tarjeta de crédito (1 a 12 cuotas) → 12% de comisión adicional sobre el precio
- Tarjetas: Visa, Mastercard, OCA, Amex, Creditel, Diners, Lider
- WhatsApp para cerrar compra: 097 129 277
- Local en Colón, Montevideo
- Web para ver fotos: https://kingcelluy.wixsite.com/kingcell/online-store

CÓMO CALCULAR PRECIO CON TARJETA:
- Multiplicá el precio de lista por 1.12 y redondeá al número entero más cercano

Si preguntan algo que no tenga que ver con la compra de iPhones, respondé amablemente que este chat es solo para consultas sobre los iPhones disponibles.

Respondé solo el mensaje, sin saludos ni firmas. Sin asteriscos ni negritas.`;

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

      if (!isFromCampaign && !isExistingConversation) {
        console.log(`Mensaje ignorado de ${senderId} — no viene de la campaña de iPhones`);
        continue;
      }

      if (!conversations[senderId]) conversations[senderId] = [];
      conversations[senderId].push({ role: 'user', content: text });

      try {
        const response = await axios.post('https://api.anthropic.com/v1/messages', {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search'
            }
          ],
          messages: conversations[senderId]
        }, {
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          }
        });

        // Extraer el texto de la respuesta (puede incluir tool_use blocks)
        const content = response.data.content;
        let reply = '';

        // Si hay tool_use (búsqueda web), necesitamos hacer otra llamada con el resultado
        const toolUseBlock = content.find(b => b.type === 'tool_use');
        if (toolUseBlock) {
          // Agregar respuesta del asistente con tool_use al historial
          const assistantMsg = { role: 'assistant', content: content };
          
          // Hacer segunda llamada incluyendo el resultado de la herramienta
          const response2 = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            tools: [
              {
                type: 'web_search_20250305',
                name: 'web_search'
              }
            ],
            messages: [
              ...conversations[senderId],
              assistantMsg,
              {
                role: 'user',
                content: [{
                  type: 'tool_result',
                  tool_use_id: toolUseBlock.id,
                  content: 'Búsqueda completada'
                }]
              }
            ]
          }, {
            headers: {
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json'
            }
          });

          reply = response2.data.content.find(b => b.type === 'text')?.text || 'Disculpá, intentá de nuevo.';
        } else {
          reply = content.find(b => b.type === 'text')?.text || 'Disculpá, intentá de nuevo.';
        }

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
