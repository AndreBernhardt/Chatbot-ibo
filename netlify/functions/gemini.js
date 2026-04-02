const MODEL = 'gemini-2.5-flash';

const SYSTEM_INSTRUCTION =
  "Du bist ein hilfsbereiter und freundlicher Support-Mitarbeiter für die Software 'ibo-Audit'. Antworte immer auf Deutsch. Sei präzise und professionell in deinen Antworten. Nutze Markdown für Formatierungen wie Fettdruck. Verwende niemals Tabellen.";

function resolveApiKey(env) {
  return (env.GEMINI_API_KEY || env.VITE_API_KEY || '').trim();
}

function extractTextFromResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }
  let text = '';
  for (const p of parts) {
    if (p && typeof p.text === 'string' && !p.thought) {
      text += p.text;
    }
  }
  return text;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  if (event.httpMethod === 'GET') {
    const configured = Boolean(resolveApiKey(process.env));
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ configured }),
    };
  }

  if (event.httpMethod === 'POST') {
    const apiKey = resolveApiKey(process.env);
    if (!apiKey) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({ error: 'missing_api_key' }),
      };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'invalid_json' }),
      };
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    let contents = messages
      .filter((m) => m && typeof m.text === 'string' && m.text.trim())
      .map((m) => ({
        role: m.sender === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }],
      }));

    while (contents.length > 0 && contents[0].role === 'model') {
      contents = contents.slice(1);
    }

    if (contents.length === 0 || contents[contents.length - 1].role !== 'user') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'invalid_messages' }),
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
          },
          contents,
        }),
      });

      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        console.error('[gemini-proxy] Non-JSON response', res.status, raw.slice(0, 400));
        return {
          statusCode: 502,
          headers,
          body: JSON.stringify({ error: 'gemini_failed' }),
        };
      }

      if (!res.ok) {
        const msg = data?.error?.message || raw.slice(0, 300);
        console.error('[gemini-proxy] API error', res.status, msg);
        return {
          statusCode: 502,
          headers,
          body: JSON.stringify({ error: 'gemini_failed' }),
        };
      }

      const text = extractTextFromResponse(data);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ text }),
      };
    } catch (e) {
      console.error('[gemini-proxy]', e && e.message ? e.message : e);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'gemini_failed' }),
      };
    }
  }

  return {
    statusCode: 404,
    headers,
    body: JSON.stringify({ error: 'not_found' }),
  };
};
