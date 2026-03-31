const { GoogleGenAI } = require('@google/genai');

const MODEL = 'gemini-2.5-flash';

const SYSTEM_INSTRUCTION =
  "Du bist ein hilfsbereiter und freundlicher Support-Mitarbeiter für die Software 'ibo-Audit'. Antworte immer auf Deutsch. Sei präzise und professionell in deinen Antworten. Nutze Markdown für Formatierungen wie Fettdruck. Verwende niemals Tabellen.";

function resolveApiKey(env) {
  return (env.GEMINI_API_KEY || env.VITE_API_KEY || '').trim();
}

exports.handler = async (event, context) => {
  // CORS headers
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

  if (event.path.endsWith('/status') && event.httpMethod === 'GET') {
    const configured = Boolean(resolveApiKey(process.env));
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ configured }),
    };
  }

  if (event.path.endsWith('/chat') && event.httpMethod === 'POST') {
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

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: { systemInstruction: SYSTEM_INSTRUCTION },
      });
      const text = response.text || '';
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