export type NotifyEvent =
  | 'human_intervention'
  | 'node_completed'
  | 'node_failed'
  | 'workflow_completed'
  | 'agent_stuck'
  | 'phase_changed'
  | 'error';

export interface NotificationBus {
  notify(event: NotifyEvent, payload: unknown): Promise<void>;
}

export class ConsoleBus implements NotificationBus {
  async notify(event: NotifyEvent, payload: unknown): Promise<void> {
    console.log(`[${new Date().toISOString()}] [${event}]`, JSON.stringify(payload));
  }
}
