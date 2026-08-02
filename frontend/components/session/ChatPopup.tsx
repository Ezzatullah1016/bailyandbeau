'use client';

import { useEffect, useRef } from 'react';
import { Send, X } from 'lucide-react';

export type ChatMessage = { id: number; from: string; text: string; self: boolean };

export type ChatPopupProps = {
  messages: ChatMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
};

/**
 * A self-contained chat window, in the shape people already know from support
 * widgets: anchored bottom-right, closed until asked for, and no larger than it
 * needs to be.
 *
 * Chat was previously a tab inside a general "Session" panel, which meant
 * opening chat also covered the participants and settings, and there was no way
 * to keep an eye on the conversation without that whole panel in the way.
 */
export function ChatPopup({ messages, input, onInputChange, onSend, onClose }: ChatPopupProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  // Focus on open — someone clicking the chat button intends to type.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-label="Session chat"
      className="room-panel-strong pointer-events-auto fixed bottom-4 right-4 z-[70] flex max-h-[min(70dvh,460px)] w-[min(100vw-2rem,320px)] flex-col overflow-hidden rounded-2xl"
    >
      <div
        className="flex shrink-0 items-center justify-between px-3 py-2"
        style={{ borderBottom: '1px solid var(--room-chrome-line)' }}
      >
        <h3 className="text-sm font-bold" style={{ color: 'var(--room-ink)' }}>
          Chat
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="room-tap cursor-pointer rounded-lg"
          style={{ color: 'var(--room-ink-soft)' }}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-3 py-3">
        {messages.length === 0 && (
          <p className="pt-6 text-center text-xs" style={{ color: 'var(--room-ink-soft)' }}>
            No messages yet. Say hi!
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.self ? 'items-end' : 'items-start'}`}>
            <span className="mb-0.5 px-1 text-[10px]" style={{ color: 'var(--room-ink-soft)' }}>
              {m.from}
            </span>
            <div
              className={`max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm ${
                m.self ? 'rounded-br-sm' : 'rounded-bl-sm'
              }`}
              style={
                m.self
                  ? { background: 'var(--room-accent)', color: 'var(--room-accent-contrast)' }
                  : { background: 'var(--room-chrome)', color: 'var(--room-ink)' }
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div
        className="flex shrink-0 items-center gap-2 px-3 py-2"
        style={{ borderTop: '1px solid var(--room-chrome-line)' }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSend();
          }}
          placeholder="Type a message…"
          aria-label="Message"
          className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm outline-none"
          style={{
            background: 'var(--room-chrome)',
            color: 'var(--room-ink)',
            border: '1px solid var(--room-chrome-line)',
          }}
        />
        <button
          type="button"
          onClick={onSend}
          aria-label="Send message"
          className="room-tap shrink-0 cursor-pointer rounded-xl"
          style={{ background: 'var(--room-accent)', color: 'var(--room-accent-contrast)' }}
        >
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
