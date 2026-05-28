const { query } = require('../db/pool');

async function upsertAccountSnapshot(userId, billing) {
  if (!userId || !billing) return;
  await query(
    `INSERT INTO user_credit_accounts (
       user_id, plan, available_credits, money_balance, billing_status,
       allow_overdraft, overdraft_rate, synced_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (user_id) DO UPDATE SET
       plan = EXCLUDED.plan,
       available_credits = EXCLUDED.available_credits,
       money_balance = EXCLUDED.money_balance,
       billing_status = EXCLUDED.billing_status,
       allow_overdraft = EXCLUDED.allow_overdraft,
       overdraft_rate = EXCLUDED.overdraft_rate,
       synced_at = now()`,
    [
      String(userId),
      billing.plan || 'Free',
      Number(billing.available_credits) || 0,
      Number(billing.money) || 0,
      billing.status || 'active',
      Boolean(billing.allow_overdraft),
      Number(billing.overdraft_rate) || 0,
    ]
  );
}

async function insertUsageEvents(userId, events) {
  if (!userId || !Array.isArray(events) || !events.length) return;
  for (const ev of events.slice(0, 20)) {
    await query(
      `INSERT INTO credit_usage_events (user_id, channel, charge_type, amount, session_id, agent_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
      [
        String(userId),
        ev.channel || 'unknown',
        ev.charge_type || 'credit',
        Number(ev.amount) || 1,
        ev.session_id || null,
        ev.agent_id || null,
        ev.at || null,
      ]
    );
  }
}

async function listRecentUsage(userId, limit = 50) {
  const r = await query(
    `SELECT channel, charge_type, amount, session_id, agent_id, occurred_at
     FROM credit_usage_events
     WHERE user_id = $1
     ORDER BY occurred_at DESC
     LIMIT $2`,
    [String(userId), Math.min(Math.max(limit, 1), 100)]
  );
  return r.rows;
}

module.exports = {
  upsertAccountSnapshot,
  insertUsageEvents,
  listRecentUsage,
};
