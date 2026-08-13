# Workout OS

A mobile-first workout logging PWA built around a simple coaching loop:

1. Codex reads the athlete profile, gym equipment, recent workouts, and InBody history.
2. Codex creates the next workout plan.
3. The PWA guides the session and records each set.
4. Completed sessions become context for the next plan and weekly review.

The app uses plain HTML, CSS, JavaScript, and Node.js with no runtime package dependencies.

## Features

- Fast set logging designed for phone use in the gym
- Target weights, rep ranges, RPE, warm-ups, and rest timers
- Local-first browser persistence with server-side JSON synchronization
- InBody trend parsing and progress summaries
- Codex-ready coaching context and deterministic data validation
- Installable PWA with offline app-shell caching

## Quick start

```bash
git clone https://github.com/joonyung/workout.git
cd workout
npm run dev
```

Open `http://127.0.0.1:5002`.

To test from another device on the same network:

```bash
HOST=0.0.0.0 npm run dev
```

## Runtime data

Personal data is stored under `state/` and is intentionally excluded from Git:

```text
state/
  data/profile.json
  data/gyms/current.json
  data/plans/current.json
  data/plans/YYYY-MM-DD.json
  data/workouts/
  inbody/
```

The browser reads current data from `/api/bootstrap` and writes workout records back to
the server. Code deployments never copy or overwrite `state/`.

Runtime paths can be changed with `WORKOUT_STATE_ROOT`, `WORKOUT_DATA_DIR`, and
`WORKOUT_INBODY_DIR`.

## Commands

```bash
npm run dev             # Start the local server
npm run coach:context   # Print concise coaching context
npm run validate:data   # Validate runtime JSON files
npm test                # Run deterministic tests
npm run build           # Create the static dist/ output
npm run deploy:macmini  # Deploy through the configured macmini SSH host
```

## Production model

The reference deployment runs the Node server on loopback under `launchd`, with a
Cloudflare Tunnel and Cloudflare Access in front of it. Application releases and
persistent state remain separate.

See [deployment instructions](docs/DEPLOYMENT.md), [coaching rules](docs/COACHING_PROTOCOL.md),
and [agent instructions](AGENTS.md) for details.
