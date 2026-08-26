'use client';

import { ToastProvider } from '@/components/ui/Toast';

/**
 * App-wide chrome.
 *
 * This used to branch on the route and render a marketing topbar (brand /
 * Dashboard / Login) for anything not in a `FULLSCREEN_PREFIXES` list. That list
 * had grown to cover every route the app actually has, so the only pages that
 * ever reached the topbar were `/privacy` and `/terms` — and both render their
 * own header, so the topbar stacked a second, differently-styled header above
 * theirs. It was unreachable everywhere it was wanted and wrong everywhere it
 * appeared, so it is gone along with the route list and the `usePathname()`
 * Suspense boundary it needed.
 *
 * What remains is the toast host: one provider at the root so any screen can
 * report success or failure without growing its own notification plumbing.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
