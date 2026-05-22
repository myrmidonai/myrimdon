import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { StateStore, Event } from '../../core/foundation/state-store.js';

export function LogsTab({ stateStore }: { stateStore: StateStore }) {
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await stateStore.projection<Event>('events', { orderBy: 'seq DESC', limit: 50 });
      if (!cancelled) setEvents(all.reverse());
    })();
    const t = setInterval(async () => {
      const all = await stateStore.projection<Event>('events', { orderBy: 'seq DESC', limit: 50 });
      if (!cancelled) setEvents(all.reverse());
    }, 2000);
    return () => { cancelled = true; clearInterval(t); };
  }, [stateStore]);

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Event Log (last 50)</Text>
      {events.slice(-20).map((e) => (
        <Box key={e.seq}>
          <Text color="gray">[{e.seq}] </Text>
          <Text color="yellow">{e.type.padEnd(25)}</Text>
          <Text color="gray"> {e.run_id.slice(0, 8)}</Text>
        </Box>
      ))}
    </Box>
  );
}
