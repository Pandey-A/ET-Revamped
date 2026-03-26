-- ============================================================
-- 003_functions.sql
-- Atomic DB functions for analysis quota management.
-- Replaces MongoDB findOneAndUpdate with $lt guard + $inc.
-- ============================================================

-- ── consume_analysis_quota ────────────────────────────────────
-- Atomically checks and increments analysis_requests_used.
-- Returns the updated quota row, or NULL if quota already at limit.
-- Equivalent to:
--   User.findOneAndUpdate(
--     { _id, analysisRequestsUsed: { $lt: analysisRequestLimit } },
--     { $inc: { analysisRequestsUsed: 1 } },
--     { new: true }
--   )
create or replace function consume_analysis_quota(p_user_id uuid)
returns table (
  analysis_requests_used  integer,
  analysis_request_limit  integer,
  remaining               integer,
  upgrade_required        boolean,
  quota_consumed          boolean
)
language plpgsql
security definer
as $$
declare
  v_used  integer;
  v_limit integer;
begin
  -- Lock the row and read current state
  select analysis_requests_used, analysis_request_limit
    into v_used, v_limit
    from profiles
   where id = p_user_id
     for update;

  if not found then
    raise exception 'user_not_found' using hint = 'Profile row does not exist';
  end if;

  if v_used >= v_limit then
    -- Quota exhausted — do NOT increment, return current state
    return query select
      v_used,
      v_limit,
      0,
      true,
      false;
    return;
  end if;

  -- Increment
  update profiles
     set analysis_requests_used = analysis_requests_used + 1,
         updated_at = now()
   where id = p_user_id;

  v_used := v_used + 1;

  return query select
    v_used,
    v_limit,
    greatest(v_limit - v_used, 0),
    (v_limit - v_used) = 0,
    true;
end;
$$;

-- ── rollback_analysis_quota ───────────────────────────────────
-- Decrements analysis_requests_used by 1 (floor 0).
-- Called when the upstream analysis service returns an error.
-- Equivalent to:
--   User.findByIdAndUpdate(userId, { $inc: { analysisRequestsUsed: -1 } })
create or replace function rollback_analysis_quota(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update profiles
     set analysis_requests_used = greatest(analysis_requests_used - 1, 0),
         updated_at = now()
   where id = p_user_id;
end;
$$;

-- Grant execute to service_role (backend uses service_role key)
grant execute on function consume_analysis_quota(uuid)  to service_role;
grant execute on function rollback_analysis_quota(uuid) to service_role;
