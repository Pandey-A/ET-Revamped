const Joi = require('joi');

const registerSchema = Joi.object({
  userName: Joi.string().trim().min(3).max(60).required(),
  email: Joi.string().trim().lowercase().email().required(),
  password: Joi.string().min(8).max(128).required().messages({
    'string.min': 'Password must be at least 8 characters long',
  }),
  role: Joi.string().valid('user', 'admin').optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  password: Joi.string().min(8).max(128).required().messages({
    'string.min': 'Password must be at least 8 characters long',
  }),
});

const verifyEmailSchema = Joi.object({
  token: Joi.string().required(),
});

const resendVerificationSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
});

const verifyOtpSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  otp: Joi.string().pattern(/^\d{6}$/).required(),
});

const resetPasswordSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  resetToken: Joi.string().required(),
  newPassword: Joi.string().min(8).max(128).required().messages({
    'string.min': 'Password must be at least 8 characters long',
  }),
});

module.exports = {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
};
