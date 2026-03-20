/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useRef, FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import type { Chat } from "@google/genai";
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

  // useRef wird verwendet, um die Chat-Instanz über Renderings hinweg beizubehalten,
  // ohne bei jeder Zustandsänderung eine neue Instanz zu erstellen.
  const chatRef = useRef<Chat | null>(null);

  // Referenz auf das Nachrichtenlisten-Element, um das Scrollen zu steuern
  const messageListRef = useRef<HTMLDivElement | null>(null);

  // Dieser useEffect-Hook wird nur einmal beim ersten Rendern der Komponente ausgeführt.
  // Er initialisiert den Gemini-Chatbot.
  useEffect(() => {
    const apiKey = import.meta.env.VITE_API_KEY;
    if (!apiKey) {
      // Ohne API-Key keine Initialisierung, stattdessen klare Meldung anzeigen.
      setMessages([
        {
          sender: 'bot',
          text: 'Fehlende Konfiguration: Bitte setzen Sie `VITE_API_KEY` in einer `.env`-Datei und starten Sie den Dev-Server neu.',
        },
      ]);
      return;
    }

    // Initialisiert die GoogleGenAI-Klasse mit dem API-Schlüssel
    const ai = new GoogleGenAI({ apiKey });

    // Erstellt eine neue Chat-Sitzung mit dem spezifischen Modell
    // und einer Systemanweisung, die den Kontext für den Bot festlegt.
    const newChat = ai.chats.create({
      model: 'gemini-2.5-flash',
      config: {
        // Diese Anweisung "trainiert" den Bot darauf, wie er sich verhalten soll.
        systemInstruction: "Du bist ein hilfsbereiter und freundlicher Support-Mitarbeiter für die Software 'ibo-Audit'. Antworte immer auf Deutsch. Sei präzise und professionell in deinen Antworten. Nutze Markdown für Formatierungen wie Fettdruck. Verwende niemals Tabellen.",
      },
    });
    chatRef.current = newChat;

    // Fügt eine erste Willkommensnachricht vom Bot hinzu.
    setMessages([{ sender: 'bot', text: 'Hallo! Wie kann ich Ihnen heute bezüglich **ibo-Audit** helfen?' }]);
  }, []); // Das leere Abhängigkeitsarray stellt sicher, dass der Hook nur einmal läuft.

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

    // Erstellt die neue Nachricht des Benutzers
    const userMessage: Message = { sender: 'user', text: trimmedInput };
    // Fügt die Benutzernachricht zur Nachrichtenliste hinzu
    setMessages(prevMessages => [...prevMessages, userMessage]);
    // Setzt das Eingabefeld zurück
    setInputValue('');
    // Aktiviert den Ladezustand
    setIsLoading(true);

    try {
      // Stellt sicher, dass die Chat-Instanz existiert
      if (!chatRef.current) {
        throw new Error("Chat ist nicht initialisiert.");
      }
      
      // Sendet die Nachricht des Benutzers an die Gemini API
      const response = await chatRef.current.sendMessage({ message: trimmedInput });

      // Extrahiert den Text aus der API-Antwort
      const botResponseText = response.text;
      
      // Erstellt die neue Nachricht des Bots
      const botMessage: Message = { sender: 'bot', text: botResponseText };
      // Fügt die Bot-Nachricht zur Nachrichtenliste hinzu
      setMessages(prevMessages => [...prevMessages, botMessage]);

    } catch (error) {
      console.error("Fehler bei der Kommunikation mit der Gemini API:", error);
      // Fügt eine Fehlermeldung zum Chat hinzu, wenn etwas schiefgeht
      const errorMessage: Message = { sender: 'bot', text: 'Entschuldigung, es ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.' };
      setMessages(prevMessages => [...prevMessages, errorMessage]);
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
              <h1>ibo-Audit Support-Chat</h1>
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