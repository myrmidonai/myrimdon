import React from 'react';
import { Box, Text } from 'ink';
export function CronTab() {
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Timer State</Text>
      <Text>T1 workflowPoll  30s</Text>
      <Text>T2 heartbeat     15s</Text>
      <Text>T3 clientTimeout 60s</Text>
      <Text>T4 stuckDetect   60s</Text>
      <Text>T5 consistency   300s</Text>
    </Box>
  );
}
