export const meta = {
  name: 'auric-vow-visual-critic',
  description: 'Blind-test AURIC VOW screenshots against Warframe reference and rule on AAA quality',
  phases: [
    { title: 'Critique', detail: 'independent critics, one lens each' },
    { title: 'Verdict', detail: 'merge into one ranked work order' },
  ],
}

const SHOTS = args && args.shotsDir ? args.shotsDir : '/home/user/-/auric-vow/qa/shots'
const ROUND = args && args.round ? args.round : 1
const ROOT = '/home/user/-/auric-vow'

const CRIT_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    scoreOutOf100: { type: 'number' },
    blindTest: {
      type: 'string',
      description:
        'Answer honestly: if these frames were shown side by side with a Warframe screenshot with no labels, would a player pick this one as the more expensive-looking game? Say which wins and why, in 2-4 sentences.',
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          shot: { type: 'string', description: 'which screenshot file shows it' },
          whatIsWrong: { type: 'string' },
          warframeDoes: { type: 'string' },
          fix: { type: 'string', description: 'concrete implementation direction, naming files/techniques' },
          area: {
            type: 'string',
            enum: ['environment-art', 'player-frame', 'combat-feel', 'vfx-postfx', 'enemies-hud'],
          },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
        },
        required: ['title', 'shot', 'whatIsWrong', 'fix', 'area', 'severity'],
      },
    },
  },
  required: ['lens', 'verdict', 'scoreOutOf100', 'blindTest', 'findings'],
}

const LENSES = [
  {
    key: 'art-direction',
    brief:
      'Overall art direction and first impression. Composition, silhouette reading, colour script, contrast range, how "expensive" the frame looks. Does it read as a shipped AAA game or as a WebGL tech demo? Judge value structure (are there true darks and controlled highlights, or is everything mid-grey?), palette discipline, and whether the architecture has the ornamental density of Orokin design or is untextured primitives.',
  },
  {
    key: 'lighting-materials',
    brief:
      'Lighting and material response. Look for: flat unlit-looking surfaces, missing normal/roughness variation, absent specular breakup, uniform albedo, shadows that are missing/soft/wrong, no ambient occlusion in crevices, gold that does not read as metal, bloom that washes the image instead of blooming discrete sources, tone mapping that clips.',
  },
  {
    key: 'character-animation',
    brief:
      'The player frame and its motion. Proportions and silhouette, armour plating and panel breakup, emissive channel placement, whether limbs read as articulated armour or as tapered sticks, pose quality in sprint/air/wall-run/slide, the scarf ribbons, and whether the character would be at home next to a Warframe frame.',
  },
  {
    key: 'vfx-combat',
    brief:
      'Weapon and ability VFX. Muzzle flash, tracers, impacts, katana arc, each ability burst: layer count, hot core vs soft falloff, sparks and secondary debris, light emission, screen-space impact, timing. Also flag anything occluding the frame or rendering at the wrong scale or in the wrong space (for example a first-person weapon model drawn while the camera is third-person).',
  },
  {
    key: 'ui-readability',
    brief:
      'HUD, typography, screen layout, damage feedback, objective presentation, enemy readability and telegraphing, and the title/end screens. Judge against Warframe HUD craft: diegetic framing, hierarchy, restraint, animation on state change.',
  },
]

phase('Critique')
const crits = await parallel(
  LENSES.map((l) => () =>
    agent(
      `You are a senior art director at a AAA studio doing a hostile review pass. You are reviewing captured frames from a browser game built in Three.js / react-three-fiber called AURIC VOW — a Warframe-style ninja action game. The team claims it is AAA quality. Your job is to establish whether that claim is false.

Read EVERY screenshot in ${SHOTS} (they are PNG files named 01_title.png onward; ${SHOTS}/state.json lists what each shot was meant to show). Use the Read tool on each image file — you can see images. Do not skip any.

Your review lens: **${l.key}**
${l.brief}

You know Warframe extremely well: Orokin gold-and-ivory architecture with deep carved ornament and layered trim, energy VFX built from a hot white core plus a saturated mid plus a soft outer falloff plus sparks plus a real light, extremely readable character silhouettes in heavy plated armour, fluid parkour with strong pose contrast, and a HUD that is restrained and diegetic.

Rules for this review:
- Be harsh. This is round ${ROUND}. Grade against shipped AAA, not against "good for a web game". "Good for WebGL" is a failing grade.
- Every finding must name the screenshot that shows it and give a concrete implementation direction, not a wish. The codebase is at ${ROOT}; you may read source files under ${ROOT}/src to make your fix direction specific, but do NOT modify anything.
- Assign each finding to exactly one area from: environment-art, player-frame, combat-feel, vfx-postfx, enemies-hud.
- Return PASS only if you would genuinely be comfortable with these frames appearing in a Warframe marketing comparison. Otherwise FAIL.
- The blind-test field is the important one. Answer it honestly.`,
      { label: `critic:${l.key}`, phase: 'Critique', schema: CRIT_SCHEMA }
    )
  )
)

const ok = crits.filter(Boolean)
const fails = ok.filter((c) => c.verdict === 'FAIL').length
const avg = ok.length ? ok.reduce((n, c) => n + (c.scoreOutOf100 || 0), 0) / ok.length : 0
const all = ok.flatMap((c) => (c.findings || []).map((f) => ({ ...f, lens: c.lens })))
log(`round ${ROUND}: ${fails}/${ok.length} critics FAIL, avg ${avg.toFixed(0)}/100, ${all.length} findings`)

phase('Verdict')
const order = await agent(
  `Five art directors independently reviewed the same screenshots of a Three.js Warframe-style game. Their verdicts and findings are below.

Produce a work order in Markdown, at most 1500 words:

## Verdict
One line: PASS or FAIL overall (FAIL if any critic failed), the average score, and the single most damaging problem.

## Blind test summary
What the critics said when asked whether this or Warframe looks more expensive. Quote the harshest one.

## Work order
Five sections, one per area: environment-art, player-frame, combat-feel, vfx-postfx, enemies-hud.
In each section, a numbered list of merged, deduplicated tasks, hardest-hitting first. Each task is one or two sentences of concrete implementation direction that an engineer can act on without re-reading the reviews. Merge duplicates ruthlessly: if three critics said the architecture is untextured, that is one task.
Mark each task [BLOCKER], [MAJOR] or [MINOR].

Do not include praise. Do not include tasks that are not grounded in a finding below.

FINDINGS:
${JSON.stringify(all, null, 1)}

VERDICTS:
${JSON.stringify(ok.map((c) => ({ lens: c.lens, verdict: c.verdict, score: c.scoreOutOf100, blindTest: c.blindTest })), null, 1)}`,
  { label: 'verdict:work-order', phase: 'Verdict' }
)

return {
  round: ROUND,
  pass: fails === 0,
  failingCritics: fails,
  avgScore: Number(avg.toFixed(1)),
  findingCount: all.length,
  blockers: all.filter((f) => f.severity === 'blocker').length,
  workOrder: order,
}
