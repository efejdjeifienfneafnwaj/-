export const meta = {
  name: 'auric-vow-visual-overhaul',
  description: 'Apply the art-direction work order across five owned workstreams, then verify the build',
  phases: [
    { title: 'Implement', detail: 'one engineer per workstream, disjoint file ownership' },
    { title: 'Verify', detail: 'typecheck and build the merged result' },
  ],
}

const ROOT = '/home/user/-/auric-vow'
const ORDER_PATH = args && args.orderPath ? args.orderPath : 'qa/work-order-r1.md'
const MAP_PATH = args && args.mapPath ? args.mapPath : 'qa/map.md'
const ROUND = args && args.round ? args.round : 1
const NOTES = args && args.notes ? args.notes : ''

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    workstream: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          what: { type: 'string' },
          addressesTask: { type: 'string' },
        },
        required: ['file', 'what'],
      },
    },
    typecheckClean: { type: 'boolean' },
    notDone: { type: 'array', items: { type: 'string' }, description: 'tasks deliberately left, with why' },
    riskNotes: { type: 'array', items: { type: 'string' } },
  },
  required: ['workstream', 'changes', 'typecheckClean'],
}

const STREAMS = [
  {
    key: 'environment-art',
    owns: [
      'src/game/world/ShrineStation.tsx',
      'src/game/world/materials.ts',
      'src/game/world/Skybox.tsx',
      'src/game/world/Lighting.tsx',
      'src/game/world/Fog.tsx',
      'src/game/world/EnvironmentFX.tsx',
      'src/game/textures.ts',
    ],
    charter:
      'Make the level read as carved Orokin architecture rather than untextured primitives. That means real surface detail (procedural normal/roughness/AO maps generated in textures.ts), ornament and trim density on columns, arches and floors, depth in the value range (true darks in recesses, controlled highlights), a lighting rig with direction and contrast rather than uniform fill, and a sky that supports the composition. Do not move any collider or change layout.ts geometry bounds — visual dressing only, so collision never drifts from what is drawn.',
  },
  {
    key: 'player-frame',
    owns: [
      'src/game/player/PlayerRig.tsx',
      'src/game/player/CameraRig.tsx',
      'src/game/player/PlayerController.tsx',
      'src/game/player/movementConfig.ts',
    ],
    charter:
      'Make the player frame read as a plated warframe, not a mannequin: heavier armour masses with panel breakup and edge trim, a silhouette that reads at distance, emissive energy channels placed where they describe the form, and pose quality across run / sprint / air / wall-run / slide / glide. Also own the camera: boom placement, collision against geometry (the wall-run shot shows the camera buried in a wall), shoulder offset, shake and FOV response. Do NOT remove or move the PlayerSockets groups (rightHand, leftHand, hip) — combat/ViewModel.tsx anchors the weapons to them.',
  },
  {
    key: 'combat-feel',
    owns: ['src/game/combat/Weapons.tsx', 'src/game/combat/ViewModel.tsx', 'src/game/combat/DamageSystem.ts'],
    charter:
      'Make shooting and slashing feel weighty and readable in third person. Weapon models with real silhouette and material tiering, muzzle flash with a hot core and light emission, tracers that read as projectiles, impact response on both geometry and enemies, recoil and reload motion, and a katana arc that describes the swing path. The weapons are now anchored to PlayerSockets.rightHand and aimed down the camera forward axis — keep that contract and keep MuzzleWorld published from the real barrel mesh.',
  },
  {
    key: 'vfx-postfx',
    owns: [
      'src/game/combat/Abilities.tsx',
      'src/game/vfx/Particles.tsx',
      'src/game/vfx/Trails.tsx',
      'src/game/vfx/Flashes.tsx',
      'src/game/vfx/Shockwaves.tsx',
      'src/game/vfx/Ambient.tsx',
      'src/game/vfx/VFXBus.ts',
      'src/game/PostFX.tsx',
    ],
    charter:
      'Build ability and impact VFX the way a AAA effects artist would: every effect layered as a hot white core, a saturated mid body, a soft outer falloff, sparks or debris, a real light that illuminates the scene, and a distortion or shockwave element, all on deliberate timing curves with secondary motion. Also own the post stack: bloom that blooms discrete sources instead of washing the frame, tone mapping that holds highlights, and grade response during hitstop and the ultimate.',
  },
  {
    key: 'enemies-hud',
    owns: [
      'src/game/enemies/Trooper.tsx',
      'src/game/enemies/Drone.tsx',
      'src/game/enemies/Heavy.tsx',
      'src/game/enemies/EnemyManager.tsx',
      'src/game/enemies/ai.ts',
      'src/game/enemies/dissolve.ts',
      'src/game/hud/HUD.tsx',
      'src/game/hud/hud.css',
      'src/game/hud/DamageNumbers.tsx',
      'src/screens/TitleScreen.tsx',
      'src/screens/WinScreen.tsx',
      'src/screens/LoseScreen.tsx',
      'src/screens/PauseScreen.tsx',
    ],
    charter:
      'Raise enemy model and animation quality so the three archetypes read apart at a glance and telegraph their attacks clearly, and bring the HUD and end screens to shipped-game craft: hierarchy, restraint, state-change animation, and damage feedback that reads without cluttering the frame.',
  },
]

