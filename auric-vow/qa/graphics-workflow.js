export const meta = {
  name: 'auric-vow-graphics-strike',
  description: 'Six narrow graphics specialists raise rendering quality to AAA, then a build verifier merges',
  phases: [
    { title: 'Render', detail: 'one specialist per rendering axis, disjoint files' },
    { title: 'Verify', detail: 'merge, build, hunt runtime hazards' },
  ],
}

const ROOT = '/home/user/-/auric-vow'
const ROUND = args && args.round ? args.round : 1
const ORDER_PATH = args && args.orderPath ? args.orderPath : ''
const MAP_PATH = args && args.mapPath ? args.mapPath : 'qa/map.md'
const DIAG_PATH = args && args.diagPath ? args.diagPath : ''
const SHOTS = args && args.shotsDir ? args.shotsDir : ''
const NOTES = args && args.notes ? args.notes : ''

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    axis: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          what: { type: 'string' },
          whyItRaisesQuality: { type: 'string' },
        },
        required: ['file', 'what'],
      },
    },
    measured: {
      type: 'array',
      items: { type: 'string' },
      description: 'anything you verified by measurement rather than by eye, with the numbers',
    },
    typecheckClean: { type: 'boolean' },
    notDone: { type: 'array', items: { type: 'string' } },
    riskNotes: { type: 'array', items: { type: 'string' } },
  },
  required: ['axis', 'changes', 'typecheckClean'],
}

