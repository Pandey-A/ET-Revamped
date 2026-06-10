function validateBody(schema) {
  return function validateBodyMiddleware(req, res, next) {
    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((d) => d.message.replace(/"/g, ''));
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: details[0] || 'Invalid request payload',
        details,
      });
    }

    req.body = value;
    return next();
  };
}

module.exports = {
  validateBody,
};
