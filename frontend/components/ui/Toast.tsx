'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, CircleAlert, X } from 'lucide-react';

/**
 * App-wide feedback.
 *
 * Before this existed every risky action ended in `.catch(() => {})`, and
 * several then updated local state anyway — a failed favourite still filled the
 * heart, a failed profile save just stopped spinning. The result was a set of
 * buttons that were correctly wired but looked broken, because nothing on screen
 * ever acknowledged the click. This is the acknowledgement.
 *
 * Deliberately small: no queue priorities, no positions, no variants beyond
 * success and error. Anything more and callers start making layout decisions at
 * the call site, which is how the swallowed-error pattern got established in the
 * first place.
 */

type ToastTone = 'success' | 'error';

type ToastRecord = {
  id: number;
  tone: ToastTone;
  message: string;
};

type ToastApi = {
  /** Confirm something happened. Auto-dismisses. */
  success: (message: string) => void;
  /**
   * Report a failure.
   *
   * Accepts an `unknown` so a `catch` block can hand over whatever it caught
   * without unwrapping it first — the friction of writing that unwrap by hand is
   * exactly what made `.catch(() => {})` the path of least resistance.
   */
  error: (message: string, cause?: unknown) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** Errors linger: a failure the user missed is a failure they will hit again. */
const DISMISS_MS: Record<ToastTone, number> = {
  success: 3200,
  error: 6000,
};

/**
 * Feedback for an action nobody is watching is worse than none — it steals
 * attention from a live video call. Cap the stack and drop the oldest.
 */
const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);
  // Timers are cleared on unmount so a toast raised during navigation cannot
  // call setState on a torn-down provider.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }].slice(-MAX_VISIBLE));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_MS[tone]),
      );
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (message, cause) => {
        // The message shown stays the caller's plain-language one; the cause goes
        // to the console for whoever is debugging. Users should never read a
        // stack trace, and developers should never lose one.
        if (cause !== undefined) console.error('[toast]', message, cause);
        push('error', message);
      },
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
}) {
  const reduced = useReducedMotion();

  return (
    <div
      /* Top-centre, not bottom-right: the session room's bottom edge belongs to
         the dock and its primary CTA, and a toast landing there covered the one
         control the room exists to offer. */
      className="pointer-events-none fixed inset-x-0 top-4 z-[var(--z-toast)] flex flex-col items-center gap-2 px-4"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout={!reduced}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.97 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl px-4 py-3 shadow-lg ring-1 ring-black/10"
            style={{
              background: toast.tone === 'error' ? '#7f2033' : '#1f4b34',
              color: '#ffffff',
            }}
          >
            <span className="mt-0.5 shrink-0" aria-hidden>
              {toast.tone === 'error' ? (
                <CircleAlert className="h-5 w-5" />
              ) : (
                <Check className="h-5 w-5" />
              )}
            </span>
            <p className="min-w-0 flex-1 font-karla text-[14px] font-medium leading-snug break-words">
              {toast.message}
            </p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              /* 44px tap target for a 16px glyph — the same reason the room's
                 controls are oversized: this app is used by children on tablets. */
              className="-my-1.5 -mr-2 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Feedback for the current screen.
 *
 * Falls back to console-only when no provider is mounted rather than throwing:
 * the staff portal renders some of these components inside an iframe preview
 * without the app shell, and a missing toast host should not blank the page.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return useMemo<ToastApi>(
    () =>
      ctx ?? {
        success: (message) => console.info('[toast:success]', message),
        error: (message, cause) => console.error('[toast:error]', message, cause),
      },
    [ctx],
  );
}
