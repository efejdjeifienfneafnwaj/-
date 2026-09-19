# AURIC VOW — Visual Overhaul Technical Map

Repo root: `/home/user/-/auric-vow`. All paths below are repo-relative.

## Architecture — how a frame is built

`src/App.tsx` routes title/game/pause/win/lose and mounts `src/game/GameCanvas.tsx` unconditionally (the sim runs behind every overlay). The `<Canvas>` sets the renderer contract: `ACESFilmicToneMapping`, exposure 1.15, `antialias:false`, `PCFSoftShadowMap`, `dpr [1,2]`, fov 70 / near 0.1 / far 400 — tonemapping is injected into every material, so the composer only ever sees LDR.

Mount order inside the Canvas: **Skybox → Fog → Lighting → ShrineStation → EnvironmentFX → ColliderDebug → PlayerController/PlayerRig/CameraRig → CombatSystems + WeaponViewModel → EnemyManager → MissionDirector/ObjectiveMarker → VFXSystems → QualityWatcher/IntroSkipper/GameTick → PostFX** (last, takes over the render loop).

Frame ordering is by `useFrame` priority, not mount order: PlayerController (-10) → PlayerRig (-9) → CameraRig (-8) → everything else (0). Cross-system state is mutable module singletons, never React: `PlayerRef`/`PlayerAnim`, `CamRef`, `CombatState`, `MuzzleWorld`, `EnemyRegistry`, `SpawnStatus`, `abilityState`/`ammoState`/`enemyState`, plus four VFX command queues. Two extra `requestAnimationFrame` loops (`HUD.tsx`, `DamageNumbers.tsx`) run outside R3F entirely.

Ownership: `world/layout.ts` owns all coordinates (art *and* collision read it); `world/materials.ts` owns material singletons that `EnvironmentFX` mutates in place; `vfx/VFXBus.ts` is the only VFX vocabulary (burst/ring/flash/trail — one consumer per queue); `combat/DamageSystem.ts` is the single damage funnel; `MissionDirector` is the sole phase authority.

## Subsystem map

**Environment** — `world/ShrineStation.tsx` (whole level; `Instanced`/`MassMesh` helpers, zones A–E), `world/layout.ts` (coords + `buildLevelColliders`), `world/materials.ts` (singletons, `boosted()`), `world/Lighting.tsx` (`TEAL_POINTS`, `GOD_RAYS`, `CameraFill`, `DustField`), `world/Skybox.tsx`, `world/Fog.tsx`, `world/EnvironmentFX.tsx`. Safe change: placement → `layout.ts`; look → `materials.ts`; rig → the two Lighting tables; anything animated → `EnvironmentFX`. Never fork a material — they are shared by reference.

**Player** — `player/PlayerRef.ts` (contract), `player/PlayerController.tsx` (FSM + capsule), `player/PlayerRig.tsx` (57 meshes, `Spring`, `Ribbon`, ghosts), `player/CameraRig.tsx` (`CamRef`, `addTrauma`), `player/movementConfig.ts` (`MOVE`/`ANIM`). Safe change: pose targets and `ANIM` constants; the rig reads `PlayerAnim` only — never write gameplay state from it.

**Combat** — `combat/Weapons.tsx` (tracer/GunFx pools, `bladeTipWorld`, `getMuzzleWorld`), `combat/Abilities.tsx` (A1–A4 + `RequiemFx` shaders), `combat/ViewModel.tsx`, `combat/DamageSystem.ts`, `combat/state.ts` (`combatTick` scales all timers by `timeScale`). Safe change: feedback fan-out lives in `fireShot`/`resolveSwing`/`resolveEnemyHit`; add visuals there, not in the FSMs.

**VFX/PostFX** — `vfx/VFXBus.ts` (four verbs, hard caps 256/32/32/512, count ≤120), `vfx/Particles.tsx`, `vfx/Trails.tsx`, `vfx/Shockwaves.tsx`, `vfx/Flashes.tsx`, `vfx/Ambient.tsx`, `PostFX.tsx`. Safe change: new primitives must be added to the bus *and* given exactly one consumer; renderOrder band is 18–22.

