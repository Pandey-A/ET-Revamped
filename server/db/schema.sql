-- ElevateTrust: PostgreSQL schema (MongoDB migration target)
-- Run via: npm run db:migrate

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_email_verified BOOLEAN NOT NULL DEFAULT false,
  email_verified_at TIMESTAMPTZ,
  email_verification_token_hash TEXT,
  email_verification_token_expiry TIMESTAMPTZ,
  analysis_requests_used INTEGER NOT NULL DEFAULT 0 CHECK (analysis_requests_used >= 0),
  analysis_request_limit INTEGER NOT NULL DEFAULT 5 CHECK (analysis_request_limit >= 1),
  is_blocked BOOLEAN NOT NULL DEFAULT false,
  blocked_until TIMESTAMPTZ,
  reset_otp_hash TEXT,
  reset_otp_expiry TIMESTAMPTZ,
  reset_otp_attempts INTEGER NOT NULL DEFAULT 0,
  password_reset_token_hash TEXT,
  password_reset_token_expiry TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (lower(email));

CREATE TABLE IF NOT EXISTS usage_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  service_type TEXT NOT NULL CHECK (service_type IN ('video_upload', 'image_upload', 'url_paste')),
  file_name TEXT,
  pasted_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs (created_at DESC);

-- AI agents owned by a customer (user). Payload mirrors FastAPI /store/agents document + owner.
CREATE TABLE IF NOT EXISTS ai_agents (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  greeting_message TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  temperature REAL NOT NULL DEFAULT 0.7,
  escalation_channel TEXT NOT NULL DEFAULT 'none',
  collection_name TEXT NOT NULL DEFAULT '',
  resource_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_embed BOOLEAN NOT NULL DEFAULT true,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_owner ON ai_agents (owner_user_id);

-- Last widget generator snapshot per agent (JSON matches generator form + framework flags).
CREATE TABLE IF NOT EXISTS agent_widget_presets (
  agent_id TEXT PRIMARY KEY REFERENCES ai_agents (id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_widget_presets_owner ON agent_widget_presets (owner_user_id);
