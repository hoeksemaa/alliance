# Alliance

A web game for about 15 friends, based on Tank Turn Tactics. Each player is a tank on a 20 × 20 board. The game is slow: each tank gets 1 action point (AP) per day.

## Rules

- Each player picks a country flag in the lobby. Each flag belongs to one player only.
- At the start, each tank has 3 hearts, range 2 and 0 AP, on a random square. No tank starts in the range of another tank.
- At 22:00 New York time, each living tank gets 1 AP. (For tests, the admin can change this to every N minutes.)
- Actions:
  - Move 1 square up, down, left or right: 1 AP.
  - Shoot a tank in range: 1 AP. The tank loses 1 heart. At 0 hearts, it is destroyed.
  - Give 1 AP to a tank in range: 1 AP.
  - Extend your range by 1: 2 AP.
- Range is the square of size R around the tank, plus 1 more square straight out from the middle of each side.
- A destroyed tank leaves the board and joins the jury. Each night, each juror votes for one living tank. At the next AP drop, a tank with 3 or more votes gets 1 extra AP.
- The last living tank wins.
- There is no chat in the game.

## What each player can see

The server sends each player only what that player is allowed to see:

- All players see the positions, the player names, the flags and the destroyed tanks.
- Only you see your hearts, range and AP.
- A hit says only "You lost a heart". A gift says only "You got 1 AP from another tank".
- Only the victim learns who destroyed their tank. The News says only "X was destroyed."
- Only jurors see the jury votes, and who voted for whom.

## Accounts

- The first account becomes the admin account. It needs no invite code.
- Each later account needs the invite code. The admin page shows the code.
- A player signs in once on each device. Many devices are OK.
- The admin page opens, starts and ends the game, sets the AP timing, and removes players from the lobby.

## Run it on your computer

```sh
npm install
npm run dev
```

Then open http://localhost:3000. Without `DATABASE_URL`, the app keeps its data in an embedded Postgres (PGlite) in `.data/pglite`. To start again with no data, delete that folder.

## Tests

```sh
npm test           # rules, AP clock, game flow and the fog-of-war filter
npm run typecheck
```

The tests use an in-memory database.

## Deploy

1. Make a Postgres database on [Neon](https://neon.tech) (the free plan is enough).
2. Import this repository into Vercel.
3. In the Vercel project, set `DATABASE_URL` to the Neon connection string (the pooled one).
4. Deploy. The app makes its tables on the first request.
5. Open the site and make the first account. It becomes the admin account.

The AP drops need no cron job. The server applies each due AP drop at the next request from any player.

## How it works

- Next.js (App Router) on Vercel, with plain SQL on Postgres (`pg` on Neon, PGlite locally).
- `src/lib/game.ts` has the game rules. `src/lib/view.ts` decides what each player can see.
- `src/client/game-ui.js` draws the game screen. It comes from the design draft in `design/draft-1.html`.
- The page asks the server for new data every 5 seconds.

## Credits

Flag images: [flag-icons](https://github.com/lipis/flag-icons) by Panayiotis Lipiridis, MIT License.
