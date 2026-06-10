const STORAGE_KEY = 'chattiq_agent_indexing_tasks';

export function getAgentIndexingTasks(agentId) {
  if (!agentId) return {};
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const tasks = all[agentId];
    return tasks && typeof tasks === 'object' ? tasks : {};
  } catch {
    return {};
  }
}

export function setAgentIndexingTask(agentId, resourceKey, taskId) {
  if (!agentId || !resourceKey || !taskId) return;
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!all[agentId]) all[agentId] = {};
    all[agentId][resourceKey] = taskId;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

export function removeAgentIndexingTask(agentId, resourceKey) {
  if (!agentId || !resourceKey) return;
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!all[agentId]) return;
    delete all[agentId][resourceKey];
    if (Object.keys(all[agentId]).length === 0) delete all[agentId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

export function countAgentIndexingTasks(agentId) {
  return Object.keys(getAgentIndexingTasks(agentId)).length;
}

/** Chat is allowed when the agent has indexed resources and nothing is still indexing. */
export function isAgentChatReady(agent, { localPendingCount = 0, uploading = false } = {}) {
  const hasResources = (agent?.resource_list?.length ?? 0) > 0;
  const storedPending = agent?.id ? countAgentIndexingTasks(agent.id) : 0;
  const pending = storedPending + localPendingCount;
  return hasResources && pending === 0 && !uploading;
}
