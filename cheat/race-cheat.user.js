// ==UserScript==
// @name         Folio 2025 - Sub-20s Race Cheat
// @namespace    https://github.com/msgctf/racing-car
// @version      1.0.0
// @description  Teleports the car through every checkpoint and writes a configurable result time.
// @match        https://racing.dkuaegis.org/*
// @match        http://localhost:*/*
// @match        http://127.0.0.1:*/*
// @match        https://localhost:*/*
// @match        https://127.0.0.1:*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// Add one more @match line if you host the game on another domain, for example:
// @match        https://race.example.com/*

(() => {
    'use strict'

    // ------------------------------------------------------------------
    // Options
    // ------------------------------------------------------------------
    const CONFIG = {
        // Result time written to the scoreboard, in seconds.
        // `null` keeps the fastest time the teleport sequence can produce
        // (roughly half a second).
        targetTime: 20.66,
        // Frames between two teleports. 3 is about 0.45s for all 9 gates
        // at 60fps and keeps the jump readable.
        framesPerCheckpoint: 3,
        // Delay after the circuit is ready before the run starts.
        startDelayMs: 800,
        // Set to false to keep the script idle until window.__raceCheat.run().
        autoStart: true
    }

    // CircuitArea.STATE_RUNNING
    const CIRCUIT_STATE_RUNNING = 3
    // Modals.CLOSED
    const MODALS_STATE_CLOSED = 3
    // Vertical offset above the checkpoint gate so the chassis never spawns
    // inside the road geometry.
    const TELEPORT_HEIGHT = 1.5
    // Keeps the displayed milliseconds from flooring one unit below the
    // requested value because of floating point noise.
    const TIME_EPSILON = 0.0005

    const LOG_PREFIX = '[race-cheat]'
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    // ------------------------------------------------------------------
    // Game instance resolution
    // ------------------------------------------------------------------
    let GameClass = null
    let trappedInstance = null
    let importTried = false
    let running = false
    let stopCurrentRun = null

    // Production builds bundle everything into one module, so the `Game` class
    // is not reachable from the page and `window.game` stays undefined.
    // The constructor assigns `this.physicalVehicle = new PhysicsVehicle()`
    // exactly once, so a one-shot setter on Object.prototype captures it.
    const installInstanceTrap = () => {
        if ('physicalVehicle' in Object.prototype) return

        try {
            Object.defineProperty(Object.prototype, 'physicalVehicle', {
                configurable: true,
                enumerable: false,
                get: () => undefined,
                set(value) {
                    // Restore a normal own property, then remove the trap.
                    Object.defineProperty(this, 'physicalVehicle', {
                        value,
                        writable: true,
                        enumerable: true,
                        configurable: true
                    })

                    if (!trappedInstance) {
                        trappedInstance = this
                        console.log(`${LOG_PREFIX} captured the game instance`)
                    }

                    delete Object.prototype.physicalVehicle
                }
            })
        } catch (error) {
            // Frozen Object.prototype: fall back to the other strategies.
        }
    }

    const getGame = () => window.game ?? trappedInstance ?? GameClass?.getInstance() ?? null

    const importGameClass = async () => {
        if (importTried) return
        importTried = true

        try {
            // Absolute URL: a userscript `import()` would otherwise resolve
            // against the extension origin instead of the page origin.
            const module = await import(`${location.origin}/Game/Game.js`)
            GameClass = module.Game ?? null
        } catch (error) {
            // Production builds have hashed chunks, so this is expected.
            GameClass = null
        }
    }

    // `new Game()` returns before the async `init()` finishes, so the instance
    // exists long before the race objects do.
    const isReady = (game) => {
        const circuit = game?.world?.areas?.circuit

        return !!(
            circuit?.checkpoints?.items?.length &&
            circuit.timer &&
            circuit.bounds &&
            game.ticker &&
            game.modals &&
            game.overlay?.mesh &&
            game.physicalVehicle?.chassis?.physical?.body &&
            game.player?.position2
        )
    }

    const waitForGame = async (timeoutMs = 60000) => {
        const startedAt = Date.now()
        const importAt = startedAt + 5000

        while (Date.now() - startedAt < timeoutMs) {
            const game = getGame()
            if (isReady(game)) return game

            if (!importTried && !getGame() && Date.now() >= importAt) await importGameClass()
            await sleep(100)
        }

        throw new Error(
            'Game instance not found. Reload the page so the userscript can hook the game ' +
            'constructor, or serve the game locally with VITE_GAME_PUBLIC=1 in `.env`.'
        )
    }

    // ------------------------------------------------------------------
    // Run
    // ------------------------------------------------------------------
    const run = async () => {
        if (running) return
        running = true

        try {
            const game = await waitForGame()
            await sleep(CONFIG.startDelayMs)

            if (CONFIG.targetTime !== null && (CONFIG.targetTime < 0 || CONFIG.targetTime >= 60))
                console.warn(`${LOG_PREFIX} targetTime looks like an invalid lap time`, CONFIG.targetTime)

            const circuit = game.world.areas.circuit
            const checkpoints = circuit.checkpoints
            const vehicle = game.physicalVehicle
            const body = vehicle.chassis.physical.body

            // Close the result modal if a previous run left it open.
            if (game.modals.state !== MODALS_STATE_CLOSED) game.modals.close(true)

            // Hide the paint picker.
            document.querySelector('.js-race-launcher')?.classList.add('is-hidden')

            // Skip the countdown and the overlay, then start the timer at once.
            circuit.restart(true)

            // Disable the out-of-bounds respawn while the car is teleporting.
            const boundsThreshold = circuit.bounds.threshold
            circuit.bounds.threshold = -Infinity

            const position = { x: 0, y: 0, z: 0 }
            let frame = 0
            let started = false

            const onTick = () => {
                if (circuit.state !== CIRCUIT_STATE_RUNNING) return
                started = true

                const target = checkpoints.target
                if (!target) return

                // Space the teleports so the jump stays readable.
                if (frame++ % CONFIG.framesPerCheckpoint !== 0) return

                // The last gate is the start line: reaching it calls finish().
                // Align the displayed time right before that happens.
                if (CONFIG.targetTime !== null && checkpoints.reachedCount === checkpoints.items.length)
                    circuit.timer.startTime = game.ticker.elapsed - (CONFIG.targetTime + TIME_EPSILON)

                position.x = target.position.x
                position.y = target.position.y + TELEPORT_HEIGHT
                position.z = target.position.z

                body.setTranslation(position, true)
                body.setLinvel({ x: 0, y: 0, z: 0 }, true)
                body.setAngvel({ x: 0, y: 0, z: 0 })

                // Keep every consumer (visuals, trails, checkpoint test) in
                // sync even if the physics step pushes the chassis away.
                vehicle.position.copy(position)
                game.player.position.copy(position)
                game.player.position2.set(position.x, position.z)
            }

            const stop = () => {
                game.ticker.events.off('tick', onTick)
                circuit.bounds.threshold = boundsThreshold
                stopCurrentRun = null
                running = false
            }

            stopCurrentRun = stop
            game.ticker.events.on('tick', onTick, 9)

            console.log(`${LOG_PREFIX} started with ${checkpoints.items.length + 1} gates`)

            // finish() switches the circuit to STATE_ENDING.
            const watch = setInterval(() => {
                if (!started || circuit.state === CIRCUIT_STATE_RUNNING) return

                clearInterval(watch)
                stop()

                console.log(
                    `${LOG_PREFIX} finished in ${circuit.timer.elapsedTime.toFixed(3)}s`,
                    `(${checkpoints.reachedCount} gates reached)`
                )
            }, 100)
        } catch (error) {
            running = false
            console.error(`${LOG_PREFIX} ${error.message}`)
        }
    }

    const stop = () => stopCurrentRun?.()

    // Must be installed before the game constructs itself.
    installInstanceTrap()

    window.__raceCheat = {
        run,
        stop,
        config: CONFIG,
        get game() { return getGame() }
    }

    if (CONFIG.autoStart)
        run()
})()
