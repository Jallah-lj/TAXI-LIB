declare global {
  namespace Express {
    interface Request {
      playerId?: string;
    }
  }
}

export {};
