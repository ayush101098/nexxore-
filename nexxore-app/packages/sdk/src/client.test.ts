import { describe, expect, it, vi } from 'vitest';
import { createClient } from './index';

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('NexxoreClient', () => {
  it('requests /v1/health against the configured base URL', async () => {
    const fetchImpl = vi.fn(async () => ok({ status: 'ok', service: 'api', time: 't' }));
    const client = createClient({ baseUrl: 'http://localhost:4000/', fetchImpl });
    const health = await client.health();
    expect(health.status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:4000/v1/health',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });

  it('retries on 5xx then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(ok({ generatedAt: 't', stats: [] }));
    const client = createClient({
      baseUrl: 'http://x',
      fetchImpl,
      retryBackoffMs: 1,
    });
    const res = await client.stats();
    expect(res.stats).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry 4xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    const client = createClient({ baseUrl: 'http://x', fetchImpl, retryBackoffMs: 1 });
    await expect(client.stats()).rejects.toThrow(/failed: 404/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('serves from the 30s cache without refetching', async () => {
    const fetchImpl = vi.fn(async () => ok({ generatedAt: 't', stats: [] }));
    const client = createClient({ baseUrl: 'http://x', fetchImpl });
    await client.stats();
    await client.stats();
    await client.stats();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('serves stale cache when all retries fail (SWR degradation)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ generatedAt: 'first', stats: [] }))
      .mockRejectedValue(new Error('network down'));
    const client = createClient({
      baseUrl: 'http://x',
      fetchImpl,
      retries: 1,
      retryBackoffMs: 1,
      cacheTtlMs: 1, // expire immediately so the second call must refetch
    });
    const first = await client.stats();
    await new Promise((r) => setTimeout(r, 5));
    const second = await client.stats();
    expect(second).toEqual(first);
  });
});
