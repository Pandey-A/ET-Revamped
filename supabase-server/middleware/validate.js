function validateBody(schema) {
  return function validateBodyMiddleware(req, res, next) {
    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: error.details[0].message,
        details: error.details.map((d) => d.message),
      });
    }

    req.body = value;
    return next();
  };
}

module.exports = {
  validateBody,
};
