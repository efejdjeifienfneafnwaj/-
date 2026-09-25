/**
 * AURIC VOW — perf/n8aoShare.ts
 *
 * The post stack runs two N8AO passes in series (cavity, then room). Each is
 * transparency-aware: before compositing, it re-renders the whole scene twice
 * more — transparent surfaces with and without depth write — so its occlusion
 * is not stamped over glass and energy. Both passes render exactly the same
 * two images: same scene, same camera, same composer depth buffer, same size.
 * So the second pass borrows the first pass's pair instead of drawing its own.
 *
 * That turns five full scene renders per frame into three, and removes eight
 * whole-scene visibility traversals. The composite each pass performs is
 * unchanged: it samples the same textures it would have drawn itself.
 *
 * Auto-detection of transparency (a whole-scene traversal per pass per frame)
 * is replaced by the answer it always gives in this game — there are always
 * transparent materials in the scene (energy, glass, HUD-space VFX).
 */
import type { WebGLRenderer, WebGLRenderTarget } from 'three'

interface N8AOPassLike {
  configuration: { transparencyAware: boolean }
  autoDetectTransparency: boolean
  transparencyRenderTargetDWFalse: WebGLRenderTarget | null
  transparencyRenderTargetDWTrue: WebGLRenderTarget | null
  renderTransparency: (r: WebGLRenderer) => void
  render: (r: WebGLRenderer, input: unknown, output: unknown, ...rest: unknown[]) => void
}

/** wire `second` to reuse `first`'s transparency renders; returns an undo */
export function shareN8AOTransparency(firstObj: unknown, secondObj: unknown): () => void {
  const first = firstObj as N8AOPassLike
  const second = secondObj as N8AOPassLike
  if (!first || !second || first === second) return () => {}
  if (typeof second.renderTransparency !== 'function' || typeof second.render !== 'function') return () => {}

  first.autoDetectTransparency = false
  second.autoDetectTransparency = false
  first.configuration.transparencyAware = true
  second.configuration.transparencyAware = true

  const ownFalse = second.transparencyRenderTargetDWFalse
  const ownTrue = second.transparencyRenderTargetDWTrue
  const origRenderTransparency = second.renderTransparency
  const origRender = second.render

  second.renderTransparency = () => {}
  second.render = function (r, input, output, ...rest) {
    if (first.transparencyRenderTargetDWFalse && first.transparencyRenderTargetDWTrue) {
      second.transparencyRenderTargetDWFalse = first.transparencyRenderTargetDWFalse
      second.transparencyRenderTargetDWTrue = first.transparencyRenderTargetDWTrue
      return origRender.call(second, r, input, output, ...rest)
    }
    // first pass not ready: behave exactly as before for this frame
    second.renderTransparency = origRenderTransparency
    try {
      return origRender.call(second, r, input, output, ...rest)
    } finally {
      second.renderTransparency = () => {}
    }
  }
  // the second pass's own pair is never drawn into again
  let disposedOwn = false
  const disposeOwn = () => {
    if (disposedOwn) return
    disposedOwn = true
    if (ownFalse && ownFalse !== first.transparencyRenderTargetDWFalse) ownFalse.dispose()
    if (ownTrue && ownTrue !== first.transparencyRenderTargetDWTrue) ownTrue.dispose()
    second.transparencyRenderTargetDWFalse = first.transparencyRenderTargetDWFalse
    second.transparencyRenderTargetDWTrue = first.transparencyRenderTargetDWTrue
  }
  disposeOwn()

  return () => {
    second.render = origRender
    second.renderTransparency = origRenderTransparency
    // give it a pair of its own again so it stays self-sufficient
    second.transparencyRenderTargetDWFalse = null
    second.transparencyRenderTargetDWTrue = null
    const s = second as unknown as { configureTransparencyTarget?: () => void }
    s.configureTransparencyTarget?.()
    second.autoDetectTransparency = true
    first.autoDetectTransparency = true
  }
}
