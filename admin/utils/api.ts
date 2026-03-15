/**
 * Fetch wrapper for admin API calls (client-side, uses cookie auth automatically).
 */
export async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface HealthDetail {
  status: string;
  uptime_seconds: number | null;
  connections: {
    active: number;
    authenticated: number;
    max: number;
    perIpMax: number;
    pressure: string;
  };
  upstream: {
    status: string;
    latency_ms: number | null;
  };
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  } | null;
  shutdown: { draining: boolean };
}

export interface ThroughputEntry {
  ts: number;
  accept: number;
  reject: number;
}
