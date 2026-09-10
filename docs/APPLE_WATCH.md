# Apple Watch companion app

## Product boundary

The iPhone PWA remains the full workout log and review surface. The native watchOS
app is an execution surface for brief interactions:

1. Fetch the current plan and any matching session from the server.
2. Show set targets in kg or lb without converting the entered display unit.
3. Edit weight, repetitions, and RPE and mark a set complete.
4. Start a rest timer with a local notification and haptic feedback.
5. Record cardio duration, optional distance and heart rate, and RPE.
6. Finish and synchronize the same workout JSON consumed by the PWA.

The watch app caches the active session locally. Failed writes remain visible as
pending and retry when the app becomes active or the user refreshes.

## Architecture

```text
iPhone configuration app ── WatchConnectivity ──> watchOS Keychain
                                                    │
                                                    │ HTTPS + Access service token
                                                    ▼
Cloudflare Access ──> GET /api/watch/bootstrap ──> current plan + matching session
                  └─> POST /api/workouts ────────> shared workout state
```

`GET /api/watch/bootstrap` intentionally omits profile, gym equipment, InBody,
and unrelated workout history to keep the response small on Apple Watch.

The app is capable of running independently after initial configuration. The
iPhone companion exists because entering a long service-token secret on a watch
is impractical; WatchConnectivity is not the primary workout data path.

## Security setup

Do not commit or paste Cloudflare credentials into source files.

1. Create a dedicated Cloudflare Access Service Token for the watch app.
2. Add a Service Auth policy accepting that token to the existing self-hosted
   Access application for `workout.joonyung.work`.
3. Install the iPhone and watch apps.
4. Enter the server URL, Client ID, and Client Secret once in the iPhone app.
5. Tap **Save and send to Watch**, then use **Test server connection**.

The iPhone and watch apps keep credentials in their own Keychains. The secret is
transferred as application context over WatchConnectivity and is never written
to the repository or workout runtime state.

## Generate and build

Requirements:

- Full Xcode with the iOS and watchOS SDKs
- XcodeGen (`brew install xcodegen`)
- An Apple development team selected for both targets

Generate the project:

```sh
npm run watch:project
open apple/WorkoutWatch/WorkoutWatch.xcodeproj
```

In Xcode, select the same development team for `WorkoutCompanion` and
`WorkoutWatch`, then run the companion scheme on a paired iPhone and Apple Watch.
WatchConnectivity behavior must be checked on physical paired devices.

The shared Codable models and session factory can be tested without generating
the Xcode project:

```sh
npm run watch:test
```

## Current limitations

- Heart rate is entered manually; HealthKit workout-session integration is not
  part of the first version.
- There is no complication or Smart Stack widget yet.
- Simultaneous offline session creation on iPhone and watch can create two IDs.
  Once either device has synchronized, both reuse the server's session for the
  current plan.