**Enemies/Mission/HUD** — `enemies/EnemyRegistry.ts` (hp/stagger/DEATH_FX), `enemies/{Trooper,Drone,Heavy}.tsx` (self-contained FSM + procedural mesh), `enemies/EnemyManager.tsx` (spawn director), `enemies/ai.ts`, `enemies/dissolve.ts`, `mission/MissionDirector.tsx`, `mission/zones.ts`, `hud/HUD.tsx` + `hud/hud.css`, `screens/*`. Safe change: HUD is DOM-only, written by direct style mutation in one rAF — add elements to the skeleton, drive them in `tick()`.

## Weakness register

| id | area | file | what is wrong | Warframe gap | sev |
|---|---|---|---|---|---|
| C1 | combat | `src/game/combat/Weapons.tsx` | `CamRef.pitch += 0.008`/shot, never recovered; `cs.recoil` is a static offset | shaped kick + spring-back recentre | blocker |
| C2 | combat | `src/game/combat/Weapons.tsx` | No swept arc mesh; swing "crescent" is a flat XZ ring at chest height | authored per-combo blade-plane arcs | blocker |
| C3 | combat | `src/game/combat/Weapons.tsx` | Impact FX fire at trace time; tracer dies at ~36 m (life 0.09 s, 400 m/s) | FX scheduled at bolt arrival | blocker |
| C4 | combat | `src/game/combat/ViewModel.tsx` | No reload animation; `cs.reloading` never read (1.4 s frozen pose) | full mag-drop reload per weapon | blocker |
| C5 | combat | `src/game/combat/Abilities.tsx` | Requiem's 8 pillars are bare `plane(3,22)`, yawed not billboarded, hard-cut ends | soft gradient shafts + ground caustic | blocker |
| N1 | enemies | `src/game/enemies/Trooper.tsx` | `rush` true whenever ≥3 alive → band-strafe, burst fire and eye telegraph are dead code | legible ranged behaviour and tells | blocker |
| N2 | enemies | `src/game/enemies/Trooper.tsx` | Melee damages on proximity with no windup, swing, flare or sound | full wind-up animation per attack | blocker |
| N3 | enemies | `src/game/enemies/Trooper.tsx` | Rigid tip-over death; Heavy torso lerps 0.7 m through its sibling leg groups | ragdoll with killing-blow impulse | blocker |
| N4 | enemies | `src/game/enemies/dissolve.ts` | Only the colour material is patched — dissolving corpses cast whole solid shadows | shadow follows the dissolve mask | blocker |
| E1 | env | `src/game/world/ShrineStation.tsx` | Zero environment `castShadow`, zero `receiveShadow` on the player, no aoMap, no SSAO pass | shadow + cavity AO carry the read | blocker |
| E2 | env | `src/game/world/ShrineStation.tsx` | `RBOX` scaled non-uniformly → 0.03–4.75 m fillets; trim uses sharp `BOX` | fixed 1–3 cm machined bevel | blocker |
| E3 | env | `src/game/world/ShrineStation.tsx` | Glyph "decals" float 0.65–5 m off walls; corruption veins miss their ribs by 3 m | projected decals + geometry growth | blocker |
| E4 | env | `src/game/world/Lighting.tsx` | 6 `TEAL_POINTS` have no fixture, sit 5–12 m from their strips, don't pulse with them | modelled emissive fixtures, locked animation | blocker |
| E5 | env | `src/game/world/materials.ts` | All glow is flat `MeshBasicMaterial`; gold luminance 0.670 vs bloom threshold 0.7 | hot core + mid band + wide halo | blocker |
| E6 | env | `src/game/world/materials.ts` | No normal/AO/metalness/emissive maps; one flat ivory and one gold across 265 m | normal-mapped trim sheets, edge wear | blocker |
| H1 | hud | `src/game/hud/HUD.tsx` | Behind-camera projection double-flips x and pins y; edge arrow hard-coded pointing up | correct off-screen waypoint arrow | blocker |
| H2 | hud | `src/game/hud/HUD.tsx` | No enemy health, no boss bar; the 0–100 stagger meter is never surfaced | target plate + boss bar + stagger tell | blocker |
| H3 | hud | `src/game/hud/hud.css` | `.hud-dmgvig` is a uniform full-screen flash — no directional hit indicator | directional arc per damage source | blocker |
| H4 | hud | `src/game/hud/HUD.tsx` | Skip hint only renders in DROPSHIP, where `#hud` is `opacity:0`; copy contradicts bindings | visible, accurate prompt | blocker |
| M1 | mission | `src/screens/PauseScreen.tsx` | Nothing gates `useFrame` or zeroes `timeScale` — the mission runs (and can lose) while "PAUSED" | real pause | blocker |
| M2 | mission | `src/game/mission/ObjectiveMarker.tsx` | 3D octahedron + DOM `.obj-marker` both draw the same objective, 2.2 m apart | one occlusion-aware waypoint per objective | blocker |
| P1 | player | `src/game/player/PlayerRig.tsx` | `gaitPhase += speed/strideLength` (missing 2π) → 6.9 m steps; no foot contact at all | contact-locked ~2 m stride | blocker |
| P2 | player | `src/game/player/PlayerRig.tsx` | `body` sits at the capsule bottom, so glide/death/wallrun rotate about the feet | pelvis-pivoted poses | blocker |
| P3 | player | `src/game/player/PlayerRig.tsx` | Wall-run never reads `PlayerRef.wallNormal`: upright figure in air, no contact VFX | feet planted, hand trailing, dust | blocker |
| P4 | player | `src/game/player/PlayerRig.tsx` | `landImpact`/`landTimer` are written and never read — no landing pose at any fall speed | impact-scaled landing to three-point | blocker |
| P5 | player | `src/game/player/PlayerRig.tsx` | Character holds nothing; `ViewModel.tsx` pins the rifle to the camera 2.8 m ahead of it | IK'd two-hand grip, holstered idle | blocker |
| V1 | vfx | `src/game/PostFX.tsx` | Tonemap runs in-material before the composer; nothing outputs >1.0, so bloom thresholds LDR | HDR-authored energy, bloom pre-tonemap | blocker |
| V2 | vfx | `src/game/vfx/Particles.tsx` | No depth fetch anywhere — every particle hard-clips against geometry | depth-faded soft particles | blocker |
| V3 | vfx | `src/game/vfx/Particles.tsx` | One `smoothstep` blob in 3 tints is the only particle shape in the game | spark/smoke/ember/debris sheets | blocker |
| V4 | vfx | `src/game/vfx/Shockwaves.tsx` | No refraction or scene-texture sample anywhere; the ult bends nothing | refraction shell on every pressure wave | blocker |
| V5 | vfx | `src/game/vfx/Trails.tsx` | No UVs; both edge verts share alpha/colour → flat hard-edged paper strip | hot spine, feathered edges, erosion | blocker |
| V6 | vfx | `src/game/vfx/Ambient.tsx` | Beacon rings (`RingGeometry(0.9,1)`) sample the erased outer margin of the glyph texture | crisp counter-rotating glyph rings | blocker |
| C6 | combat | `src/game/combat/Abilities.tsx` | Dash/lunge afterimages are capsules+spheres (also `PlayerRig.tsx` ghosts), 4 m apart | skinned frame copies, dense smear | major |
| C7 | combat | `src/game/combat/Abilities.tsx` | Aegis shell is a flat additive capsule — no Fresnel, no pattern, no per-impact ripple | Fresnel rim + localized hit ripple | major |
| C8 | combat | `src/game/combat/Abilities.tsx` | Javelins: no trail, no spin, no assembly during the 0.35 s windup | assembling, spinning, ribbon-trailed | major |
| C9 | combat | `src/game/combat/Weapons.tsx` | Tracers are 6-gon cylinders, uniform opacity, no head sprite or travelling light | head sprite + length fade + light | major |
| C10 | combat | `src/game/combat/Weapons.tsx` | Four muzzle-flash systems stack per shot; ViewModel quads aren't billboarded or randomised | one shaped, randomised, camera-facing flash | major |
| C11 | combat | `src/game/combat/ViewModel.tsx` | `hand.lookAt(tip)` is the whole swing: arbitrary blade roll, linear arc, no anticipation | anticipation → accel → contact → recovery | major |
| C12 | combat | `src/game/combat/Abilities.tsx` | Ult post response = one white quad + trauma; `POSTFX.hueSaturationPulse` unreferenced | radial blur, refraction, grade shift | major |
| N5 | enemies | `src/game/enemies/EnemyRegistry.ts` | Hit reaction is a 0.08 s flash on the plate material only; no flinch, no directional spark | per-hit flinch + hit-location sparks | major |
| N6 | enemies | `src/game/enemies/dissolve.ts` | Object-space `floor(pos*14)` hash → visible cubes, cell-constant edge, no embers or direction | fine directional front with ember rim | major |
| N7 | enemies | `src/game/enemies/EnemyManager.tsx` | Spawn = 8 particles + one flash; no door, no drop-in, no ground raycast on `jitter()` | staged, telegraphed reinforcement entries | major |
| N8 | enemies | `src/game/enemies/Trooper.tsx` | One sine per limb, no knee/foot/spine, snaps to 0 below 0.1 speed; Heavy freezes mid-stride | skeletal locomotion + additive layers | major |
| N9 | enemies | `src/game/enemies/Heavy.tsx` | Arms set to 0.5 rad on slam land and never returned — permanently cocked | pose returns to idle | major |
| N10 | enemies | `src/game/enemies/Heavy.tsx` | Enrage = one box turning red; 12 m/s charge has no trail, scar, dust or shake | roar, glow build, AoE decal, shake | major |
| N11 | enemies | `src/game/enemies/Heavy.tsx` | Primitive stacks (6-box "petal" pauldrons); all types share ceramic/gunmetal → same blob at 60 m | asymmetric, type-readable silhouettes | major |
| N12 | enemies | `src/game/enemies/EnemyRegistry.ts` | `playEnemyChirp()` is the only sound for death, alerts, all telegraphs and wave beats | distinct cue per event class | major |
| N13 | enemies | `src/game/enemies/Drone.tsx` | Flyers use neither `whiskerSteer` nor real avoidance; they stall against pillars at 20% speed | flyers path around cover | major |
| E7 | env | `src/game/world/Lighting.tsx` | God rays are 16-gon additive cylinders: hard floor cut, no depth fade, no noise, no dust coupling | noise-modulated soft volumetrics | major |
| E8 | env | `src/game/world/Lighting.tsx` | One fixed 2048 map over 110 m, no cascades, no `normalBias`; shadow cam never follows player | CSM with per-cascade bias | major |
| E9 | env | `src/game/world/Lighting.tsx` | Cool rim fires from +Z down the mission axis — it back-lights everything the player faces | camera-relative rim separation | major |
| E10 | env | `src/game/world/materials.ts` | `floorMaterial` branches planar UVs per *vertex* → smeared bands on every `RBOX` bevel | per-fragment blended triplanar | major |
| E11 | env | `src/game/world/materials.ts` | `ivoryMaterial` roughness map has no `.repeat`: 18 cm/texel on walls, 2 mm on pillars | normalized texel density | major |
| E12 | env | `src/game/world/ShrineStation.tsx` | Dome skirt pierces its own walls and is BackSide-only; 12 canyon ribs spear the glass at head height | shelled, kitbashed junctions | major |
| E13 | env | `src/game/world/ShrineStation.tsx` | No ceiling anywhere — arena and canyon are walled pits open to the skybox | enclosed vaults carry ornament + practicals | major |
| E14 | env | `src/game/world/ShrineStation.tsx` | Shared unit primitives at 20× scale: 72-gon 40 m rings, 32-gon 57 m disc, hexagonal tube | tessellation scaled to screen coverage | major |
| E15 | env | `src/game/world/ShrineStation.tsx` | Every organic form is `BoxGeometry(1,0.12,2.2)`; no Lathe/Extrude/Shape in the file | tapered, layered, gold-edged petals | major |
| E16 | env | `src/game/world/ShrineStation.tsx` | No props, no modelled light fixtures; corruption dressing uses module-scope `Math.random()` | dense art-directed narrative clutter | major |
| E17 | env | `src/game/world/Skybox.tsx` | Celestial group is camera-locked (planet never parallaxes); stars are 0.5–1.5 px with no AA | stacked animated parallax strata | major |
| E18 | env | `src/game/world/Fog.tsx` | One global `FogExp2` keyed on camera z: no height fog, no volumes, no light scattering | layered height + local fog volumes | major |
| H5 | hud | `src/game/hud/hud.css` | Entire HUD is fixed px (one `clamp()` in the file); no media query or vmin cluster | resolution-independent HUD | major |
| H6 | hud | `src/game/hud/HUD.tsx` | Wave chip shows `× 0` mid-wave while the queue is still draining; last pip never fills | accurate remaining-enemy readout | major |
| H7 | hud | `src/game/hud/HUD.tsx` | Two independent rAF loops project from a stale camera matrix → markers swim under fast look | HUD projections locked to render | major |
| H8 | hud | `src/screens/TitleScreen.tsx` | No title camera or hero shot — live mission runs behind a plain text column; no menu | composed diegetic front end | major |
| H9 | hud | `src/screens/WinScreen.tsx` | Win/lose render final state instantly: no count-up, no grade stamp, no sting, no breakdown | staged results reveal | major |
| V7 | vfx | `src/game/vfx/Particles.tsx` | Everything is additive — no alpha smoke/dust base, so explosions have no mass or occlusion | dark smoke under additive core | major |
| V8 | vfx | `src/game/vfx/Shockwaves.tsx` | `RingWave` is hardcoded `rotation.x=-π/2`; wall and mid-air impacts get a floating floor disc | surface-aligned / spherical bursts | major |
| V9 | vfx | `src/game/vfx/Shockwaves.tsx` | `uWidth` is normalised: the two biggest rings (1.2, 0.6) degrade into filled pancakes | tight edge at every radius | major |
| V10 | vfx | `src/game/vfx/Trails.tsx` | One sample per frame → length varies 0.17 s @144 fps vs 0.8 s @30; collapses to a point in slow-mo | distance-resampled, splined spine | major |
| V11 | vfx | `src/game/vfx/Trails.tsx` | Stolen ribbon slots leave a stale `byId` entry — two emitters zigzag one ribbon | one emitter per ribbon | major |
| V12 | vfx | `src/game/vfx/Flashes.tsx` | One 4-point star, screen-axis-aligned, no roll/aspect randomisation, no core+halo layering | randomised two-layer flash | major |
| V13 | vfx | `src/game/PostFX.tsx` | No motion blur of any kind behind a 30 m/s dash; CA is uniform, not radially modulated | radial + per-object blur, lens-correct CA | major |
| V14 | vfx | `src/game/PostFX.tsx` | Single unlayered bloom; QualityWatcher deletes Bloom at tier 2 and never restores it | bloom resolution degrades, never disappears | major |
| V15 | vfx | `src/game/vfx/Particles.tsx` | Linear velocity + constant gravity only; particles pop in at full size/alpha, pass through floors | noise drift, drag, flicker, collision | major |
| V16 | vfx | `src/game/vfx/Ambient.tsx` | Beacon = 2 static gradient cylinders at 4 particles/s; channel glow is one scaled static glyph | scrolling erosion, dense embers, layered glyphs | major |
| V17 | vfx | `src/game/vfx/Flashes.tsx` | Flashes are one-shot only — no light can be attached to a moving emitter for its duration | ability VFX carry their own lights | major |
| C13 | combat | `src/game/combat/Weapons.tsx` | Scorch is a single quad snapped to one normal (floats on trim); shells are flat rects that never land | projected decals; lit, bouncing brass | minor |
| E19 | env | `src/game/world/materials.ts` | `glassMaterial` (9% additive, no Fresnel) and `bannerMaterial` (no lighting term) sit among lit geometry | lit, reflective, fogged surfaces | minor |
| E20 | env | `src/game/world/ShrineStation.tsx` | 12 mm z-offset groove disc will z-fight at 60 m; no LOD/impostors; 4 dead `config.ts` constants | LOD chain + honest tuning surface | minor |
| H10 | hud | `src/game/hud/HUD.tsx` | Ability hits fire the kill hitmarker; tiers near-identical; `.topcenter` jumps when the banner unmounts | distinct kill feedback, stable layout | minor |
| H11 | hud | `src/game/hud/HUD.tsx` | Objective copy is generic sentence case with one shared octahedron glyph; `'1:30'` hard-coded; `aria-hidden` | per-objective iconography | minor |
| P6 | player | `src/game/player/PlayerRig.tsx` | No foot IK or ground probe; character stays vertical on 50° slopes, feet clip stairs | two-bone leg IK + pelvis adapt | major |
| P7 | player | `src/game/player/PlayerRig.tsx` | Scarf anchors to feet+1.48 m (ignores every body transform); sim damps per-frame, no wind or impulse | bone-attached, dt-correct, wind-driven cloth | major |
| P8 | player | `src/game/player/CameraRig.tsx` | Single-ray boom (no sphere cast, no player fade) → thin geometry cuts the near plane | sphere cast + frame fade | major |
| P9 | player | `src/game/player/CameraRig.tsx` | Trauma is rotation-only at a fixed 6.1 Hz for every event; no positional kick, none on landing | directional positional kick per class | major |
| P10 | player | `src/game/player/PlayerRig.tsx` | Two body-parented point lights: one inside the torso, one dragging a blue ellipse ahead of the player | real backlit rim term | major |
| P11 | player | `src/game/player/PlayerRig.tsx` | Head/spine never track `CamRef`; hip-firing shoots perpendicular to `moveYaw` | additive aim layer over locomotion | major |
| P12 | player | `src/game/player/PlayerRig.tsx` | One 18/s damp everywhere, springs under-damped (ζ=0.82); no anticipation, settle or armour secondary | offset timing + jiggle | minor |
| P13 | player | `src/game/player/PlayerRig.tsx` | 6-segment trim tori and constant-width box ridges — hexagonal silhouettes, no bevel or taper | beveled, recessed, tapering filigree | minor |
| P14 | player | `src/game/player/PlayerRig.tsx` | dt clamped 1/30 vs 0.1 in controller (pose lag <30 fps); `resetPlayer` leaves stale ghost history | consistent integration | minor |
| P15 | player | `src/game/player/CameraRig.tsx` | `fovPulse` written only by double/wall jump — abilities, ult and damage get no FOV response | FOV punch on dash/ult/impact | minor |
| V18 | vfx | `src/game/PostFX.tsx` | SMAA runs after Noise and CA (it is the only AA); no DoF; `uGlyph`/`hueSaturationPulse` dead | clean AA input, dead code removed | minor |
| V19 | vfx | `src/game/vfx/VFXBus.ts` | Bus has no decal/scorch verb, so combat leaves no persistent marks on the world | accumulating battle damage | minor |

