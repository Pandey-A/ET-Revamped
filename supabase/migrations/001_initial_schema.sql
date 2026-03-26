-- ============================================================
-- 001_initial_schema.sql
-- Supabase migration: ElevateTrust AI deepfake platform
-- Equivalent to MongoDB User + UsageLog models
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────
create type user_role as enum ('user', 'admin');
create type service_type as enum ('video_upload', 'image_upload', 'url_paste');

-- ── profiles ─────────────────────────────────────────────────
-- Mirrors the Mongoose User model.
-- id is a UUID that MATCHES auth.users.id (set by trigger or migration script).
create table if not exists profiles (
  id                              uuid primary key references auth.users(id) on delete cascade,

  -- identity
  user_name                       text not null,
  email                           text not null unique,
  role                            user_role not null default 'user',

  -- email verification (custom token flow, NOT Supabase built-in)
  is_email_verified               boolean not null default false,
  email_verified_at               timestamptz default null,
  email_verification_token_hash   text default null,
  email_verification_token_expiry timestamptz default null,

  -- analysis quota
  analysis_requests_used          integer not null default 0 check (analysis_requests_used >= 0),
  analysis_request_limit          integer not null default 5  check (analysis_request_limit >= 1),

  -- account status
  is_blocked                      boolean not null default false,
  blocked_until                   timestamptz default null,

  -- forgot-password OTP (bcrypt-hashed, matches Mongoose fields exactly)
  reset_otp_hash                  text default null,
  reset_otp_expiry                timestamptz default null,
  reset_otp_attempts              integer not null default 0,

  -- password-reset token (issued after OTP verified, bcrypt hashed)
  password_reset_token_hash       text default null,
  password_reset_token_expiry     timestamptz default null,

  -- timestamps
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- ── usage_logs ────────────────────────────────────────────────
-- Mirrors the Mongoose UsageLog model.
create table if not exists usage_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  service_type service_type not null,
  file_name    text default null,
  pasted_url   text default null,
  created_at   timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────
create index if not exists idx_usage_logs_user_id      on usage_logs(user_id);
create index if not exists idx_usage_logs_service_type on usage_logs(service_type);
create index if not exists idx_usage_logs_created_at   on usage_logs(created_at desc);
create index if not exists idx_profiles_role           on profiles(role);
create index if not exists idx_profiles_email          on profiles(email);
