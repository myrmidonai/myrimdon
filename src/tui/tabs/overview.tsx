import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type Database from 'better-sqlite3';

interface ArtifactRow { id: string; status: string; node_id: string }

const STATUS_SYMBOL: Record<string, string> = {
  valid: '✅', generating: '🔄', running: '🔄', stale: '⚠️',
  invalid: '❌', needs_review: '👤', pending: '○', orphaned: '☠️',
};

export function OverviewTab({ db }: { db: Database.Database }) {
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);

  useEffect(() => {
    const refresh = () => {
      const rows = db.prepare('SELECT id, status, node_id FROM artifacts ORDER BY node_id').all() as ArtifactRow[];
      setArtifacts(rows);
    };
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [db]);

  if (artifacts.length === 0) return <Text color="gray">No artifacts yet.</Text>;

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Artifact Status</Text>
      {artifacts.map((a) => (
        <Box key={a.id}>
          <Text>{STATUS_SYMBOL[a.status] ?? '?'} </Text>
          <Text>{a.id}</Text>
          <Text color="gray"> ({a.node_id})</Text>
        </Box>
      ))}
    </Box>
  );
}
