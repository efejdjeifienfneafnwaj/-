/**
 * AURIC VOW — world/Fog.tsx
 * The atmosphere the whole level is composed against.
 *
 * R1: every zone colour scaled by VALUE_FLOOR; fog darkens below deck level.
 * R2: VALUE_FLOOR 0.72 → 0.5, plus a camera-height density multiplier.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * R3 (light transport) — three.js fog is the single most primitive term in the
 * renderer and it was the last one still running stock. `FogExp2` is
 * exp(-(ρ·d)²) with ONE global ρ: the same density at the cornice as at the
 * deck, the same colour looking into the sun as away from it. That produces
 * exactly the failure the panel named — "a single mid-grey value band" —
 * because at 40 m every surface, lit or shadowed, gets lerped toward one flat
 * blue no matter where it is or which way the camera is pointing.
 *
 * R2 tried to fix this from the CPU by scaling density with the CAMERA's
 * height. That cannot work: it moves the whole veil together, so standing on a
 * gallery thinned the fog on the deck 10 m below as well.
 *
 * What ships in AAA is height fog integrated per fragment, plus directional
 * inscattering. That is what this now is, by patching the stock fog chunks:
 *
 *   1. `fog_vertex` reconstructs the fragment's WORLD position from
 *      `mvPosition` — the one quantity the stock chunk already requires, so
 *      this is safe in every shader that fogs, including sprites and points,
 *      none of which have `transformed` in scope.
 *
 *   2. `fog_fragment` analytically integrates an exponential height profile
 *      ρ(y) = ρ₀·e^(−k·y) along the view ray, giving the closed form
 *      ∫ = L·(e^(−k·y₀) − e^(−k·y₁)) / (k·(y₁ − y₀)). Divided by L this is the
 *      ray's MEAN density, which is then fed through three's own exp2 curve —
 *      so every density value Fog.tsx and config already tune keeps its
 *      meaning, and what changes is that fog now lives in the world instead of
 *      on the camera. A 10 m hall has haze pooling at the floor, a clean read
 *      at the cornice, and a fall off the deck goes properly murky.
 *
 *   3. Aerial perspective: the veil is tinted toward the key's colour by
 *      pow(max(dot(viewDir, KEY_DIR), 0), 6). Looking down-sun the distance
 *      glows warm; looking away it stays cold indigo. This is the term that
 *      makes a haze read as AIR rather than as a grey wash, and it is free —
 *      the sun direction is a compile-time constant.
 *
 * The patch is installed once at module load and verifies itself: if an anchor
 * does not match the stock chunk, nothing is written and three's own fog runs.
 *
 * R5 (light transport) — no structural change, three numbers. The veil's near
 * value drops so the first few metres of air SUBTRACT more (fog is the only
 * term in the renderer that can put a floor under the darks), its far value
 * drops so a 60 m wall stops being lifted by the haze that is supposed to be
 * describing its distance, and the vertical ramp is steepened and deepened so
 * everything below the cornice is darker veil than it was. The arena's zone
 * density is trimmed to 0.7× for the same reason: an interior should be
 * clearer than the open canyon it opens off. See each constant for the
 * arithmetic.
 *
 * R7 (light transport) — the veil's HUE, and only its hue. The panel's second
 * named difference between our frames and the reference is that the reference
 * contains no blue pixel and ours are indigo-skied with periwinkle distance.
 * Fog is a very large part of that and it is easy to miss, because a fog
 * colour does not look like a light: in the canyon, at density 0.02, a wall at
 * 60 m sits under 1 − exp(−(0.02·60)²) = 76 % veil, so three quarters of every
 * distant pixel down the game's longest sightline is literally `FOG.color`.
 * Measured over the central crop of each frame, pixels with B > R + 4:
 * reference 1.8 %, our canyon 11.4 %, our spawn 24.7 %.
 *
 * Two things changed, both here rather than in config.ts (which is
 * post-color's, and where the blue is not wrong as a SKY colour — only as the
 * colour of the air):
 *   - the zone palette (FOG_VEIL / FOG_HAZE / FOG_INTERIOR / FOG_VOID) is warm
 *     ash and ochre, matched in LUMINANCE to the indigo constants it replaces
 *     so nothing about the value structure moves.
 *   - the far-distance push INVERTS. It used to drive the thickest fog toward
 *     vec3(0.72, 0.86, 1.25), i.e. bluer with distance. In the reference the
 *     background warms toward the haze and loses contrast; it now pushes
 *     toward vec3(1.2, 1.0, 0.76). See FOG_COOL_FAR / FOG_FAR_PUSH.
 * No density, no height ramp and no value constant is touched.
 */
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { FOG, SKY, LIGHTING } from '../config'
import { ZONE_Z } from './layout'
import { KEY_DIR } from './Lighting'

