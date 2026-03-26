-- ============================================================
-- 002_rls_policies.sql
-- Row-Level Security for profiles and usage_logs
-- The backend uses the service_role key which bypasses RLS.
-- These policies enforce least-privilege for any anon/user key.
-- ============================================================

alter table profiles   enable row level security;
alter table usage_logs enable row level security;

-- ── profiles policies ─────────────────────────────────────────

-- Users can only read their own profile
create policy "users_select_own_profile"
  on profiles for select
  using (auth.uid() = id);

-- Users can only update their own profile
create policy "users_update_own_profile"
  on profiles for update
  using (auth.uid() = id);

-- Only service_role can insert (registration handled server-side)
-- No insert policy for authenticated role = only service_role inserts

-- Only service_role can delete
-- No delete policy for authenticated role

-- ── usage_logs policies ───────────────────────────────────────

-- Users can only read their own logs
create policy "users_select_own_logs"
  on usage_logs for select
  using (auth.uid() = user_id);

-- Users cannot insert directly (backend inserts via service_role only)
-- No insert policy for authenticated role

-- ── Admin policies (via service_role — no policy needed) ──────
-- All admin controller operations use the service_role key,
-- which bypasses RLS entirely. No admin-specific RLS policies required.

-- ── Grant usage to authenticated role ─────────────────────────
grant select, update on profiles   to authenticated;
grant select           on usage_logs to authenticated;
