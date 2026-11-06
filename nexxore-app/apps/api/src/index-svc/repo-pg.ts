import pg from 'pg';
import type { DriverEvent, IndexReading, StoredReading, ComponentKey } from './types.js';
import { downsample, type Granularity, type IndexRepo } from './repo.js';

const { Pool } = pg;

/** Postgres implementation over db/migrations/002_index.sql. */
export class PgIndexRepo implements IndexRepo {
  private readonly pool: InstanceType<typeof Pool>;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 5 });
  }

  async insertReading(reading: IndexReading, events: DriverEvent[]): Promise<StoredReading> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query<{ id: number }>(
        `INSERT INTO index_readings (ts, composite, regime, content_hash)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [reading.ts, reading.composite, reading.regime, reading.contentHash],
      );
      const id = r.rows[0]!.id;
      for (const c of reading.components) {
        await client.query(
          `INSERT INTO index_component_readings (reading_id, component_key, value, top_driver_note)
           VALUES ($1,$2,$3,$4)`,
          [id, c.key, c.value, c.topDriverNote],
        );
      }
      for (const e of events) {
        await client.query(
          `INSERT INTO index_events (ts, component_key, headline, source_category, score_delta, reading_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [e.ts, e.componentKey, e.headline, e.sourceCategory, e.scoreDelta, id],
        );
      }
      await client.query('COMMIT');
      return { ...reading, id };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async hydrate(rows: { id: number; ts: Date; composite: string; regime: string; content_hash: string }[]): Promise<StoredReading[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const comps = await this.pool.query(
      `SELECT reading_id, component_key, value, top_driver_note,
              (SELECT weight FROM index_components ic WHERE ic.key = component_key) AS weight
       FROM index_component_readings WHERE reading_id = ANY($1)`,
      [ids],
    );
    const byReading = new Map<number, StoredReading['components']>();
    for (const c of comps.rows) {
      const list = byReading.get(c.reading_id) ?? [];
      list.push({
        key: c.component_key as ComponentKey,
        value: Number(c.value),
        weight: Number(c.weight),
        topDriverNote: c.top_driver_note,
      });
      byReading.set(c.reading_id, list);
    }
    return rows.map((r) => ({
      id: r.id,
      ts: new Date(r.ts).toISOString(),
      composite: Number(r.composite),
      regime: r.regime as StoredReading['regime'],
      contentHash: r.content_hash,
      components: byReading.get(r.id) ?? [],
    }));
  }

  async latest(): Promise<StoredReading | null> {
    const res = await this.pool.query(
      'SELECT id, ts, composite, regime, content_hash FROM index_readings ORDER BY ts DESC LIMIT 1',
    );
    const [reading] = await this.hydrate(res.rows);
    return reading ?? null;
  }

  async history(from: Date, to: Date, granularity: Granularity): Promise<StoredReading[]> {
    const bucket = granularity === 'raw' ? null : granularity;
    const res = bucket
      ? await this.pool.query(
          `SELECT DISTINCT ON (date_trunc($3, ts)) id, ts, composite, regime, content_hash
           FROM index_readings WHERE ts BETWEEN $1 AND $2
           ORDER BY date_trunc($3, ts), ts DESC`,
          [from.toISOString(), to.toISOString(), bucket],
        )
      : await this.pool.query(
          `SELECT id, ts, composite, regime, content_hash
           FROM index_readings WHERE ts BETWEEN $1 AND $2 ORDER BY ts`,
          [from.toISOString(), to.toISOString()],
        );
    const rows = [...res.rows].sort((a, b) => +new Date(a.ts) - +new Date(b.ts));
    return downsample(await this.hydrate(rows));
  }

  async eventsByReading(readingId: number): Promise<DriverEvent[]> {
    const res = await this.pool.query(
      `SELECT ts, component_key, headline, source_category, score_delta
       FROM index_events WHERE reading_id = $1 ORDER BY ts`,
      [readingId],
    );
    return res.rows.map((e) => ({
      ts: new Date(e.ts).toISOString(),
      componentKey: e.component_key,
      headline: e.headline,
      sourceCategory: e.source_category,
      scoreDelta: Number(e.score_delta),
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