const AXES = [
  {
    key: 'light-transport',
    owns: [
      'src/game/world/Lighting.tsx',
      'src/game/world/Fog.tsx',
      'src/game/GameCanvas.tsx',
    ],
    charter: `Light transport and shadowing — the single biggest reason these frames read as a greybox.

Own the whole chain: the renderer contract in GameCanvas (tone mapping, exposure, shadow map type and size, colour space), the key/fill/rim rig, the shadow cascades, the practicals, the environment map that feeds metal, and the fog.

What AAA looks like here and this does not: a scene lit by ONE dominant source that models form, with everything else at a fraction of it, so a shadow is a three-to-four stop event and there are true blacks in the recesses. Contact shadows under every character and prop. Practicals that are motivated by a visible fixture and fall off believably. An environment map with real contrast so metal has somewhere bright and somewhere dark to reflect.

Measure, do not guess. The QA bridge exposes the live scene: open the built page with ?qa=1 and read window.__qa.gl and window.__qa.scene. Count how many meshes have receiveShadow. Sum the non-key light intensities and compare against the key. Report those numbers in the measured field before and after your change.`,
  },
  {
    key: 'surface-materials',
    owns: ['src/game/textures.ts', 'src/game/world/materials.ts'],
    charter: `Surface authoring — every material in the level and the maps that drive them.

Own textures.ts (all procedural canvas texture generation) and materials.ts (the shared material singletons).

What AAA looks like here and this does not: no surface is a flat colour. Every material carries a normal map with real machined detail (inset panels with chamfers, fret runs, bolt punches, joint lines — straight edges, authored from drawn primitives, not value noise), a roughness map that breaks up the specular so highlights are not uniform, and a cavity or AO map multiplied into albedo so crevices darken. Metal reads as metal: low albedo, high metalness, an anisotropic highlight, and visible environment reflection. Detail holds at gameplay distance, which means the tiling rate and normalScale have to be checked at the distance the player actually sees the surface, not in a close-up.

Generate the height field for a normal map from drawn rectilinear shapes first and add noise on top, never noise alone — noise cannot produce a straight machined edge.`,
  },
  {
    key: 'level-ornament',
    owns: ['src/game/world/ShrineStation.tsx', 'src/game/world/layout.ts'],
    charter: `Level art — the geometry the player looks at for the whole mission.

What AAA looks like here and this does not: ornament is bought with geometry, not painted on. Columns are lathed profiles with a base torus, a fluted shaft and a flared capital. Ribs and trim are extruded from a keyed profile with a chamfer, grooves and a bead, so they self-shadow and catch a rim. Wall spans are broken by pierced screens, recessed panels and inset channels rather than being flat. There is a silhouette landmark that gives each space a read, and framing geometry near the camera that gives depth.

Two hard constraints. First, this must stay inside a browser frame budget, so ornament goes in through InstancedMesh and shared geometry, never hundreds of unique meshes. Second, layout.ts is the single source of truth shared by collision: you may add visual-only data to it, but do NOT change any coordinate that buildLevelColliders reads, or the level will collide differently from how it looks.

Set receiveShadow on every surface a shadow could land on — floors, walls, decks, platforms, ribs, plinths, columns, stairs, galleries. Measurement on the previous build found only 80 of 880 meshes receiving.`,
  },
  {
    key: 'character-art',
    owns: ['src/game/player/PlayerRig.tsx'],
    charter: `The player frame — on screen in literally every frame of the game.

What AAA looks like here and this does not: a silhouette that reads as one designed object in flat black, not a stack of separate primitives. Armour plates that overlap and close their joints, with a dark under-suit visible in the gaps rather than a hole. Real hands. A head that has a front. Edge trim that catches light. One continuous emissive route that describes the form rather than isolated glowing pips. Material response split across plate, trim and under-suit rather than one shader for everything.

Verify the silhouette the way a character artist does: render the rig in flat black against white and look at the outline alone. If it reads as a person-shaped blob, the plating is not doing its job.

Keep PlayerSockets (rightHand, leftHand, hip) exported and populated — the weapons parent to them.`,
  },
  {
    key: 'vfx-energy',
    owns: [
      'src/game/combat/Abilities.tsx',
      'src/game/vfx/Particles.tsx',
      'src/game/vfx/Trails.tsx',
      'src/game/vfx/Flashes.tsx',
      'src/game/vfx/Shockwaves.tsx',
      'src/game/vfx/Ambient.tsx',
      'src/game/vfx/VFXBus.ts',
      'src/game/vfx/EnergyShell.ts',
    ],
    charter: `Energy and impact effects.

What AAA looks like here and this does not: no effect is one primitive. Each is a hot white core that clips to white, a saturated mid body, a wide soft outer falloff, sparks or debris with velocity-aligned stretch, a real light that illuminates the surrounding architecture and the character's plates, and a distortion or pressure element. Timing is authored on curves with an attack far faster than the decay, and there is secondary motion after the main event. Particles are soft sprites with a gradient, never hard-edged quads or flat squares.

The blind test the critics run is specifically brutal on this: flat single-layer additive shapes are the tell they name first.`,
  },
  {
    key: 'post-color',
    owns: ['src/game/PostFX.tsx'],
    charter: `The post stack and the final colour.

What AAA looks like here and this does not: ambient occlusion that actually darkens contact and cavity, tuned so it bites on bright surfaces rather than being cancelled there. Bloom that blooms discrete emissive sources and leaves lit diffuse alone. A tone curve that holds highlights instead of clipping them to paper. A deliberate grade with a cool shadow and a warm highlight. Vignette and grain at a level you have to look for. Chromatic aberration only as an impulse, never a constant.

Check what is actually available in the installed @react-three/postprocessing and n8ao before designing a pass, and do not add dependencies. Everything must degrade cleanly at qualityTier 1 and 2.

You also own the shared POSTFX and MATERIALS blocks in src/game/config.ts. Nobody else edits those.`,
  },
]

