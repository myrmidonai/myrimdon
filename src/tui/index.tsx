import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import type Database from 'better-sqlite3';
import { OverviewTab } from './tabs/overview.js';
import { ReviewQueueTab } from './tabs/review-queue.js';
import { LogsTab } from './tabs/logs.js';
import { CronTab } from './tabs/cron.js';
import { ConfigTab } from './tabs/config-tab.js';
import type { StateStore } from '../core/foundation/state-store.js';

type Tab = 'overview' | 'review' | 'logs' | 'cron' | 'config';
const TABS: Tab[] = ['overview', 'review', 'logs', 'cron', 'config'];
const TAB_LABELS: Record<Tab, string> = {
  overview: '1:Overview', review: '2:Review', logs: '3:Logs', cron: '4:Cron', config: '5:Config',
};

interface AppProps { db: Database.Database; stateStore: StateStore; onExit?: (() => void) | undefined }

function App({ db, stateStore, onExit }: AppProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === '1') setActiveTab('overview');
    if (input === '2') setActiveTab('review');
    if (input === '3') setActiveTab('logs');
    if (input === '4') setActiveTab('cron');
    if (input === '5') setActiveTab('config');
    if (input === 'q' || key.escape) {
      if (onExit) onExit();
      exit();
    }
  });

  return (
    <Box flexDirection="column" height={process.stdout.rows ?? 24}>
      <Box borderStyle="single" paddingX={1}>
        {TABS.map((tab) => (
          <Box key={tab} marginRight={2}>
            <Text color={activeTab === tab ? 'cyan' : 'gray'} bold={activeTab === tab}>
              {TAB_LABELS[tab]}
            </Text>
          </Box>
        ))}
        <Box marginLeft={2}>
          <Text color="gray">[q] quit</Text>
        </Box>
      </Box>
      <Box flexGrow={1} padding={1}>
        {activeTab === 'overview' && <OverviewTab db={db} />}
        {activeTab === 'review' && <ReviewQueueTab db={db} stateStore={stateStore} />}
        {activeTab === 'logs' && <LogsTab stateStore={stateStore} />}
        {activeTab === 'cron' && <CronTab />}
        {activeTab === 'config' && <ConfigTab />}
      </Box>
    </Box>
  );
}

export function startTUI(db: Database.Database, stateStore: StateStore, onExit?: () => void) {
  // Ensure stdin is in raw mode for keyboard input (needed on Windows)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }

  const app = render(<App db={db} stateStore={stateStore} onExit={onExit} />);

  // Restore stdin on exit
  app.waitUntilExit().then(() => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  });
}