phase('Implement')
const results = await parallel(
  STREAMS.map((s) => () =>
    agent(
      `You are a senior graphics engineer on AURIC VOW, a Three.js / react-three-fiber Warframe-style ninja action game at ${ROOT}. This is quality round ${ROUND}. An art-direction review just failed the build against a Warframe comparison, and you own one workstream of the fix.

## Your workstream: ${s.key}

${s.charter}

## Files you own — edit ONLY these
${s.owns.map((f) => '- ' + f).join('\n')}

Four other engineers are editing the other subsystems in the same working tree at the same time. Touching a file outside this list will collide with their work and lose changes. If a task in the work order needs a file you do not own, put it in notDone and say which workstream should take it. The one exception is src/game/config.ts: you may ADD new constants for your own subsystem, but never edit or remove existing ones.

## Corrections to the work order — these override it where they conflict

${NOTES}

## Required reading, before you touch anything

- \`${ROOT}/${ORDER_PATH}\` — the review's work order. Read your own section in full, and skim the others so you know what your neighbours are changing.
- \`${ROOT}/${MAP_PATH}\` — a technical map of the codebase written by an earlier audit pass: architecture, per-subsystem entry points, and a weakness register with ids like E1, P3, C2.

## How to work

1. Read your files first. They are long and already have structure — extend it, do not rewrite from scratch, and keep the existing exports and component contracts intact so the rest of the game keeps compiling.
2. Take the [BLOCKER] items in your section first, then [MAJOR]. Do not stop at one task: work through your whole section.
3. Everything is procedural — no external assets can be fetched. Build detail with procedural canvas textures, generated geometry, shader material tweaks and layered meshes.
4. Keep the frame budget in mind: this renders in a browser. Prefer instancing, shared materials and baked-once canvas textures over per-frame allocation or per-mesh materials. Never allocate inside useFrame.
5. When you are done, run \`cd ${ROOT} && npx tsc --noEmit -p tsconfig.app.json\` and fix every error your changes caused. Do NOT run \`npm run build\` — the other engineers are working in the same tree and concurrent builds collide.
6. Report exactly what you changed, file by file. Do not claim work you did not do.

Quality bar: a player shown your frames next to a Warframe screenshot, with no labels, should not be able to tell which one is the AAA game.`,
      { label: `fix:${s.key}`, phase: 'Implement', schema: RESULT_SCHEMA }
    )
  )
)

const ok = results.filter(Boolean)
log(`${ok.length}/${STREAMS.length} workstreams reported, ${ok.reduce((n, r) => n + (r.changes || []).length, 0)} file changes`)

phase('Verify')
const verify = await agent(
  `Five engineers just edited AURIC VOW (${ROOT}) in parallel, each owning a different set of files. Your job is to make the merged tree build and run.

1. \`cd ${ROOT} && npm run build\`.
2. Fix every compile error. Prefer the smallest change that preserves each engineer's intent; if two changes genuinely conflict, keep the one that serves the visual result and say so.
3. Re-run the build until it passes cleanly.
4. Then re-read the changed files for runtime hazards that a compiler will not catch: allocation inside useFrame, materials or geometries created per frame or per mesh in a loop, disposed resources still referenced, missing null guards on refs, and effects that never clean up. Fix what you find.
5. Report: whether the build passes, what you had to fix, and anything you judged unsafe and left alone.

What they changed:
${JSON.stringify(ok.map((r) => ({ workstream: r.workstream, changes: r.changes, risks: r.riskNotes })), null, 1)}`,
  { label: 'verify:build', phase: 'Verify' }
)

return {
  round: ROUND,
  workstreams: ok.map((r) => ({ workstream: r.workstream, changeCount: (r.changes || []).length, typecheckClean: r.typecheckClean, notDone: r.notDone })),
  verify,
}