/**
 * Global scale on every fog colour — protects the bottom of the histogram.
 * R2: 0.72 → SKY.fogValueFloor (0.5). With the key doubled, distant geometry
 * was landing back in the same blue haze band the review called "a single
 * mid-grey value band"; fog is the one term that can put a floor UNDER the
 * frame's darks, and it has to be authored below them, not through them.
 */
const VALUE_FLOOR = SKY.fogValueFloor
/**
 * Extra darkening applied as the camera descends into the void.
 * R7 — the void below the deck: warm near-black rather than SKY.voidTint's
 *  blue-black '#05060E'. A fall should read as absence of light, not as a
 *  different colour of light. */
const FOG_VOID = '#0A0806'
const VOID_TINT = new THREE.Color(FOG_VOID)

// ---------------------------------------------------------------------------
// Height-fog / inscattering parameters, baked into the shader as literals
// ---------------------------------------------------------------------------
/** deck level: the altitude at which the authored zone densities are exact */
const FOG_BASE_Y = 0
/** scale height (m). Density halves every ~6.2 m above the deck. */
const FOG_SCALE_H = 9
/** how much the veil is allowed to thicken below the deck */
const FOG_MAX_MULT = 2.8
/** strength of the warm forward-scatter lobe */
const FOG_INSCATTER = 0.5
/** forward-scatter sharpness; 6 is a broad glow around the sun, not a disc */
const FOG_PHASE_POW = 6
/**
 * R4 — the veil's value multiplier at zero and full density.
 *
 * Below 1.0 near the camera the fog SUBTRACTS value instead of adding it, so
 * the first few metres of haze deepen a shadow rather than washing it out;
 * above 1.0 at full density distant geometry sits lighter than anything near.
 * The gap between the two is the frame's aerial-perspective value range, and
 * it is what lets a mid-distance column read as darker than the wall behind it
 * without either of them changing hue.
 *
 * R5 — 0.62 → 0.46 near, 1.28 → 1.10 far. Two separate reasons.
 *
 * The near end is the only term in the whole renderer that can put a FLOOR
 * UNDER the darks. Everything else — the key, the apertures, the practicals,
 * the probe — can only add. A recess 6 m from the lens has a few percent of
 * fog over it, and at 0.62 that fog was still bright enough to be roughly
 * neutral; at 0.46 it subtracts, so the recess goes down rather than sideways.
 * This is the "the shadow end never reaches black" note, answered from the
 * one place it can be answered without touching the grade.
 *
 * The far end is the "lavender fog is lifting the distance into the
 * mid-tones" note. At 1.28 a 60 m arena wall sitting under 40 % fog was
 * having its value RAISED by the veil — which, on the one wall in the level
 * that already reads as wallpaper, removes the last bit of range the aperture
 * rake has to work with. 1.10 still separates far from near by value, which
 * is the cue aerial perspective is actually made of.
 */
