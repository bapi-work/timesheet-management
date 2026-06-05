import { TokenPayload } from '../utils/jwt';

declare global {
  namespace Express {
    interface User extends TokenPayload {}
  }
}
