'use strict';

function fail(code, message, status = 400, details) {
  const error = new Error(message);
  Object.assign(error, { code, status, details });
  throw error;
}

function object(value, field = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_INPUT', `${field} 必须是对象`);
  }
  return value;
}

module.exports = { fail, object };
