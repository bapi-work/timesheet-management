import 'dotenv/config';
import http from 'http';
import app from './app';
import { initSocket } from './services/socket.service';
import { initQueues } from './services/queue.service';
import { ensureInitialAdmin, flagDemoCredentials } from './services/bootstrap';
import { logger } from './utils/logger';

const PORT = process.env.PORT || 4000;

const server = http.createServer(app);
initSocket(server);
initQueues();

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
  process.exit(1);
});

ensureInitialAdmin()
  .then(flagDemoCredentials)
  .then(() => {
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    logger.error('Startup failed:', err);
    process.exit(1);
  });
