# Round 3 runtime diagnosis (measured, not inferred)

## The four black frames were a capture defect, not a rendering bug

Frames 10, 18, 19 and 21 of the round 3 set contain only the DOM HUD over
black, and the review reasonably concluded the scene fails to render at
those camera positions. It does not. Driving the built page to each of
those exact positions and shooting again gives a normal render every time:

| position | screenshot bytes |
|---|---|
| arena upper gallery (-22, 6.5, 172) | 368 873 |
| canyon high ledge (0, 9, 118) | 400 424 |
| extraction bridge (0, 3, 240) | 270 804 |
| skybox look-up (0, 2, 60) | 377 849 |
| spawn dais, known-good control | 375 348 |

The cause is that the canvas ran without `preserveDrawingBuffer`, so a
screenshot taken between two rendered frames captured a cleared surface.
At roughly 1.5 s per frame on the software rasteriser, that window is wide.

Fixed on both sides: the canvas now sets `preserveDrawingBuffer` in QA
capture mode, and the harness rejects any frame under 150 KB, re-shoots it,
and records it in `errors.log` if it never recovers. Do NOT spend this
round on the skybox-depth or teleport-visibility theories in the work
order's environment-art item 1 — they were diagnosing the wrong thing.

## What the review got right and is still open

Cast shadows still do not read in any frame. Caster and receiver flags are
now set widely, and the shadow filter was fixed last round, so the
remaining suspects are the ones the review names: the near cascade's
`normalBias` at 0.018 is large enough to push contact shadows off their
casters, and the PCSS shader patch is applied by a regex against a
three.js chunk that may no longer match. Add an assertion that the patch
matched, and render one control frame with the patch disabled.

## Shader program count

The live scene now reports 601 compiled programs, against 107 two rounds
ago. Some of that is real new material variety, but 601 is high enough to
suspect per-instance material cloning. Worth an audit: a program count
that scales with object count rather than material count will cost far
more on a real GPU than it does here.
