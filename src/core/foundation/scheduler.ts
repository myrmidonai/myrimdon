export interface Lease {
  runId: string;
  fencingToken: number;
}

export interface Scheduler {
  claim(runId: string): Promise<Lease | null>;
  renew(lease: Lease): Promise<void>;
  release(lease: Lease): Promise<void>;
}
