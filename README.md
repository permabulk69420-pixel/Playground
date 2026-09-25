# VR Playground

Small Three.js/WebXR sandbox for testing VR mechanics without touching a game project.

## Current baseline

- Neutral grey 18 m test zone with grid floor, scale blocks and a target
- Animated Quest hands reused from the same pinned assets/poses as Oasis
- Trigger / grip / point hand poses
- Oasis-style VR locomotion:
  - left stick moves
  - right stick smooth-turns the player rig around the physical headset position
  - movement follows body/rig yaw rather than head-look direction
- Desktop WASD + mouse-look fallback
- `window.playground` exposes `THREE`, `renderer`, `scene`, `camera`, `rig` and `hands` for quick experiments

The hand state objects are available at `window.playground.hands.states`, including handedness, controller/grip nodes and the current XR input source. The magic blast uses those hooks without changing the locomotion controls.

## Run locally

```bash
npm install
npm run dev
```

## Clawd and the Little Star

`public/clawd-story.html` is a self-contained pixel-art animated story starring Clawd, drawn on a 96×120 canvas. Open the file directly in a browser, or visit `/clawd-story.html` on the dev server or the Pages site. Tap, click, Space or → skips to the next scene, and ← goes back.

## Magic blast

1. In VR, hold **A on the right controller** with your palms facing each other, roughly 20–60 cm apart.
2. Keep A held and slide your hands in opposite directions: one up while the other goes down, then reverse. Small circular movements also work. Streaks flow from your palms into the ball; more movement builds more charge.
3. Once the indicator says READY (22%), push **both hands forward together** to launch it. You can keep charging to 100% for a larger, faster blast.
4. Release A after firing, then hold it again to start the next ball. Releasing without pushing cancels the charge.

The in-world panel shows gesture hints, charge and target hits. Haptics signal charge and release. Shots hit the room, blocks and rear target, with sparks and a shockwave. The rear target flashes on a hit.

The desktop **Preview magic blast** button drives the same gesture recognizer with simulated hand motion. It previews the effect; actual Quest gesture comfort still needs a headset check.

`src/blast-gesture.js` contains the thresholds and motion recognition. It uses tracking-space positions and hand movement relative to the headset so joystick movement cannot fire a shot. `src/magic-blast.js` contains rendering, input, haptics and collision. `window.playground.magic` exposes the recognizer and shot/hit counts for tuning.
