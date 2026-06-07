-- WhatsApp channel UX config: welcome image, service menu, BCA reminders
ALTER TABLE whatsapp_channels
  ADD COLUMN IF NOT EXISTS config_json JSONB NOT NULL DEFAULT '{}'::jsonb;
