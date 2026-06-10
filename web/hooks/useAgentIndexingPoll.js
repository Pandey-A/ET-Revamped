'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getAgentIndexingTasks,
  removeAgentIndexingTask,
  setAgentIndexingTask,
} from '@/lib/agentIndexing';

const AI_AGENT_API = process.env.NEXT_PUBLIC_AI_AGENT_API_URL || 'http://localhost:8000';

/**
 * Restores pending indexing tasks from localStorage and polls until they finish.
 */
export function useAgentIndexingPoll(agentId, { onTaskSuccess, onTaskError } = {}) {
  const [pendingTasks, setPendingTasks] = useState({});

  useEffect(() => {
    if (!agentId) {
      setPendingTasks({});
      return;
    }
    setPendingTasks(getAgentIndexingTasks(agentId));
  }, [agentId]);

  const clearTask = useCallback(
    (resourceKey) => {
      if (!agentId) return;
      removeAgentIndexingTask(agentId, resourceKey);
      setPendingTasks((prev) => {
        if (!prev[resourceKey]) return prev;
        const next = { ...prev };
        delete next[resourceKey];
        return next;
      });
    },
    [agentId]
  );

  const registerTask = useCallback(
    (resourceKey, taskId) => {
      if (!agentId || !resourceKey || !taskId) return;
      setAgentIndexingTask(agentId, resourceKey, taskId);
      setPendingTasks((prev) => ({ ...prev, [resourceKey]: taskId }));
    },
    [agentId]
  );

  useEffect(() => {
    if (!agentId) return undefined;
    const entries = Object.entries(pendingTasks);
    if (entries.length === 0) return undefined;

    const intervals = entries.map(([resourceKey, taskId]) =>
      setInterval(async () => {
        try {
          const res = await fetch(`${AI_AGENT_API}/index/status/${taskId}`);
          const data = await res.json();
          if (data.status === 'success') {
            clearTask(resourceKey);
            onTaskSuccess?.(resourceKey, data);
          } else if (data.status === 'error') {
            clearTask(resourceKey);
            onTaskError?.(resourceKey, data);
          }
        } catch {
          // keep polling on transient network errors
        }
      }, 3000)
    );

    const timeout = setTimeout(() => {
      intervals.forEach(clearInterval);
    }, 300000);

    return () => {
      intervals.forEach(clearInterval);
      clearTimeout(timeout);
    };
  }, [agentId, pendingTasks, clearTask, onTaskSuccess, onTaskError]);

  return {
    pendingTasks,
    pendingCount: Object.keys(pendingTasks).length,
    registerTask,
  };
}
