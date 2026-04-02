/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useRef, FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { marked } from "marked";
import DOMPurify from "dompurify";

// Definiert die Struktur einer einzelnen Nachricht im Chat
interface Message {
  sender: 'user' | 'bot';
  text: string;
}

// Render Markdown aus Gemini-Ausgaben in HTML und säubere es gegen unerlaubtes HTML.
const renderMarkdown = (text: string) => {
  // Verhindert Tabellendarstellung: Markdown-Tabellen werden vor dem Rendering
  // in einfachen Fließtext umgewandelt.
  const normalizedText = text
    .split('\n')
    .filter((line, index, allLines) => {
      const trimmed = line.trim();
      const isPipeLine = trimmed.includes('|');
      const isSeparatorLine = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);

      // Entferne Header/Trennzeilen von Markdown-Tabellen.
      if (isSeparatorLine) {
        return false;
      }
      // Entferne reine Tabellenzeilen nur dann, wenn direkt davor/danach
      // ebenfalls Tabellenzeilen liegen (heuristisch für echte Tabellen).
      if (isPipeLine) {
        const prev = allLines[index - 1]?.trim() ?? '';
        const next = allLines[index + 1]?.trim() ?? '';
        const prevLooksLikeTable = prev.includes('|') || /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(prev);
        const nextLooksLikeTable = next.includes('|') || /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next);
        if (prevLooksLikeTable || nextLooksLikeTable) {
          return false;
        }
      }
      return true;
    })
    .join('\n');

  const rawHtml = marked.parse(normalizedText, {
    gfm: true,
    breaks: true,
  }) as string;
  const cleanHtml = DOMPurify.sanitize(rawHtml);
  return { __html: cleanHtml };
};

const ChatbotApp: React.FC = () => {
  // UI-Schalter: Chat kann ausgeblendet werden, ohne die Seite zu verlassen.
  const [isChatOpen, setIsChatOpen] = useState<boolean>(true);

  // Zustand für die Liste der Nachrichten im Chat
  const [messages, setMessages] = useState<Message[]>([]);
  // Zustand für den aktuellen Text im Eingabefeld
  const [inputValue, setInputValue] = useState<string>('');
  // Zustand, der anzeigt, ob der Bot gerade eine Antwort generiert
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Referenz auf das Nachrichtenlisten-Element, um das Scrollen zu steuern
  const messageListRef = useRef<HTMLDivElement | null>(null);

  // Prüft, ob der Vite-Server den Schlüssel serverseitig geladen hat (ohne ihn ans Frontend zu geben).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/gemini/status');
        const data = (await r.json()) as { configured?: boolean };
        if (cancelled) return;
        if (!data.configured) {
          setMessages([
            {
              sender: 'bot',
              text: 'Fehlende Konfiguration: Legen Sie `GEMINI_API_KEY` in `.env.local` an (siehe `.env.example`) und starten Sie `npm run dev` neu. Den Schlüssel niemals ins Repository committen.',
            },
          ]);
          return;
        }
        setMessages([
          {
            sender: 'bot',
            text: 'Hallo! Ich bin **ibo-audit chatbot**, Ihr Assistent für die Software **ibo-Audit**. Womit kann ich Ihnen helfen?',
          },
        ]);
      } catch {
        if (!cancelled) {
          setMessages([
            {
              sender: 'bot',
              text: 'Der Chat-Server ist nicht erreichbar. Starten Sie die App mit `npm run dev` oder `npm run build` und `npm run preview`.',
            },
          ]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Dieser useEffect-Hook wird immer dann ausgeführt, wenn sich die `messages`-Liste ändert.
  // Er scrollt die Nachrichtenliste automatisch zum Ende, damit die neueste Nachricht sichtbar ist.
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages]);

  // Diese Funktion wird aufgerufen, wenn der Benutzer das Formular abschickt (Enter drückt oder Button klickt).
  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault(); // Verhindert das Neuladen der Seite durch das Formular
    const trimmedInput = inputValue.trim();

    // Die Funktion wird beendet, wenn die Eingabe leer ist oder der Bot gerade lädt.
    if (!trimmedInput || isLoading) {
      return;
    }

    const userMessage: Message = { sender: 'user', text: trimmedInput };
    const historyForApi = [...messages, userMessage];
    setMessages(historyForApi);
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: historyForApi }),
      });
      const payload = (await response.json()) as { text?: string; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }

      const botResponseText = payload.text ?? '';
      const botMessage: Message = { sender: 'bot', text: botResponseText };
      setMessages([...historyForApi, botMessage]);
    } catch (error) {
      console.error('Fehler bei der Kommunikation mit der Gemini API:', error);
      // Fügt eine Fehlermeldung zum Chat hinzu, wenn etwas schiefgeht
      const errorMessage: Message = { sender: 'bot', text: 'Entschuldigung, es ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.' };
      setMessages([...historyForApi, errorMessage]);
    } finally {
      // Deaktiviert den Ladezustand, egal ob erfolgreich oder nicht
      setIsLoading(false);
    }
  };

  return (
    <div className={`app-container ${isChatOpen ? '' : 'app-container-closed'}`}>
      {isChatOpen ? (
        <>
          <header className="header">
            <button
              type="button"
              className="close-button"
              onClick={() => {
                setIsLoading(false);
                setIsChatOpen(false);
              }}
              aria-label="Chat schließen"
              title="Chat schließen"
            >
              &#10005;
            </button>
            <div className="header-title">
              <img
                className="header-title-icon"
                src="/chatbot-icon.png"
                alt=""
                aria-hidden="true"
              />
              <h1>ibo-audit chatbot</h1>
            </div>
          </header>
          <div className="message-list" ref={messageListRef}>
            {/* Durchläuft die `messages`-Liste und rendert für jede Nachricht eine Komponente */}
            {messages.map((msg, index) => (
              <div key={index} className={`message ${msg.sender === 'user' ? 'user-message' : 'bot-message'}`}>
                {/* 
                  Für Bot-Nachrichten wird der Text formatiert, um Markdown zu HTML zu machen.
                  `dangerouslySetInnerHTML` wird hier sicher verwendet, da wir den Inhalt kontrollieren
                  und nur einfache Formatierungen umwandeln.
                  Benutzernachrichten werden weiterhin als reiner Text dargestellt, um XSS-Angriffe zu verhindern.
                */}
                {msg.sender === 'bot' ? (
                  <div className="bot-markdown" dangerouslySetInnerHTML={renderMarkdown(msg.text)} />
                ) : (
                  msg.text
                )}
              </div>
            ))}
            {/* Zeigt die Ladeanzeige an, wenn `isLoading` true ist */}
            {isLoading && <div className="message bot-message loading-indicator">Denkt nach...</div>}
          </div>
          <form className="message-form" onSubmit={handleSendMessage}>
            <input
              type="text"
              className="message-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Stellen Sie Ihre Frage..."
              aria-label="Nachricht eingeben"
              disabled={isLoading}
            />
            <button type="submit" className="send-button" disabled={!inputValue.trim() || isLoading}>
              Senden
            </button>
          </form>
        </>
      ) : (
        <div className="chat-closed">
          <button
            type="button"
            className="open-button"
            onClick={() => setIsChatOpen(true)}
            aria-label="Chat öffnen"
          >
            <img className="open-button-icon" src="/chatbot-icon.png" alt="" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
};

// Sucht das Root-Element im HTML und rendert die React-App hinein.
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<ChatbotApp />);
}