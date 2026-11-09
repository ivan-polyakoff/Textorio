// Фейковый OpenAI-совместимый сервер для живой проверки openai-адаптера.
// Поднимается на localhost:11434 (стандартный порт Ollama) и отвечает
// на POST /v1/chat/completions в формате OpenAI.
const http = require('http');

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      console.log('Получен запрос:', JSON.stringify(parsed).slice(0, 220));

      const isVision = Array.isArray(parsed.messages?.[0]?.content);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: isVision ? 'На фото котик' : 'Проверка связи успешна' } }]
      }));
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(11434, () => console.log('Fake OpenAI server on http://localhost:11434/v1'));
