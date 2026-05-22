export interface Event {
  seq: number;
  run_id: string;
  type: string;
  payload_json: string;
  idempotency_key: string;
  created_at: string;
}

export type EventInput = Omit<Event, 'seq'>;

export interface Query {
  where?: Record<string, unknown>;
  orderBy?: string;
  limit?: number;
}

export interface StateStore {
  appendEvent(e: EventInput): Promise<Event>;
  readEvents(runId: string, since?: number): AsyncGenerator<Event>;
  projection<T>(table: string, query?: Query): Promise<T[]>;
}
