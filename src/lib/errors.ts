// An error that is safe to show to the player (a broken rule, a wrong password, and so on).
export class GameError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "GameError";
  }
}
