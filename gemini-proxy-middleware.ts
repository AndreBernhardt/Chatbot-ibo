/**
 * Liest GEMINI_API_KEY nur im Node-Kontext (Vite Dev/Preview) — nicht im Browser-Bundle.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';

const MODEL = 'gemini-2.5-flash';

/** Exakt dieser Anzeigename — auch in Antworten und Begrüßungen verwenden. */
const ASSISTANT_NAME = 'ibo-audit Chatbot';

const SYSTEM_INSTRUCTION = `Du bist ausschließlich der virtuelle Assistent "${ASSISTANT_NAME}" für die Software ibo-Audit.

Darstellung:
- Stelle dich nur unter dem Namen ${ASSISTANT_NAME} vor. Du bist ein Chatbot, keine Person und kein menschlicher Mitarbeiter.
- Auf kurze Begrüßungen (z. B. „hi“, „hallo“) antworte freundlich als ${ASSISTANT_NAME} und biete Hilfe zu ibo-Audit an.

Streng verboten (niemals in Antworten ausgeben):
- Text in eckigen Klammern [ ] — insbesondere keine Platzhalter wie [Ihr Name], [Dein Name], [Support-Team] oder ähnlich.
- Sätze wie „Mein Name ist …“ mit erfundenen Namen, Platzhaltern oder „Support-Team“ als Namenersatz.
- So zu tun, als wärest du ein menschlicher Mitarbeiter mit persönlichem Namen.

Sprache: immer Deutsch, klar und professionell. Markdown für Fettdruck erlaubt, keine Tabellen.`;

interface ChatMessage {
  sender: 'user' | 'bot';
  text: string;
}

function resolveApiKey(env: Record<string, string>): string | undefined {
  return env.GEMINI_API_KEY?.trim() || env.VITE_API_KEY?.trim();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function geminiProxyMiddleware(env: Record<string, string>): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const pathOnly = req.url?.split('?')[0] ?? '';

    if (pathOnly === '/api/gemini/status' && req.method === 'GET') {
      const configured = Boolean(resolveApiKey(env));
      sendJson(res, 200, { configured });
      return;
    }

    if (pathOnly !== '/api/gemini/chat' || req.method !== 'POST') {
      next();
      return;
    }

    const apiKey = resolveApiKey(env);
    if (!apiKey) {
      sendJson(res, 503, { error: 'missing_api_key' });
      return;
    }

    let body: { messages?: ChatMessage[] };
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw || '{}') as { messages?: ChatMessage[] };
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
      return;
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    let contents = messages
      .filter((m) => m && typeof m.text === 'string' && m.text.trim())
      .map((m) => ({
        role: (m.sender === 'user' ? 'user' : 'model') as 'user' | 'model',
        parts: [{ text: m.text }],
      }));

    // Gemini erwartet üblicherweise, dass die Historie mit user beginnt; die UI-Begrüßung ist model.
    while (contents.length > 0 && contents[0]!.role === 'model') {
      contents = contents.slice(1);
    }

    if (contents.length === 0 || contents[contents.length - 1]!.role !== 'user') {
      sendJson(res, 400, { error: 'invalid_messages' });
      return;
    }

    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: { systemInstruction: SYSTEM_INSTRUCTION },
      });
      const text = response.text ?? '';
      sendJson(res, 200, { text });
    } catch (e) {
      const err = e as { message?: string; status?: number };
      console.error('[gemini-proxy]', err?.message ?? err?.status ?? e);
      sendJson(res, 502, { error: 'gemini_failed' });
    }
  };
}
