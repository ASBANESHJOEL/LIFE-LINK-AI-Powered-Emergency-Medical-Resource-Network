import crypto from 'crypto';

const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_\-.]{1,64}$/;

/**
 * Request correlation and structured logging middleware.
 * Generates or validates an incoming X-Request-Id, attaches it to the request and response,
 * and logs request metadata in structured JSON format without sensitive details.
 */
export function requestCorrelation(req, res, next) {
  const incomingId = req.headers['x-request-id'];
  const requestId = (typeof incomingId === 'string' && SAFE_REQUEST_ID_REGEX.test(incomingId.trim()))
    ? incomingId.trim()
    : crypto.randomUUID();

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1e6;

    // Extract path without query parameters to prevent leaking tokens, patient info, or secrets in query strings
    const rawUrl = req.originalUrl || req.url || '';
    const cleanRoute = rawUrl.split('?')[0] || '/';

    // Structured JSON log associating request ID, method, route, status code, duration, and timestamp.
    // Explicitly avoids logging query strings, passwords, OTPs, JWTs, tokens, auth headers, patient data, or coordinates.
    const logEntry = {
      timestamp: new Date().toISOString(),
      requestId,
      method: req.method,
      route: cleanRoute,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2))
    };

    if (process.env.NODE_ENV !== 'test' || process.env.ENABLE_TEST_REQUEST_LOGS === 'true') {
      console.log(JSON.stringify(logEntry));
    }
  });

  next();
}
