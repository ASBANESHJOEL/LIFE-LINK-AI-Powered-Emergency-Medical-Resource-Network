/**
 * Detects sensitive leakage patterns: SQL statements, database catalog details, internal file paths, or credentials.
 */
function isSensitiveLeakage(message) {
  if (!message || typeof message !== 'string') return false;
  const containsSql = (
    /\b(SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+[\s\S]+?\s+SET|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE\s+TABLE)\b/i.test(message) ||
    /\b(pg_catalog|information_schema|pg_class|public\.[a-z0-9_]+)\b/i.test(message) ||
    /\b(syntax error at or near|relation "[^"]+" does not exist|column "[^"]+" does not exist|duplicate key value violates unique constraint)\b/i.test(message) ||
    /\bSELECT\b[\s\S]*?\bFROM\b/i.test(message)
  );
  const containsPaths = (
    /(?:[A-Za-z]:[\\/]|(?:\/|\\))(?:Users|home|var|etc|app|src|node_modules|backend)[\\/]/i.test(message) ||
    /\.(js|ts|jsx|tsx|json):\d+(?::\d+)?\b/.test(message)
  );
  const containsSecrets = (
    /Bearer\s+[a-zA-Z0-9_\-.]+/i.test(message) ||
    /sb_secret_[a-zA-Z0-9_\-]+/i.test(message) ||
    /service_role/i.test(message) ||
    /eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}/.test(message)
  );
  return Boolean(containsSql || containsPaths || containsSecrets);
}

/**
 * Sanitizes error messages to prevent leaking SQL details, file paths, or internal secrets,
 * regardless of HTTP status code, while preserving normal domain error messages.
 */
function getSafeMessage(message, statusCode, isProd) {
  if (!message || typeof message !== 'string') {
    return statusCode >= 500 ? 'An unexpected error occurred.' : 'The requested operation could not be completed.';
  }

  // Any error (4xx or 5xx) containing sensitive SQL, paths, or secrets must be sanitized
  if (isSensitiveLeakage(message)) {
    return statusCode >= 500 ? 'An unexpected error occurred.' : 'Invalid request payload or operation.';
  }

  // In production, unexpected 5xx errors should never leak internal details
  if (statusCode >= 500 && isProd) {
    return 'An unexpected error occurred.';
  }

  return message;
}

/**
 * Centralized production-hardened Express error handler.
 * Ensures consistent structured JSON responses and prevents data leakage.
 */
export function errorHandler(err, req, res, _next) {
  const isProd = process.env.NODE_ENV === 'production';
  let statusCode = err.status || err.statusCode || (res.statusCode >= 400 ? res.statusCode : 500);

  // Handle malformed JSON body from express.json()
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Malformed JSON payload provided in request body.',
        requestId: req.id || null
      }
    });
  }

  // Map default codes based on HTTP status
  let errorCode = err.code;
  if (!errorCode) {
    switch (statusCode) {
      case 400:
        errorCode = 'INVALID_INPUT';
        break;
      case 401:
        errorCode = 'UNAUTHORIZED';
        break;
      case 403:
        errorCode = 'FORBIDDEN';
        break;
      case 404:
        errorCode = 'NOT_FOUND';
        break;
      case 409:
        errorCode = 'CONFLICT';
        break;
      case 503:
        errorCode = 'SERVICE_UNAVAILABLE';
        break;
      default:
        errorCode = 'INTERNAL_SERVER_ERROR';
    }
  }

  // Safe message formatting across all HTTP status codes
  const safeMessage = getSafeMessage(err.message, statusCode, isProd);

  const responseBody = {
    error: {
      code: errorCode,
      message: safeMessage,
      ...(req.id ? { requestId: req.id } : {})
    }
  };

  // Safe internal logging of unexpected server errors
  if (statusCode >= 500 && process.env.NODE_ENV !== 'test') {
    console.error(`[INTERNAL_ERROR] [RequestId: ${req.id || 'N/A'}]`, {
      code: errorCode,
      message: err.message,
      stack: isProd ? undefined : err.stack
    });
  }

  return res.status(statusCode).json(responseBody);
}

/**
 * 404 handler for unknown routes.
 * Uses req.path (pathname only) to avoid echoing query-string secrets.
 */
export function notFoundHandler(req, res) {
  const pathname = req.path || '/';
  return res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${pathname}`,
      ...(req.id ? { requestId: req.id } : {})
    }
  });
}
