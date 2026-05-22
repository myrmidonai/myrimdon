import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type Database from 'better-sqlite3';
import type { StateStore } from '../../core/foundation/state-store.js';

interface ReviewRow { id: string; node_id: string; file_path: string; run_id: string }

export function ReviewQueueTab({ db, stateStore }: { db: Database.Database; stateStore: StateStore }) {
  const [items, setItems] = useState<ReviewRow[]>([]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const refresh = () => {
      const rows = db.prepare("SELECT id, node_id, file_path, run_id FROM artifacts WHERE status='needs_review'").all() as ReviewRow[];
      setItems(rows);
    };
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [db]);

  useInput(async (input, key) => {
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(items.length - 1, s + 1));
    if (input === 'a' && items[selected]) {
      const item = items[selected];
      await stateStore.appendEvent({
        run_id: item.run_id, type: 'ARTIFACT_APPROVED',
        payload_json: JSON.stringify({ artifactId: item.id }),
        idempotency_key: `approve:${item.id}:${Date.now()}`,
        created_at: new Date().toISOString(),
      });
      db.prepare("UPDATE artifacts SET status='valid', updated_at=? WHERE id=?")
        .run(new Date().toISOString(), item.id);
    }
  });

  if (items.length === 0) return <Text color="gray">No items awaiting review.</Text>;

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Review Queue</Text>
      <Text color="gray">[a] approve  [↑↓] navigate</Text>
      {items.map((item, i) => (
        <Box key={item.id}>
          <Text color={i === selected ? 'cyan' : 'white'}>{i === selected ? '▶ ' : '  '}</Text>
          <Text>{item.id}</Text>
          <Text color="gray"> — {item.file_path}</Text>
        </Box>
      ))}
    </Box>
  );
}
