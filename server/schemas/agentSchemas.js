const Joi = require('joi');
const { optionalEmailField } = require('./common');

const agentCreateSchema = Joi.object({
  id: Joi.string().trim().min(3).max(128).optional(),
  name: Joi.string().trim().min(2).max(120).required().messages({
    'string.min': 'Agent name must be at least 2 characters',
    'any.required': 'Agent name is required',
  }),
  company_name: Joi.string().trim().max(120).allow('').default(''),
  description: Joi.string().trim().max(8000).allow('').default(''),
  greeting_message: Joi.string().trim().max(500).allow('').default(''),
  widget_contact_email: optionalEmailField(),
  whatsapp_contact_email: optionalEmailField(),
  model: Joi.string().trim().max(64).default('gpt-4o-mini'),
  temperature: Joi.number().min(0).max(2).default(0.7),
  collection_name: Joi.string().trim().max(200).allow('').optional(),
  resource_list: Joi.array().items(Joi.string().trim().max(500)).default([]),
  public_embed: Joi.boolean().default(true),
  extra: Joi.object().unknown(true).optional(),
});

const agentPatchSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120),
  company_name: Joi.string().trim().max(120).allow(''),
  description: Joi.string().trim().max(8000).allow(''),
  greeting_message: Joi.string().trim().max(500).allow(''),
  widget_contact_email: optionalEmailField(),
  whatsapp_contact_email: optionalEmailField(),
  model: Joi.string().trim().max(64),
  temperature: Joi.number().min(0).max(2),
  public_embed: Joi.boolean(),
  resource_list: Joi.array().items(Joi.string().trim().max(500)),
})
  .min(1)
  .messages({ 'object.min': 'No fields provided for update' });

module.exports = {
  agentCreateSchema,
  agentPatchSchema,
};
