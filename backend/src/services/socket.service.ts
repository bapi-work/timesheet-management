import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';
import { logger } from '../utils/logger';

let io: SocketServer;

export function initSocket(server: HttpServer): void {
  io = new SocketServer(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true,
    },
  });

  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    try {
      const payload = verifyAccessToken(token);
      (socket as Socket & { user: typeof payload }).user = payload;
      next();
    } catch {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket as Socket & { user: { userId: string } }).user;
    socket.join(`user:${user.userId}`);
    logger.debug(`Socket connected: ${user.userId}`);

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${user.userId}`);
    });
  });

  logger.info('Socket.IO initialized');
}

export function emitToUser(userId: string, event: string, data: unknown): void {
  io?.to(`user:${userId}`).emit(event, data);
}

export function emitToRoom(room: string, event: string, data: unknown): void {
  io?.to(room).emit(event, data);
}