phase('Render')
const results = await parallel(
  AXES.map((a) => () =>
    agent(
      `You are a rendering specialist on AURIC VOW, a Three.js / react-three-fiber Warframe-style ninja action game at ${ROOT}. The player has looked at the build and said the graphics are the biggest problem, and that raising them to AAA is now the highest priority. An independent art-director panel has failed the build twice, most recently at 27/100, saying it reads as an untextured blockout.

## Your axis: ${a.key}

${a.charter}

## Files you own — edit ONLY these
${a.owns.map((f) => '- ' + f).join('\n')}

Five other specialists are working other axes in this same tree right now. Editing a file outside your list will destroy their work. If something you need lives elsewhere, put it in notDone naming the axis that should take it. src/game/config.ts is owned by post-color only.

## Required reading
${SHOTS ? `- The captured frames in \`${SHOTS}\` — look at them. Read the PNGs with the Read tool; you can see images. This is what the panel judged.\n` : ''}${ORDER_PATH ? `- \`${ROOT}/${ORDER_PATH}\` — the panel's work order, including the section for your axis.\n` : ''}${DIAG_PATH ? `- \`${ROOT}/${DIAG_PATH}\` — measurements taken from the live scene graph, which correct the panel where it guessed.\n` : ''}- \`${ROOT}/${MAP_PATH}\` — technical map of the codebase.

${NOTES ? `## Standing notes\n\n${NOTES}\n` : ''}
## How to work

1. Read your files first. They are long and already structured — extend them, keep exports and component contracts intact.
2. Everything is procedural. No asset can be downloaded, and no npm dependency may be added.
3. This runs in a browser. Prefer instancing, shared materials, and textures baked once at boot. Never allocate inside useFrame.
4. Verify by measurement where you can. The built page exposes the live scene at \`window.__qa\` when opened with \`?qa=1\` (gl, scene, camera, setFixedDt, setShadows, teleport, lookAt, setPhase). To drive it yourself: \`cd ${ROOT} && npm run build\`, serve \`dist\`, and open it with Playwright — the chromium at /opt/pw-browsers is already installed and \`NODE_PATH=/opt/node22/lib/node_modules\` puts the playwright module on the path. Software rendering makes it about one frame per second, so step frames rather than waiting on wall time. Do NOT run npm run build if another specialist might be building at the same time — prefer \`npx tsc --noEmit -p tsconfig.app.json\` for checking, and build only if you are going to drive the page.
5. Report what you changed file by file, and put the numbers you measured in the measured field. Do not claim work you did not do.

The bar: a player shown a frame of this next to a frame of Warframe, unlabelled, should not be able to tell which is the AAA game. Anything less is a failing result, and "good for a web game" is a failing result.`,
      { label: `gfx:${a.key}`, phase: 'Render', schema: RESULT_SCHEMA }
    )
  )
)

const ok = results.filter(Boolean)
log(`${ok.length}/${AXES.length} axes reported, ${ok.reduce((n, r) => n + (r.changes || []).length, 0)} file changes`)

phase('Verify')
const verify = await agent(
  `Six rendering specialists just edited AURIC VOW (${ROOT}) in parallel, each owning a different set of files. Make the merged tree build and run correctly.

1. \`cd ${ROOT} && npm run build\`. Fix every compile error with the smallest change that preserves intent.
2. Re-read the changed files for what a compiler cannot catch: allocation inside useFrame, materials or geometries built per frame or per mesh, disposed resources still referenced, missing ref guards, effects that never clean up, and shader compiles triggered every frame.
3. Then actually run it. Build, serve dist, open it headless with Playwright (chromium is at /opt/pw-browsers, NODE_PATH=/opt/node22/lib/node_modules), open with ?qa=1, drive it through window.__qa into the canyon and then the arena, and confirm: the page logs no errors, the scene renders, and — this is the one that failed the last two rounds — count how many meshes have receiveShadow set and report the number. It was 80 of 880. Report the new figures.
4. Report: does the build pass, what did you fix, what did you measure, and what did you judge unsafe and leave alone.

What they changed:
${JSON.stringify(ok.map((r) => ({ axis: r.axis, changes: r.changes, measured: r.measured, risks: r.riskNotes })), null, 1)}`,
  { label: 'verify:build-and-run', phase: 'Verify' }
)

return {
  round: ROUND,
  axes: ok.map((r) => ({ axis: r.axis, changeCount: (r.changes || []).length, typecheckClean: r.typecheckClean, measured: r.measured, notDone: r.notDone })),
  verify,
}
