import React, { useState } from 'react';
import { render, Box, Text, useInput } from 'ink';
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

interface AppProps { db: Database.Database; stateStore: StateStore }

function App({ db, stateStore }: AppProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  useInput((input) => {
    if (input === '1') setActiveTab('overview');
    if (input === '2') setActiveTab('review');
    if (input === '3') setActiveTab('logs');
    if (input === '4') setActiveTab('cron');
    if (input === '5') setActiveTab('config');
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

export function startTUI(db: Database.Database, stateStore: StateStore) {
  render(<App db={db} stateStore={stateStore} />);
}