## Ownership boundaries

Strictly disjoint. Any change outside your set is a request to the owner, not an edit.

**environment-art** — `src/game/world/**` (`ShrineStation.tsx`, `layout.ts`, `materials.ts`, `Lighting.tsx`, `Skybox.tsx`, `Fog.tsx`, `EnvironmentFX.tsx`, `Colliders.ts`, `ColliderDebug.tsx`, `index.ts`) and `src/game/textures.ts`.

**player-frame** — `src/game/player/**` (`PlayerRig.tsx`, `PlayerController.tsx`, `CameraRig.tsx`, `PlayerRef.ts`, `movementConfig.ts`, `index.ts`). Owns the `PlayerSockets`/`CamRef` surfaces other streams consume.

**combat-feel** — `src/game/combat/**` (`Weapons.tsx`, `Abilities.tsx`, `ViewModel.tsx`, `DamageSystem.ts`, `state.ts`, `index.tsx`).

**vfx-postfx** — `src/game/vfx/**`, `src/game/PostFX.tsx`, `src/game/GameCanvas.tsx`, `src/game/config.ts`. Owning `config.ts` and the Canvas makes this stream the tuning/pipeline registrar: other streams request constants and mount-order changes here. New sprite atlases go in a new `src/game/vfx/vfxTextures.ts`, not `textures.ts`.

**enemies-hud** — `src/game/enemies/**`, `src/game/mission/**`, `src/game/hud/**` (incl. `hud.css`), `src/screens/**`, `src/App.tsx`.

Cross-stream contracts that must not be broken unilaterally: `PlayerRef`/`PlayerAnim` field names, `CamRef` + `addTrauma`, `VFXBus` verb signatures, `EnemyRegistry.damage()`, `SpawnStatus`, and `layout.ts` coordinates (art and collision both read them).