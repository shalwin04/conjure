# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Conjure is a mixed-reality instrument builder for Meta Quest. Describe an instrument or toy aloud, an AI agent builds it in AR, and you play it with bare hands. Entry for the Meta VR Start Developer Competition 2026 (Entertainment track).

Built on the Immersive Web SDK (IWSDK, WebXR). The IWSDK framework has non-standard patterns—see AGENTS.md for critical framework rules.

## Commands

```bash
npm run dev          # Start dev server + IWER headset emulator in Chrome
npm test             # Run hit-detection and spec validation tests (vitest)
npm run typecheck    # TypeScript check (always run before testing)
npm run build        # Production build
```

Desktop controls: `1` kalimba, `2` drum kit, `a` replay assembly, `r` recenter.
URL param: `?preset=drums` starts with drum kit.

## Architecture

The AI agent never writes rendering code. It produces a **Creation Spec** (JSON schema in `src/spec/schema.ts`). The engine converts specs into geometry, hand interactions, sound, and effects.

```
src/
├── spec/
│   ├── schema.ts        # Creation Spec (zod): parts, shapes, verbs, sounds
│   └── presets.ts       # Built-in creations (kalimba, drums)
├── engine/
│   ├── hands.ts         # WebXR hand joints → fingertips + palm with smoothed velocity
│   └── verbs.ts         # Interaction detection: strike/press (pure TS, server-shareable)
├── audio/
│   └── synth.ts         # Web Audio voices: membrane, noise, metal, pluck, bell, pad, bass...
├── render/
│   ├── build.ts         # Spec → Three.js meshes, styles, palettes
│   └── fx.ts            # Visual feedback: squash, flash, assembly animation
├── conjure-system.ts    # ECS system: orchestrates hands, verbs, sound, placement
├── conjure-components.ts# ECS component definitions
├── panel.ts             # UI panel system
└── index.ts             # World.create() + system registration
```

### Key Types

- **CreationT** (`spec/schema.ts`): The complete creation specification
- **PartT**: Individual instrument part (shape, position, verb, sound recipe)
- **Verb**: Interaction types: `strike`, `press`, `pluck`, `slide`, `grab`, `hover`, `none`
- **Voice**: Synth voices: `membrane`, `noise`, `metal`, `pluck`, `bell`, `pad`, `bass`, `theremin`, `fx`

### Data Flow

1. Creation Spec (JSON) → `validateCreation()` (enforces play zone, size limits)
2. Validated spec → `buildCreation()` → Three.js meshes + PartZone collision volumes
3. Per-frame: `HandTracker.update()` → fingertip positions + velocities
4. Per-frame: `VerbEngine.update()` → hit detection → events
5. Events → `Synth.play()` + visual effects

### Engine-Enforced Rules

The engine (not the AI) enforces:
- Parts stay inside play zone: x ±0.32m, y -0.12 to +0.42m, z -0.28 to +0.16m
- Size clamps: 0.005m to 0.4m
- Interactive parts (verb ≠ 'none') get default sound if none specified
- Max 24 parts per creation

### Console Debugging

```js
conjure.tuning.zoneScale = 1.5    // Hit zone size multiplier
conjure.tuning.minStrikeSpeed = 0.2  // Strike sensitivity
conjure.recenter()                // Re-place creation in front of user
conjure.load('drums')             // Switch preset
```

## IWSDK Framework (Critical)

See **AGENTS.md** for complete IWSDK rules. Key points:

- `iwsdk.config.json` is project authority, not `vite.config.ts`
- Import Three.js from `@iwsdk/core`, never from `three`
- Never allocate in `update()`—allocate in `init()` as class properties
- Use `entity.dispose()`, not `entity.destroy()` (memory leak)
- Create entities with `world.createTransformEntity()`, never `scene.add()`
- Always `npm run typecheck` before testing—type errors can stop systems silently
