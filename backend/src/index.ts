import 'dotenv/config';
import http from 'http';
import app from './app';
import { initSocket } from './services/socket.service';
import { initQueues } from './services/queue.service';
import { logger } from './utils/logger';

const PORT = process.env.PORT || 4000;

const server = http.createServer(app);
initSocket(server);
initQueues();

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
  process.exit(1);
});
