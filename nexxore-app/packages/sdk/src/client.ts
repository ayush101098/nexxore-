import type {
  HealthResponse,
  IndexCurrentResponse,
  IndexHistoryResponse,
  StatsResponse,
} from './types';

export interface SdkOptions {
  /** API gateway base URL, e.g. http://localhost:4000. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** GET retry attempts on network errors / 5xx (not 4xx). Default 3. */
  retries?: number;
  /** Base backoff in ms, doubled per attempt. Default 250. */
  retryBackoffMs?: number;
  /** SWR-style cache TTL in ms. Default 30s. 0 disables. */
  cacheTtlMs?: number;
}

interface CacheEntry {
  at: number;
  data: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NexxoreClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retries: number;
  private readonly retryBackoffMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: SdkOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retries = options.retries ?? 3;
    this.retryBackoffMs = options.retryBackoffMs ?? 250;
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
  }

  /**
   * GET with retries + SWR-style cache: fresh (< TTL) entries are served
   * without a request; on fetch failure a stale entry is served if one exists.
   */
  private async get<T>(path: string): Promise<T> {
    const cached = this.cache.get(path);
    if (cached && this.cacheTtlMs > 0 && Date.now() - cached.at < this.cacheTtlMs) {
      return cached.data as T;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          headers: { accept: 'application/json' },
        });
        if (res.status >= 500) {
          lastError = new Error(`NEXXORE API ${path} failed: ${res.status}`);
        } else if (!res.ok) {
          throw new Error(`NEXXORE API ${path} failed: ${res.status}`);
        } else {
          const data = (await res.json()) as T;
          this.cache.set(path, { at: Date.now(), data });
          return data;
        }
      } catch (err) {
        // 4xx errors are thrown above and must not be retried.
        if (err instanceof Error && /failed: 4\d\d/.test(err.message)) throw err;
        lastError = err;
      }
      if (attempt < this.retries) await sleep(this.retryBackoffMs * 2 ** attempt);
    }

    // All attempts failed — serve stale if we have it (SWR degradation).
    if (cached) return cached.data as T;
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  health(): Promise<HealthResponse> {
    return this.get<HealthResponse>('/v1/health');
  }

  /** The single source of truth for brand stats. */
  stats(): Promise<StatsResponse> {
    return this.get<StatsResponse>('/v1/stats');
  }

  /** Current Escalation Index composite, regime, and component breakdown. */
  indexCurrent(): Promise<IndexCurrentResponse> {
    return this.get<IndexCurrentResponse>('/v1/index/current');
  }

  /** Composite time series (public; component-level needs an API key). */
  indexHistory(params?: { from?: string; to?: string; granularity?: 'raw' | 'hour' | 'day' }): Promise<IndexHistoryResponse> {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    if (params?.granularity) q.set('granularity', params.granularity);
    const qs = q.toString();
    return this.get<IndexHistoryResponse>(`/v1/index/history${qs ? `?${qs}` : ''}`);
  }
}

export function createClient(options: SdkOptions): NexxoreClient {
  return new NexxoreClient(options);
}
