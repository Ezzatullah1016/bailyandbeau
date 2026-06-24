const defaultBaseUrl = 'http://127.0.0.1:8000/api/v1';
const devFallbackBaseUrls = ['http://127.0.0.1:8001/api/v1'];

/** Max time to wait per base URL before trying the next (avoids infinite "Loading…" when API is down). */
const API_FETCH_TIMEOUT_MS = 12_000;

function isRetryableFetchError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return true;
  if (error && typeof error === 'object' && (error as Error).name === 'AbortError') return true;
  return false;
}

/** Try-order for login/API calls: explicit env, LAN Django on :8000 when UI opened by IP/hostname, same-origin `/api/v1`, then local defaults. */
function computeApiBaseCandidates(): string[] {
  const explicit = process.env.NEXT_PUBLIC_API_BASE_URL;
  const urls: string[] = [];
  if (explicit) urls.push(explicit);
  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      const lanDjango = `http://${hostname}:8000/api/v1`;
      if (!urls.includes(lanDjango)) urls.push(lanDjango);
      const sameOrigin = `${origin}/api/v1`;
      if (!urls.includes(sameOrigin)) urls.push(sameOrigin);
    }
  }
  if (!urls.includes(defaultBaseUrl)) urls.push(defaultBaseUrl);
  if (process.env.NODE_ENV !== 'production') {
    for (const u of devFallbackBaseUrls) {
      if (!urls.includes(u)) urls.push(u);
    }
  }
  return urls;
}

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBaseUrl;

async function fetchWithFallback(path: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (const baseUrl of computeApiBaseCandidates()) {
    const hasExternalSignal = Boolean(init?.signal);
    const ctrl = hasExternalSignal ? null : new AbortController();
    const tid =
      !hasExternalSignal && ctrl
        ? setTimeout(() => ctrl.abort(), API_FETCH_TIMEOUT_MS)
        : null;
    try {
      return await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: init?.signal ?? ctrl!.signal,
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableFetchError(error)) {
        throw error;
      }
    } finally {
      if (tid) clearTimeout(tid);
    }
  }
  throw lastError ?? new Error('Network request failed');
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function parseApiErrorBody(text: string, status: number): string {
  if (!text.trim()) return `Request failed with status ${status}`;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const err = j.error as { message?: string } | null | undefined;
    if (err?.message) return err.message;
    if (typeof j.detail === 'string') return j.detail;
    if (Array.isArray(j.detail) && j.detail.length) return String(j.detail[0]);
    const nfe = j.non_field_errors;
    if (Array.isArray(nfe) && nfe.length) return String(nfe[0]);
    if (typeof j.message === 'string') return j.message;
  } catch {
    /* keep raw body */
  }
  return text;
}

/** Read the stored JWT access token (set by login). */
function getAccessToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('bb_access_token');
}

function getRefreshToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('bb_refresh_token');
}

/** Persist tokens after login / refresh. */
export function storeTokens(access: string, refresh: string) {
  localStorage.setItem('bb_access_token', access);
  localStorage.setItem('bb_refresh_token', refresh);
}

export function clearTokens() {
  localStorage.removeItem('bb_access_token');
  localStorage.removeItem('bb_refresh_token');
}

/** Attempt to get a new access token using the stored refresh token.
 *  Returns the new access token, or null if refresh fails. */
