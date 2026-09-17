import app from './app.js';

const port = Number(process.env.PORT || 3000);

const server = app.listen(port, () => {
  console.log(`LIFE-LINK Backend running on port ${port} [${process.env.NODE_ENV || 'development'}]`);
});

const handleShutdown = (signal) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(() => process.exit(0));
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
