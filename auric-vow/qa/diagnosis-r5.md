# Round 5 diagnosis: the black wide shots are a camera-placement bug

Three wide-angle frames render nothing but the HUD. The retry-and-reject
guard added in round 3 confirms it is not a capture timing artifact: the
same frame comes back black three times in a row.

Probing the same views at different heights, at full capture resolution,
separates the cases cleanly:

| camera view | lens height | screenshot bytes |
|---|---|---|
| canyon, player teleported to y=9 | 11.7 m | 41 470 (black) |
| canyon, same view, teleported to y=2 | 3.3 m | 1 203 284 |
| canyon, offset 6 m in x from the y=9 perch | 11.2 m | 41 518 (black) |
| canyon, y=9 but 12 m further down the corridor | 11.4 m | 1 184 774 |
| looking steeply up at (0, 30, 90) from y=2 | 1.6 m | 41 853 (black) |
| same spot, shallower look | 3.3 m | 1 387 522 |
| arena from the upper gallery at y=6.5 | 7.8 m | 42 876 (black) |

The correlation is with where the **lens** ends up, not where the player
is. A high perch pushes the boom up through the ceiling; a steep upward
look swings it down under the deck. Once the lens is outside the room the
frame contains nothing to draw and the fog resolves to black.

This is the camera-collision failure the last three reviews have all
raised from a different angle: "the camera enters geometry", "the boom
collapses to 0.5 m next to level geometry", "the wall-run shot has the
camera buried in a wall". It needs a sphere-cast from the head to the
desired boom position, clamped to the first hit minus a skin, and a hard
floor and ceiling on the lens. It lives in `CameraRig.tsx` and
`movementConfig.ts`.

Exposure metering was ruled out: `POSTFX.tone.meter` clamps its trim to
±0.4 stops, which cannot take a frame to black.

Meanwhile the harness now uses vantage points that were measured to
render, so the review set stops losing its three composition frames.
