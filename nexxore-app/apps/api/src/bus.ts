import { EventEmitter } from 'node:events';
import type { RegimeValue, StoredReading } from './index-svc/types.js';

/** Internal event bus. `index.threshold_crossed` is consumed later by the
 *  Telegram bot (Prompt 13/14) and the decision feed (Prompt 11). */
export interface ThresholdCrossedEvent {
  from: RegimeValue;
  to: RegimeValue;
  reading: StoredReading;
}

export interface BusEvents {
  'index.threshold_crossed': (e: ThresholdCrossedEvent) => void;
}

class TypedBus extends EventEmitter {
  override emit<K extends keyof BusEvents>(event: K, ...args: Parameters<BusEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
  override on<K extends keyof BusEvents>(event: K, listener: BusEvents[K]): this {
    return super.on(event, listener);
  }
}

export const bus = new TypedBus();
