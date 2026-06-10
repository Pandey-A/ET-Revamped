const MASKED_TOKEN = '••••••••';

function normalizeMetaDigits(value) {
  const digits = String(value || '').trim().replace(/\D/g, '');
  return digits.length >= 8 ? digits : '';
}

function isValidEmail(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

export function validateWhatsAppChannelForm(form, { isEdit = false } = {}) {
  const errors = [];

  const waba = normalizeMetaDigits(form.whatsapp_business_account_id);
  if (!waba) errors.push('WhatsApp Business Account ID must contain at least 8 digits');

  const phoneId = normalizeMetaDigits(form.phone_number_id);
  if (!phoneId) errors.push('Phone Number ID must contain at least 8 digits');

  const token = String(form.access_token || '').trim();
  if (!isEdit && (!token || token === MASKED_TOKEN || token.length < 20)) {
    errors.push('Access token is required (minimum 20 characters)');
  }
  if (isEdit && token && !token.includes('••••') && token.length < 20) {
    errors.push('Access token looks too short');
  }

  if (!String(form.ai_agent_id || '').trim()) {
    errors.push('Linked AI agent is required');
  }

  const { config_json: _configJson, ...channelFields } = form;

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      ...channelFields,
      whatsapp_business_account_id: waba || form.whatsapp_business_account_id,
      phone_number_id: phoneId || form.phone_number_id,
    },
  };
}

export function validateAgentCreateForm(form) {
  const errors = [];
  const name = String(form.name || '').trim();
  if (name.length < 2) errors.push('Agent name must be at least 2 characters');
  if (name.length > 120) errors.push('Agent name is too long');

  if (form.widget_contact_email && !isValidEmail(form.widget_contact_email)) {
    errors.push('Enter a valid widget contact email');
  }
  if (form.whatsapp_contact_email && !isValidEmail(form.whatsapp_contact_email)) {
    errors.push('Enter a valid WhatsApp contact email');
  }

  return { ok: errors.length === 0, errors };
}

export function formatApiValidationError(data) {
  if (Array.isArray(data?.details) && data.details.length) {
    return data.details[0];
  }
  return data?.message || data?.detail || 'Validation failed';
}
