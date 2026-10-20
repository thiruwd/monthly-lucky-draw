export function errorHandler(logger = console) {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error.status || 500;
    let code = error.code || 'INTERNAL_ERROR';
    let message = status < 500 ? error.message : 'Something went wrong. Refresh the dashboard and try again.';
    if (error.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'The request contains invalid JSON.'; }
    if (error.type === 'entity.too.large') { status = 413; code = 'BODY_TOO_LARGE'; message = 'The request is too large.'; }
    if (['ER_DUP_ENTRY', '23505'].includes(code)) { status = 409; code = 'DUPLICATE_MEMBER_CODE'; message = 'This member code is already registered or reserved by a deleted participant.'; }
    if (['ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK', '55P03', '40P01', '40001'].includes(code)) {
      status = 503; code = 'DATABASE_BUSY'; message = 'Another administrator is updating the draw. Refresh and try again.';
    }
    if (['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(code)) {
      status = 503; code = 'DATABASE_UNAVAILABLE'; message = 'The database is temporarily unavailable. Try again shortly.';
    }
    if (status >= 500) logger.error({ event: 'request_failed', code, path: req.path });
    res.status(status).json({ error: { code, message, ...(error.details ? { details: error.details } : {}) } });
  };
}
