export function notFound(req, res) {
  res.status(404).json({ success: false, message: `No route for ${req.method} ${req.path}` });
}

export function errorHandler(error, req, res, _next) {
  console.error(error);
  if (error?.code === 11000) return res.status(409).json({ success: false, message: 'A record with that value already exists.' });
  if (error?.name === 'ValidationError' || error?.name === 'CastError') {
    return res.status(400).json({ success: false, message: error.message });
  }
  const status = error.status || 500;
  const message = status === 500 && process.env.NODE_ENV === 'production'
    ? 'Something went wrong. Please try again.'
    : error.message;
  res.status(status).json({ success: false, message });
}
