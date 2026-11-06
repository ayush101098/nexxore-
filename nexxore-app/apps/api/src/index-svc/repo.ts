import type { DriverEvent, IndexReading, StoredReading } from './types.js';

export type Granularity = 'raw' | 'hour' | 'day';

export interface IndexRepo {
  insertReading(reading: IndexReading, events: DriverEvent[]): Promise<StoredReading>;
  latest(): Promise<StoredReading | null>;
  /** Time-ascending readings in [from, to]. */
  history(from: Date, to: Date, granularity: Granularity): Promise<StoredReading[]>;
  eventsByReading(readingId: number): Promise<DriverEvent[]>;
  close(): Promise<void>;
}

const bucketKey = (ts: string, granularity: Granularity): string => {
  if (granularity === 'raw') return ts;
  const d = new Date(ts);
  d.setUTCMinutes(0, 0, 0);
  if (granularity === 'day') d.setUTCHours(0);
  return d.toISOString();
};

/** Downsample evenly to a cap (Prompt 05: ≤2,000 points per response). */
export function downsample<T>(points: T[], cap = 2000): T[] {
  if (points.length <= cap) return points;
  const step = points.length / cap;
  const out: T[] = [];
  for (let i = 0; i < cap; i++) out.push(points[Math.floor(i * step)]!);
  const last = points[points.length - 1]!;
  if (out[out.length - 1] !== last) out[out.length - 1] = last;
  return out;
}

/** In-memory implementation — active when DATABASE_URL is unset. The Postgres
 *  implementation (PgIndexRepo) follows the same contract over migration 002. */
export class MemoryIndexRepo implements IndexRepo {
  private readings: StoredReading[] = [];
  private events = new Map<number, DriverEvent[]>();
  private nextId = 1;

  async insertReading(reading: IndexReading, events: DriverEvent[]): Promise<StoredReading> {
    const stored: StoredReading = { ...reading, id: this.nextId++ };
    this.readings.push(stored);
    this.readings.sort((a, b) => a.ts.localeCompare(b.ts));
    this.events.set(stored.id, events);
    return stored;
  }

  async latest(): Promise<StoredReading | null> {
    return this.readings[this.readings.length - 1] ?? null;
  }

  async history(from: Date, to: Date, granularity: Granularity): Promise<StoredReading[]> {
    const inRange = this.readings.filter(
      (r) => new Date(r.ts) >= from && new Date(r.ts) <= to,
    );
    if (granularity === 'raw') return downsample(inRange);
    const buckets = new Map<string, StoredReading>();
    for (const r of inRange) buckets.set(bucketKey(r.ts, granularity), r); // last per bucket
    return downsample([...buckets.values()].sort((a, b) => a.ts.localeCompare(b.ts)));
  }

  async eventsByReading(readingId: number): Promise<DriverEvent[]> {
    return this.events.get(readingId) ?? [];
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