async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  try {
    const res = await fetchWithFallback(`/auth/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access: string; refresh?: string };
    storeTokens(data.access, data.refresh ?? refresh);
    return data.access;
  } catch {
    return null;
  }
}

function buildHeaders(token: string | null, init?: RequestInit): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers ?? {}),
  };
}

export async function apiRequest<T extends JsonValue | Record<string, unknown>>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let token = getAccessToken();

  let response = await fetchWithFallback(`${path}`, {
    ...init,
    credentials: 'omit',
    headers: buildHeaders(token, init),
  });

  // Token expired — try silent refresh then retry once
  if (response.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      token = newToken;
      response = await fetchWithFallback(`${path}`, {
        ...init,
        credentials: 'omit',
        headers: buildHeaders(token, init),
      });
    } else {
      // Refresh failed — clear tokens and redirect to login
      clearTokens();
      if (typeof window !== 'undefined') window.location.href = '/login';
      throw new Error('Session expired. Please sign in again.');
    }
  }

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(parseApiErrorBody(payload, response.status));
  }

  return (await response.json()) as T;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SessionParticipantData {
  id: string;
  display_name: string;
  session_role: string;
  participant_type: string;
  ready_at: string | null;
  joined_at: string | null;
}

export interface SessionDetailData {
  id: string;
  book: string;
  book_title: string;
  child_name: string;
  status: string;
  room_type: string;
  livekit_room_name: string;
  invite_token: string | null;
  created_at: string;
}

export interface StartSessionData {
  session_id: string;
  status: string;
  started_at: string;
  room_name: string;
  livekit_url: string;
  realtime_token: string;
}

export interface JoinSessionData {
  session_id: string;
  room_name: string;
  livekit_url: string;
  participant: SessionParticipantData;
  realtime_token: string;
}

export interface GuestTokenData {
  session_id: string;
  room_name: string;
  livekit_url: string;
  realtime_token: string;
  role: string;
}

// ─── Session API helpers ────────────────────────────────────────────────────

export async function getSession(id: string) {
  const res = await apiRequest<{ data: SessionDetailData }>(`/sessions/${id}/`);
  return res.data;
}

export async function readySession(id: string, participantId: string) {
  await apiRequest(`/sessions/${id}/ready/`, {
    method: 'POST',
    body: JSON.stringify({ participant_id: participantId }),
  });
}

export async function startSession(id: string, participantId: string): Promise<StartSessionData> {
  const res = await apiRequest<{ data: StartSessionData }>(`/sessions/${id}/start/`, {
    method: 'POST',
    body: JSON.stringify({ participant_id: participantId }),
  });
  return res.data;
}

export async function joinViaInvite(token: string, displayName: string): Promise<JoinSessionData> {
  const res = await apiRequest<{ data: JoinSessionData }>(`/invites/${token}/join/`, {
    method: 'POST',
    body: JSON.stringify({ display_name: displayName }),
  });
  return res.data;
}

export async function getGuestToken(sessionId: string, participantId: string): Promise<GuestTokenData> {
  const res = await apiRequest<{ data: GuestTokenData }>(
    `/sessions/${sessionId}/token/?participant_id=${encodeURIComponent(participantId)}`,
  );
  return res.data;
}

export async function completeSession(id: string, participantId: string) {
  await apiRequest(`/sessions/${id}/complete/`, {
    method: 'POST',
    body: JSON.stringify({ participant_id: participantId }),
  });
}

export interface ReadySessionData {
  session_id: string;
  status: string;
  room_name: string;
  livekit_url: string;
  realtime_token: string;
}

export async function readySessionWithToken(id: string, participantId: string): Promise<ReadySessionData> {
  const res = await apiRequest<{ data: ReadySessionData }>(`/sessions/${id}/ready/`, {
    method: 'POST',
    body: JSON.stringify({ participant_id: participantId }),
  });
  return res.data;
}

export interface UserBadgeData {
  id: string;
  badge_code: string;
  badge_name: string;
  badge_description: string;
  badge_icon: string;
  child_name: string;
  session_id: string;
  earned_at: string;
}

export async function getUserBadges(): Promise<UserBadgeData[]> {
  const res = await apiRequest<{ data: UserBadgeData[] }>('/me/badges/');
  return res.data;
}

export async function transferHost(
  sessionId: string,
  currentParticipantId: string,
  newParticipantId: string,
): Promise<{ new_host_id: string; new_host_name: string }> {
  const res = await apiRequest<{ data: { new_host_id: string; new_host_name: string } }>(
    `/sessions/${sessionId}/transfer-host/`,
    {
      method: 'POST',
      body: JSON.stringify({
        current_participant_id: currentParticipantId,
        new_participant_id: newParticipantId,
      }),
    },
  );
  return res.data;
}

export async function createSession(bookId: string, childProfileId: string, roomType = 'reading') {
  const res = await apiRequest<{
    data: {
      id: string;
      invite_token: string;
      host_participant_id: string;
      participants: SessionParticipantData[];
    };
  }>('/sessions/', {
    method: 'POST',
    body: JSON.stringify({ book_id: bookId, child_profile_id: childProfileId, room_type: roomType }),
  });
  return res.data;
}

// ─── Book pages ─────────────────────────────────────────────────────────────

export interface BookPageData {
  id: string;
  page_number: number;
  image_url: string;
}

export interface BookPagesResponse {
  data: BookPageData[];
  meta: { count: number; page_count: number; asset_type: string };
}

/**
 * Fetch all page image URLs for a book.
 * Authenticated users pass their JWT automatically.
 * Guests pass their participant_id as a query param.
 */
export async function getBookPages(bookId: string, participantId?: string): Promise<BookPageData[]> {
  const qs = participantId ? `?participant_id=${encodeURIComponent(participantId)}` : '';
  const res = await apiRequest<{ data: BookPageData[]; meta: { count: number; page_count: number; asset_type: string } }>(`/books/${bookId}/pages/${qs}`);
  return res.data;
}

export interface BookPagesResult {
  pages: BookPageData[];
  assetType: string;
  pdfViewUrl: string;
}

/** Pages plus meta (asset type + the book's own PDF URL for client-side rendering). */
export async function getBookPagesWithMeta(bookId: string, participantId?: string): Promise<BookPagesResult> {
  const qs = participantId ? `?participant_id=${encodeURIComponent(participantId)}` : '';
  const res = await apiRequest<{
    data: BookPageData[];
    meta: { count: number; page_count: number; asset_type: string; pdf_view_url?: string };
  }>(`/books/${bookId}/pages/${qs}`);
  return { pages: res.data, assetType: res.meta?.asset_type ?? '', pdfViewUrl: res.meta?.pdf_view_url ?? '' };
}

// ─── Book activities ─────────────────────────────────────────────────────────

export type { ActivityConfigData } from '@/components/activity/types';

export async function getBookActivities(bookId: string, participantId?: string): Promise<import('@/components/activity/types').ActivityConfigData[]> {
  const url = participantId ? `/books/${bookId}/activities/?participant=${participantId}` : `/books/${bookId}/activities/`;
  const res = await apiRequest<{ data: import('@/components/activity/types').ActivityConfigData[] }>(url);
  return res.data;
}

// ─── Session snapshot ────────────────────────────────────────────────────────

export async function updateSnapshot(
  sessionId: string,
  participantId: string,
  pageNumber: number,
  timerState?: object | number | null,
  annotationState?: object,
  activityState?: object,
) {
  await apiRequest(`/sessions/${sessionId}/snapshot/`, {
    method: 'PUT',
    body: JSON.stringify({
      participant_id: participantId,
      current_page: pageNumber,
      timer_state: typeof timerState === 'object' && timerState !== null ? timerState : {},
      annotation_state: annotationState ?? {},
      activity_state: activityState ?? {},
    }),
  });
}

export async function getSnapshot(sessionId: string, participantId?: string) {
  const qs = participantId ? `?participant_id=${encodeURIComponent(participantId)}` : '';
  const res = await apiRequest<{
    data: { page_number: number; timer_state: object; annotation_state: object; activity_state: object } | null;
  }>(`/sessions/${sessionId}/snapshot/${qs}`);
  return res.data;
}
