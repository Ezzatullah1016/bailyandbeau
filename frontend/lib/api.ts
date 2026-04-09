const defaultBaseUrl = 'http://127.0.0.1:8000/api/v1';

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBaseUrl;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export async function apiRequest<T extends JsonValue | Record<string, unknown>>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}