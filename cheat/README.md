# Sub-20s Race Cheat

A Tampermonkey userscript that finishes the circuit and writes a configurable
result time (`00:20:660` by default).

The script does not edit the game sources. It grabs the live `Game` instance,
skips the countdown with `circuit.restart(true)` and teleports the chassis
through every checkpoint gate in order. The game's own checkpoint test and
`finish()` handler do the rest, so confetti, sounds and the result modal all
behave normally.

## 빠른 사용법 (한국어)

1. Tampermonkey 대시보드에서 새 스크립트를 만들고 `cheat/race-cheat.user.js`
   내용을 붙여넣은 뒤 저장합니다.
2. <https://racing.dkuaegis.org> 에 접속한 뒤 페이지를 새로고침합니다.
   (스크립트가 게임 생성 시점을 잡아야 하므로 새로고침이 필요합니다.)
3. 자동으로 완주하고 결과 화면에 20초 미만 기록이 표시됩니다 (약 0.5초).

표시 시간은 스크립트 상단의 `CONFIG.targetTime`(초)으로 정합니다. 기본값은
`20.66` 입니다.

```js
targetTime: 20.66, // 결과 화면에 00:20:660 표시 (기본값)
targetTime: 14.5,  // 00:14:500 표시
targetTime: null,  // 텔레포트만으로 나오는 최단 기록 (약 0.5초)
```

콘솔에서 직접 제어할 수도 있습니다.

```js
__raceCheat.run() // 다시 실행
__raceCheat.stop() // 훅 제거 및 중지
__raceCheat.game // 잡아낸 Game 인스턴스
```

로컬에서 직접 실행하려면:

```bash
npm install --force
cp .env.example .env   # VITE_GAME_PUBLIC=1 확인
npm run dev            # http://localhost:5173
```

자세한 옵션과 동작 원리는 아래 영어 문서를 참고하세요.

## Requirements

- Tampermonkey (or any userscript manager that supports `@grant none`)
- Node.js and `npm` only for the optional local setup

## Live site

The script already matches `https://racing.dkuaegis.org/*`. Install it, open the
site, reload the page and the race finishes on its own. The reload is required
because the script captures the game instance while the bundle is still
constructing it.

## Local setup (optional)

```bash
# Install dependencies (the repository does not ship node_modules)
npm install --force

# Expose the game instance as window.game (handy for debugging)
cp .env.example .env
# then set VITE_GAME_PUBLIC=1 inside .env

# Serve at the Vite default port (5173)
npm run dev
```

`.env` is gitignored. On the dev server the script reads `window.game` directly;
the production site is handled by the instance trap described below.

## Install

1. Open the Tampermonkey dashboard and create a new script.
2. Paste the contents of `cheat/race-cheat.user.js`.
3. The `@match` list already covers `racing.dkuaegis.org`, `localhost` and
   `127.0.0.1`. Add another line only for a different domain, for example
   `// @match https://race.example.com/*`.
4. Save, open the game and reload the page.

The paint picker appears for a moment, the car jumps through the gates and the
result modal shows the time from `CONFIG.targetTime` (`00:20:660` by default).

## Options

Edit the `CONFIG` object at the top of the script.

| Option | Default | Description |
| --- | --- | --- |
| `targetTime` | `20.66` | Result time in seconds. `null` keeps the fastest possible time (about 0.5s). Set `14.5` to display `00:14:500`. |
| `framesPerCheckpoint` | `3` | Frames between two teleports. Raise it to make the jump slower and more visible. |
| `startDelayMs` | `800` | Delay after the circuit is ready before the run starts. |
| `autoStart` | `true` | When `false`, the script waits for `window.__raceCheat.run()`. |

Manual control from the console:

```js
__raceCheat.run()    // start (or restart) a run
__raceCheat.stop()   // remove the tick hook and restore the bounds threshold
__raceCheat.config   // live CONFIG object
__raceCheat.game     // captured Game instance (undefined until it exists)
```

## How it works

- `waitForGame()` resolves the instance in three steps: `window.game` (dev
  server with `VITE_GAME_PUBLIC=1`), the trapped instance, then
  `import(location.origin + '/Game/Game.js')` + `Game.getInstance()`. It then
  waits for `game.world.areas.circuit` to exist.
- The production bundle keeps `Game` in module scope, so `window.game` is
  undefined there. The constructor runs `this.physicalVehicle = new
  PhysicsVehicle()` exactly once, so a one-shot setter on `Object.prototype`
  for `physicalVehicle` captures `this`, restores a normal own property and
  removes the trap. That is why the page must be reloaded after installing.
- `circuit.restart(true)` jumps straight to `STATE_RUNNING` and starts the timer
  without the overlay or the four second countdown.
- A tick callback registered at order `9` runs after the player/physics post
  processing (`5`/`6`) and before the area update (`10`), so a teleport is
  detected by the checkpoint test in the same frame.
- The car is moved to `checkpoints.target.position` with a `1.5` unit vertical
  offset, velocities are zeroed and `player.position` / `player.position2` are
  forced so a physics push cannot make the checkpoint test miss.
- `setCheckpoints()` assigns `count` before pushing the checkpoint, so `count`
  ends up as `items.length - 1`. `finish()` needs `reachedCount === count + 2`,
  which is one full lap plus the start line again: 9 checkpoints, 10 teleports.
  The script simply follows `checkpoints.target` until the state leaves
  `STATE_RUNNING`, so the exact count does not have to be hardcoded.
- `circuit.bounds.threshold` is temporarily set to `-Infinity` to prevent a
  respawn from cancelling the run, and restored when the run ends.
- With `targetTime` set, `circuit.timer.startTime` is rewritten on the frame of
  the final teleport, which makes `timer.end()` report exactly that value.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Game instance not found` in the console | Reload the page. The instance trap only fires while the game is being constructed, and the dev-server import path needs `npm run dev`. |
| Nothing happens on the live site | Confirm the URL matches `https://racing.dkuaegis.org/*` and reload after saving the script. |
| `__raceCheat.game` is `undefined` | The script ran after the game had already been built. Reload the page. |
| The script never runs | Check that the URL matches one of the `@match` lines and that Tampermonkey is allowed in incognito if you use it. |
| The result shows `00:00:000` | Expected when `targetTime` is `null` and the run is very short. Set `targetTime` to a readable value. |
| The car keeps respawning | Another script or a manual `R` press restarted the race. Reload the page and let the userscript run. |
