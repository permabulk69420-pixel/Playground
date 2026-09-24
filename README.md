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

The hand state objects are available at `window.playground.hands.states`, including handedness, controller/grip nodes and the current XR input source. That is the intended hook for gesture experiments such as the two-hand charged fireball.

## Run locally

```bash
npm install
npm run dev
```
