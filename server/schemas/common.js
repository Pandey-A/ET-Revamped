const Joi = require('joi');

function normalizeMetaDigits(value) {
  const digits = String(value || '').trim().replace(/\D/g, '');
  return digits.length >= 8 ? digits : '';
}

function metaIdField(label) {
  return Joi.string()
    .trim()
    .required()
    .custom((value, helpers) => {
      const normalized = normalizeMetaDigits(value);
      if (!normalized) {
        return helpers.message(`${label} must contain at least 8 digits`);
      }
      return normalized;
    })
    .label(label);
}

function optionalMetaIdField(label) {
  return Joi.string()
    .trim()
    .custom((value, helpers) => {
      if (value === undefined || value === null || value === '') return value;
      const normalized = normalizeMetaDigits(value);
      if (!normalized) {
        return helpers.message(`${label} must contain at least 8 digits`);
      }
      return normalized;
    })
    .label(label);
}

function optionalEmailField() {
  return Joi.string()
    .trim()
    .lowercase()
    .allow('')
    .custom((value, helpers) => {
      if (!value) return '';
      const result = Joi.string().email({ tlds: { allow: false } }).validate(value);
      if (result.error) return helpers.message('Enter a valid email address');
      return value;
    });
}

function optionalUrlOrPathField(max = 2048) {
  return Joi.string()
    .trim()
    .max(max)
    .allow('')
    .custom((value, helpers) => {
      if (!value) return '';
      if (value.startsWith('/')) return value;
      try {
        const u = new URL(value);
        if (!['http:', 'https:'].includes(u.protocol)) {
          return helpers.message('Enter a valid http(s) URL or site path');
        }
        return value;
      } catch {
        return helpers.message('Enter a valid http(s) URL or site path');
      }
    });
}

module.exports = {
  normalizeMetaDigits,
  metaIdField,
  optionalMetaIdField,
  optionalEmailField,
  optionalUrlOrPathField,
};