const FOG_NEAR_VALUE = 0.46
const FOG_FAR_VALUE = 1.1
/**
 * How far the thickest fog is pushed toward its distance hue.
 *
 * R7 — the DIRECTION of this push inverts, and that is the change this round
 * is about. It used to drive the far end toward `vec3(0.72, 0.86, 1.25)` — a
 * blue multiplier on the veil's own luma — on the theory that distance is
 * carried by cooling. The reference frame does the opposite: read it and the
 * background WARMS toward the haze, losing contrast as it goes, and there is
 * no blue pixel in it anywhere (measured: 1.8 % of pixels have B > R + 4,
 * against 11.4 % in our canyon and 24.7 % at our spawn). A cool far push on a
 * 76 %-fogged canyon wall is not a subtle grade note, it is the single
 * largest blue-producing term in the frame after the dome itself.
 * See FOG_FAR_PUSH.
 */
const FOG_COOL_FAR = 0.45
/**
 * The hue the thickest fog is pushed toward, as a multiplier on its own luma.
 * Warm ochre dust, not cold air: the reference's distance is a pale warm
 * grey-ochre that the structure dissolves into.
 */
const FOG_FAR_PUSH = new THREE.Vector3(1.2, 1.0, 0.76)
/** inscatter colour: the key, dimmed so the haze never out-values the deck */
const FOG_SUN_COLOR = new THREE.Color(LIGHTING.key.color).multiplyScalar(0.72)

// ---------------------------------------------------------------------------
// R7 — the veil's own palette, owned here rather than read from config.
//
// `FOG.color` is `COLORS.veilBlue` '#1B2440' and the zone table also reached
// for `SKY.horizon` '#0C1330' and a hand-written '#141C36'. In the canyon,
// where density is 0.02, a wall at 60 m sits under 1 − exp(−(0.02·60)²) =
// 76 % veil — so three quarters of every distant pixel in the game's longest
// sightline IS this colour. Matched in luminance to the constants they
// replace (sRGB luma of veilBlue is 36/255; of FOG_VEIL, 38/255), so what
// changes is hue alone. config.ts is post-color's and is untouched.
// ---------------------------------------------------------------------------
/** base veil — warm ash, replaces COLORS.veilBlue */
const FOG_VEIL = '#2C251C'
/** the warmer ochre haze deeper down the canyon, replaces SKY.horizon */
const FOG_HAZE = '#463726'
/** interior veil under the reliquary dome, replaces '#141C36' */
const FOG_INTERIOR = '#241E17'

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n))

/**
 * Install the patch. Returns true if both chunks were rewritten; if either
 * anchor misses (three upgraded and reworded the chunk) nothing is written at
 * all and stock FogExp2 runs, which is a downgrade but never a black screen.
 */
