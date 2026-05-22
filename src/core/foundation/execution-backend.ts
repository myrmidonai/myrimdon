export interface SpawnOpts {
  execId: string;
  worktreePath: string;
  dispatchFilePath: string;
}

export interface WorkerHandle {
  pid: number;
  worktreePath: string;
  execId: string;
}

export interface HeartbeatStatus {
  alive: boolean;
  lastSeen: number; // epoch ms
}

export interface ExecutionBackend {
  spawn(opts: SpawnOpts): Promise<WorkerHandle>;
  heartbeat(handle: WorkerHandle): Promise<HeartbeatStatus>;
  kill(handle: WorkerHandle, signal: 'SIGTERM' | 'SIGKILL'): Promise<void>;
}
