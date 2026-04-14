'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type SessionRole = 'host' | 'guest';

export interface SessionState {
  sessionId: string | null;
  token: string | null;       // Livekit JWT
  role: SessionRole | null;
  roomName: string | null;
  livekitUrl: string | null;
  participantId: string | null;
}

interface SessionContextValue extends SessionState {
  setSession: (state: SessionState) => void;
  clearSession: () => void;
}

const STORAGE_KEY = 'bb_session';

const empty: SessionState = {
  sessionId: null,
  token: null,
  role: null,
  roomName: null,
  livekitUrl: null,
  participantId: null,
};

const SessionContext = createContext<SessionContextValue>({
  ...empty,
  setSession: () => {},
  clearSession: () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>(empty);

  // Rehydrate from sessionStorage on mount (handles page refresh)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw) as SessionState);
    } catch {
      // ignore corrupt storage
    }
  }, []);

  const setSession = (next: SessionState) => {
    setState(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  };

  const clearSession = () => {
    setState(empty);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  return (
    <SessionContext.Provider value={{ ...state, setSession, clearSession }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