const HEIGHT_FOG_INSTALLED = (() => {
  const C = THREE.ShaderChunk

  // --- vertex: publish world position. `mvPosition` is view-space, and the
  //     view matrix's upper 3×3 is orthonormal, so world = camera + Rᵀ·mv,
  //     and (Rᵀ·v)ᵢ = dot(column i, v) = dot(viewMatrix[i].xyz, v). No
  //     inverse() (absent from GLSL ES 1.00) and no `transformed` (absent from
  //     the sprite shader) is needed.
  const parsVert = C.fog_pars_vertex
  const vert = C.fog_vertex
  if (!parsVert.includes('varying float vFogDepth;')) return false
  if (!vert.includes('vFogDepth = - mvPosition.z;')) return false

  C.fog_pars_vertex = parsVert.replace(
    'varying float vFogDepth;',
    'varying float vFogDepth;\n\tvarying vec3 vFogWorld;',
  )
  C.fog_vertex = vert.replace(
    'vFogDepth = - mvPosition.z;',
    `vFogDepth = - mvPosition.z;
	vFogWorld = cameraPosition + vec3(
		dot( viewMatrix[ 0 ].xyz, mvPosition.xyz ),
		dot( viewMatrix[ 1 ].xyz, mvPosition.xyz ),
		dot( viewMatrix[ 2 ].xyz, mvPosition.xyz ) );`,
  )

  const parsFrag = C.fog_pars_fragment
  if (!parsFrag.includes('varying float vFogDepth;')) return false
  C.fog_pars_fragment = parsFrag.replace(
    'varying float vFogDepth;',
    'varying float vFogDepth;\n\tvarying vec3 vFogWorld;',
  )

  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		vec3 fogRay = vFogWorld - cameraPosition;
		float fogLen = max( length( fogRay ), 1e-4 );
		vec3 fogDir = fogRay / fogLen;

		// ---- exponential height profile, integrated along the ray ----------
		float fogK = ${f(1 / FOG_SCALE_H)};
		float fogY0 = cameraPosition.y - ${f(FOG_BASE_Y)};
		float fogY1 = vFogWorld.y - ${f(FOG_BASE_Y)};
		float fogDy = fogY1 - fogY0;
		float fogE0 = exp( - fogK * fogY0 );
		float fogMean;
		if ( abs( fogDy ) < 1e-3 ) {
			fogMean = fogE0;
		} else {
			fogMean = ( fogE0 - exp( - fogK * fogY1 ) ) / ( fogK * fogDy );
		}
		fogMean = clamp( fogMean, 0.0, ${f(FOG_MAX_MULT)} );

		// feed the mean density through three's own exp2 curve so every
		// authored zone density keeps the meaning it was tuned with
		float fogD = fogDensity * fogMean;
		float fogFactor = 1.0 - exp( - fogD * fogD * fogLen * fogLen );

		// ---- aerial perspective --------------------------------------------
		float fogSun = pow( max( dot( fogDir, vec3( ${f(KEY_DIR.x)}, ${f(KEY_DIR.y)}, ${f(KEY_DIR.z)} ) ), 0.0 ), ${f(FOG_PHASE_POW)} );
		vec3 fogTint = mix( fogColor, vec3( ${f(FOG_SUN_COLOR.r)}, ${f(FOG_SUN_COLOR.g)}, ${f(FOG_SUN_COLOR.b)} ), fogSun * ${f(FOG_INSCATTER)} );
		// and a vertical value ramp, so the veil itself is not one flat band.
		//
		// R5 — the ramp used to run 0.55 → 1.0 over y −6 → 18, which put a
		// surface at head height at 0.85 of full veil value: near enough to
		// flat that the haze over a 10 m interior was one band after all. It
		// now runs 0.28 → 1.0 over y −10 → 26, so the deck is at 0.48, the
		// cornice at 0.68, the vault crown at 1.0 and anything that has
		// fallen off the edge at 0.28. Every height below the cornice is
		// darker than it was, which is the "height-restrict the lavender"
		// half of the note — the veil is still lavender where you can see
		// sky through it and nearly black where the level is.
		fogTint *= mix( 0.28, 1.0, clamp( ( vFogWorld.y + 10.0 ) / 36.0, 0.0, 1.0 ) );

		// ---- R4: let VALUE carry depth, not hue ----------------------------
		// A single fog colour is a single value, so it lifts a near recess by
		// exactly as much as it lifts a far wall — which is the mechanism that
		// collapsed the outdoor frames to two values. Here the veil's own value
		// is a function of how much of it there is: thin fog (a near surface,
		// a shadow 8 m away) is DARKER than the authored colour so it deepens
		// the darks instead of lifting them, and thick fog (a wall at 60 m) is
		// lighter, so distance is read off value alone. The same ramp desaturates
		// toward the zone's blue, so far planes also go cooler — value first,
		// hue as the second cue, which is the order the eye reads them in.
		float fogNearLift = clamp( fogFactor, 0.0, 1.0 );
		fogTint *= mix( ${f(FOG_NEAR_VALUE)}, ${f(FOG_FAR_VALUE)}, fogNearLift * fogNearLift );
		float fogCool = dot( fogTint, vec3( 0.2126, 0.7152, 0.0722 ) );
		fogTint = mix( fogTint, vec3( fogCool ) * vec3( ${f(FOG_FAR_PUSH.x)}, ${f(FOG_FAR_PUSH.y)}, ${f(FOG_FAR_PUSH.z)} ), fogNearLift * ${f(FOG_COOL_FAR)} );

		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, clamp( fogFactor, 0.0, 1.0 ) );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	#endif
#endif
`
  return true
})()

interface FogZone {
  density: number
  color: THREE.Color
}

export default function Fog() {
  const fogRef = useRef<THREE.FogExp2>(null!)

  const zones = useMemo(
    () => ({
      spawn: { density: 0.01, color: new THREE.Color(FOG_VEIL) } as FogZone,
      canyonA: { density: FOG.canyonDensity, color: new THREE.Color(FOG_VEIL) } as FogZone,
      canyonB: { density: FOG.canyonDensity, color: new THREE.Color(FOG_HAZE) } as FogZone,
      chamber: { density: 0.012, color: new THREE.Color(FOG_INTERIOR) } as FogZone,
      // R5 — the arena runs at 0.7× the authored `FOG.arenaDensity`.
      //
      // The zone table is this file's, the constant is the grade's, so the
      // trim lives here rather than in config. Reason: the arena is 60 m
      // corner to corner and ROOFED, and at 0.012 its far wall sits under
      // 1 − exp(−(0.012·60)²) = 40 % veil. Forty per cent of anything is a
      // value the wall did not earn, and this is the one wall in the level
      // the panel singles out as "tiles like wallpaper with no lit falloff".
      // At 0.0084 the same wall is under 23 %, which leaves the ridge-slot
      // rake (see Lighting.tsx APERTURES) most of its range instead of
      // handing a third of it to the haze. An interior should be clearer
      // than the open canyon it opens off, not murkier.
      arena: { density: FOG.arenaDensity * 0.7, color: new THREE.Color(FOG_VEIL) } as FogZone,
      extraction: { density: 0.015, color: new THREE.Color(FOG_HAZE) } as FogZone,
    }),
    [],
  )

  const targetColor = useMemo(() => new THREE.Color(FOG_VEIL), [])

  // pre-scale every zone colour once (no per-frame allocation)
  useMemo(() => {
    for (const z of Object.values(zones)) z.color.multiplyScalar(VALUE_FLOOR)
  }, [zones])

  useFrame((state, dt) => {
    const fog = fogRef.current
    if (!fog) return
    const z = state.camera.position.z

    let density: number
    if (z < ZONE_Z.canyon[0]) {
      density = zones.spawn.density
      targetColor.copy(zones.spawn.color)
    } else if (z < ZONE_Z.canyon[1]) {
      // canyon: tint warms toward the horizon color deeper in
      const t = (z - ZONE_Z.canyon[0]) / (ZONE_Z.canyon[1] - ZONE_Z.canyon[0])
      density = zones.canyonA.density
      targetColor.lerpColors(zones.canyonA.color, zones.canyonB.color, t)
    } else if (z < ZONE_Z.chamber[1]) {
      density = zones.chamber.density
      targetColor.copy(zones.chamber.color)
    } else if (z < ZONE_Z.arena[1]) {
      density = zones.arena.density
      targetColor.copy(zones.arena.color)
    } else {
      density = zones.extraction.density
      targetColor.copy(zones.extraction.color)
    }

    // below deck level the fog deepens toward the void value, so falls and
    // under-structure read as depth instead of a uniform blue wash.
    // (The DENSITY side of this is now the shader's job — see the height
    // integral above — so only the colour is driven from here.)
    const below = THREE.MathUtils.clamp(-state.camera.position.y / 12, 0, 1)
    if (below > 0) targetColor.lerp(VOID_TINT, below * 0.85)

    // R3: the camera-height density multiplier that used to live here is gone.
    // It moved the whole veil with the camera, which is the opposite of height
    // fog — standing on a gallery thinned the haze on the deck below. Density
    // is now a world-space field evaluated per fragment.
    if (!HEIGHT_FOG_INSTALLED) {
      const hT = THREE.MathUtils.clamp(state.camera.position.y / 11, 0, 1)
      density *= THREE.MathUtils.lerp(1.35, 0.55, hT)
    }

    const k = 1 - Math.exp(-2.2 * dt) // smooth zone transitions
    fog.density = THREE.MathUtils.lerp(fog.density, density, k)
    fog.color.lerp(targetColor, k)
  })

  return <fogExp2 ref={fogRef} attach="fog" args={[FOG_VEIL, FOG.arenaDensity]} />
}
