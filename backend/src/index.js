import app from './app.js';

const port = Number(process.env.PORT || 3000);

const server = app.listen(port, () => {
  console.log(`LIFE-LINK Backend running on port ${port} [${process.env.NODE_ENV || 'development'}]`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use by another process. Please stop the existing process or choose a different port.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

const handleShutdown = (signal) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(() => process.exit(0));
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
