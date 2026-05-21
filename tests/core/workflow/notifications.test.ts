import { describe, it, expect, vi } from 'vitest';
import { ConsoleBus } from '../../../src/core/workflow/notifications.js';

describe('ConsoleBus', () => {
  it('calls notify without throwing', async () => {
    const bus = new ConsoleBus();
    await expect(bus.notify('node_completed', { nodeId: 'x' })).resolves.toBeUndefined();
  });

  it('logs to console', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const bus = new ConsoleBus();
    await bus.notify('node_failed', { nodeId: 'y', error: 'boom' });
    expect(spy).toHaveBeenCalledOnce();
    const logged = spy.mock.calls[0]?.[0] as string;
    expect(logged).toContain('node_failed');
    spy.mockRestore();
  });
});
