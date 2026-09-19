# Round 2 runtime diagnosis (measured, not inferred)

Taken from the live scene graph at z=40 in the canyon, via the QA bridge
(`window.__qa.gl` / `window.__qa.scene`), on the round 2 build.

## Shadows are enabled and the maps exist — almost nothing receives them

```
shadowMap.enabled : true   (PCFSoft)
meshes in scene   : 880
castShadow        : 122
receiveShadow     : 80      <-- this is the bug
```

Both directional lights cast, both have allocated depth maps, and the near
cascade's ortho box (±32, near 1, far 300) with target (-0.6, 1.4, 47.7)
does contain the player at z=40. So the shadow pass is running and is
correctly framed. The reason no shadow is visible anywhere is that **fewer
than one mesh in ten is flagged to receive one**. A shadow that lands on a
surface with `receiveShadow === false` is discarded.

The critics' round 2 verdict ("light never interacts with the scene") is
correct, but their proposed cause (a mis-framed shadow camera) is not.
Do not spend the round re-deriving cascades. Set `receiveShadow` on every
floor, wall, deck, platform, rib, plinth, column, stair and gallery in
ShrineStation, on the player rig's plates, and on the enemy bodies, then
re-check.

## The fill is beating the key

Measured intensities at that moment:

| light | intensity |
|---|---|
| key directional (near cascade) | 1.58 |
| second directional (far cascade) | 0.62 |
| hemisphere | 0.32 |
| camera fill | 0.25 |
| cool rim | 0.35 |
| teal practicals ×4 | 5.15 each |
| chamber spot / point | 6.0 / 4.0 |
| player rim pair | 9.0 and 7.0 |

Summed ambient and local contribution comfortably exceeds the key, so even
once surfaces receive shadows the shadowed side will sit only a fraction of
a stop below the lit side. Raise the key and cut the fill so a shadow is a
3-4 stop event, as the work order asks — but do it after the receiveShadow
fix, and measure again rather than guessing.

## Mesh budget

880 meshes with 122 casters. The shadow pass cost scales with casters, so
prefer flagging large structural masses as casters and letting small trim
be receive-only.
