# AGENTS.md

## Project Overview

This repository contains a personal workout and body-composition tracking app. The product goal is to help the user run a data-informed training loop:

1. Import and inspect InBody measurements.
2. Record each workout while training.
3. Quantify training volume, effort, consistency, and progression.
4. Produce weekly coaching-style adjustments from the collected data.

The user is Korean, and product-facing copy may be Korean. Keep this file in English.

## Current Product Direction

- Build a mobile-first workout logging PWA that feels useful during an actual gym session.
- Prioritize fast set entry, clear targets, rest timing, and weekly review over marketing pages.
- Treat InBody data as a long-term signal, not a day-to-day verdict.
- Use training data to detect whether progressive overload, recovery, and adherence are actually happening.
- Keep the PWA focused on viewing and recording. Codex owns dynamic daily programming and periodic coaching review.
- Synchronize browser records to inspectable runtime-state files whenever the server is available.

## Repository Structure

- `index.html`: App shell.
- `src/styles.css`: App styling.
- `src/app.ts`: Client-side state, charts, persistence, and interactions.
- `src/core.ts`: Typed deterministic workout and InBody calculations.
- `src/types.ts`: Shared domain and API types.
- `scripts/dev-server.ts`: Local static and data API server.
- `scripts/build.ts`: Browser bundling and production server compilation.
- `scripts/coach-context.ts`: Produces the concise context Codex reads before programming.
- `scripts/validate-data.ts`: Validates profile, gym, plan, and workout records.
- `state/`: Untracked runtime data. It is the default local data root and must never be committed.
- `state/inbody/`: Raw InBody CSV exports supplied by the user.
- `state/data/profile.json`: Goal, schedule, experience, preferences, and safety constraints.
- `state/data/gyms/current.json`: Current gym equipment availability, condition, and notes.
- `state/data/plans/current.json`: Plan currently consumed by the PWA.
- `state/data/plans/YYYY-MM-DD.json`: Immutable dated plan snapshots created by Codex.
- `state/data/workouts/`: Workout session records synchronized from the PWA.
- `docs/`: Product and implementation plans.
- `DESIGN.md`: Apple-inspired, workout-specific interface rules.

## Commands

- `npm run dev`: Start the local app server.
- `npm run build`: Validate and copy the static app to `dist/`.
- `npm run typecheck`: Run the strict TypeScript check without emitting files.
- `npm test`: Run deterministic data-model tests.
- `npm run validate:data`: Validate agent- and app-authored JSON records.
- `npm run coach:context`: Print the current coaching context.

This app intentionally has no runtime package dependencies at the MVP stage.
All data-aware commands use `state/` by default. Set `WORKOUT_STATE_ROOT`,
`WORKOUT_DATA_DIR`, or `WORKOUT_INBODY_DIR` when the runtime state lives elsewhere.

## Development and Deployment Environment

Develop, test, commit, and deploy from the MacBook checkout at `~/Projects/workout`.
The Mac mini is both the production server and an optional remote Codex workspace,
reached with `ssh macmini`.

Keep its workspace, persistent state, and releases separate:

```text
~/Projects/workout/     Git checkout, Codex workspace, and persistent `state/`
~/Services/workout/     Immutable releases, `current` symlink, and service logs
```

- Edit source and runtime state only under `~/Projects/workout`.
- Never edit `~/Services/workout/current` directly or put persistent state inside a release.
- Prefer `npm run deploy:macmini` over ad hoc remote file changes.
- Before deployment, run the documented validation and push the source Git remote.
- When using the Mac mini checkout for Codex, update it with a fast-forward pull.
- Verify the service locally on the Mac mini and through its protected public endpoint.

Current production configuration:

- Service manager: `launchd`, label `com.joonyung.workout`
- Server: `127.0.0.1:5002`
- Public endpoint: `https://workout.joonyung.work`, protected by Cloudflare Access
- Deployment details: `docs/DEPLOYMENT.md`

## Data Handling

- Runtime state is not Git-tracked. Never add `state/` with a force flag.
- Do not overwrite or normalize the original CSV files in `state/inbody/`.
- Treat the CSV files as source data. Parse them into app state at runtime or import time.
- Save user-entered workout data to browser storage immediately.
- When the server is reachable, mirror workout, profile, and gym changes into `state/data/` so Codex can use them.
- Never delete a workout record merely because another device has an older copy. Merge by record id and `updatedAt`.
- If adding exports, prefer JSON and CSV formats that can be inspected and restored.
- New InBody uploads must be saved under `state/inbody/imports/`; never replace a supplied source file.

## Product Principles

- The first screen should be the actual workout surface, not a landing page.
- Keep controls dense, predictable, and usable on an iPhone-sized screen.
- Avoid decorative dashboards that do not improve a training decision.
- Show trends, target ranges, and review notes in a way that supports weekly decisions.
- Avoid medical claims. Phrase analysis as training guidance and observable patterns.

## Engineering Guidelines

- Keep the app dependency-light until a real need appears.
- Preserve source InBody data and user-entered records.
- Prefer simple, inspectable data models before introducing abstractions.
- Keep calculations deterministic and easy to audit.
- Add tests or validation scripts when changing parsing, persistence, or review calculations.

## Daily Program Generation

When the user asks Codex to create today's workout:

1. Run `npm run coach:context`.
2. Read `state/data/profile.json`, `state/data/gyms/current.json`, recent files in
   `state/data/workouts/`, and the latest InBody measurements. If a runtime
   path environment variable is set, use the resolved paths printed by step 1.
3. Follow `docs/COACHING_PROTOCOL.md`.
4. Use only equipment marked `available` or `limited`. If important equipment
   is `unknown`, include a substitution and state the assumption.
5. Create a dated plan in the runtime `data/plans/YYYY-MM-DD.json`.
6. Copy the exact same plan object to the runtime `data/plans/current.json`.
7. Run `npm run validate:data`, `npm test`, and `npm run build`.

Do not silently infer injuries, available machines, schedule, or recovery. A
missing value may be represented as an explicit assumption in a low-risk draft,
but it must not justify aggressive loading.

## Periodic Review

- Weekly review: compare the latest 7 days with the previous 3 weeks and change
  one primary programming variable at a time.
- Monthly review: evaluate 4-6 week adherence, performance, fatigue, gym
  constraints, and multi-measurement InBody trends.
- Record durable process changes in this file or `docs/COACHING_PROTOCOL.md`.
- Store a dated review in the runtime `data/reviews/` when a review produces a program change.

## Validation Checklist

Before handing off a meaningful change:

1. Run `npm run typecheck`, `npm test`, `npm run validate:data`, and `npm run build`.
2. Start `npm run dev` if the user needs to try the app.
3. Check that the app loads without console-blocking syntax errors.
4. Confirm InBody CSV parsing still works with the existing files.
5. Confirm local workout entries persist after refresh.
