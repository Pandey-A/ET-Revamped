const Joi = require('joi');
const { metaIdField, optionalMetaIdField, optionalUrlOrPathField } = require('./common');

const MASKED_TOKEN = '••••••••';

const whatsAppServiceSchema = Joi.object({
  id: Joi.string().trim().min(1).max(64).required(),
  title: Joi.string().trim().min(1).max(200).required(),
  description: Joi.string().trim().max(2000).allow('').default(''),
  image_url: optionalUrlOrPathField(2048).default(''),
});

const whatsAppConfigSchema = Joi.object({
  welcome_message: Joi.string().trim().max(4096).allow('').default(''),
  service_menu_message: Joi.string().trim().max(1024).allow('').default(''),
  welcome_image_url: optionalUrlOrPathField(2048).default(''),
  welcome_timing: Joi.object({
    after_image_sec: Joi.number().integer().min(0).max(120).default(0),
    after_greeting_sec: Joi.number().integer().min(0).max(120).default(0),
    menu_typing_sec: Joi.number().integer().min(0).max(120).default(0),
  }).optional(),
  services: Joi.array().items(whatsAppServiceSchema).max(20).default([]),
  bca_reminder: Joi.object({
    enabled: Joi.boolean().default(false),
    interval_days: Joi.number().integer().min(1).max(365).default(45),
    message: Joi.string().trim().max(2000).allow('').default(''),
  }).optional(),
}).unknown(true);

const whatsAppChannelCreateSchema = Joi.object({
  whatsapp_business_account_id: metaIdField('WhatsApp Business Account ID'),
  phone_number_id: metaIdField('Phone Number ID'),
  display_phone_number: Joi.string().trim().max(32).allow('').default(''),
  access_token: Joi.string()
    .trim()
    .min(20)
    .max(4096)
    .invalid(MASKED_TOKEN)
    .required()
    .messages({
      'any.invalid': 'Access token is required',
      'string.min': 'Access token looks too short',
    }),
  ai_agent_id: Joi.string().trim().min(3).max(128).required().messages({
    'any.required': 'Linked AI agent is required',
    'string.min': 'Linked AI agent is required',
  }),
  ai_agent_name: Joi.string().trim().max(120).allow('').default(''),
  admin_phone: Joi.string().trim().max(20).allow('').default(''),
  config_json: whatsAppConfigSchema.default({}),
});

const whatsAppChannelUpdateSchema = Joi.object({
  whatsapp_business_account_id: optionalMetaIdField('WhatsApp Business Account ID'),
  phone_number_id: optionalMetaIdField('Phone Number ID'),
  display_phone_number: Joi.string().trim().max(32).allow(''),
  access_token: Joi.string()
    .trim()
    .min(20)
    .max(4096)
    .custom((value, helpers) => {
      if (!value || value.includes('••••')) return undefined;
      return value;
    })
    .optional(),
  ai_agent_id: Joi.string().trim().min(3).max(128),
  ai_agent_name: Joi.string().trim().max(120).allow(''),
  admin_phone: Joi.string().trim().max(20).allow(''),
  config_json: whatsAppConfigSchema,
})
  .min(1)
  .messages({ 'object.min': 'No fields provided for update' });

const whatsAppBroadcastPreviewSchema = Joi.object({
  audience: Joi.string().trim().valid('manual', 'leads', 'all', 'contacts').default('manual'),
  phones: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().trim().min(8).max(20)),
      Joi.string().trim().allow('')
    )
    .default([]),
});

module.exports = {
  whatsAppChannelCreateSchema,
  whatsAppChannelUpdateSchema,
  whatsAppBroadcastPreviewSchema,
};
