/**
 * AURIC VOW — Input.ts
 * Pointer-lock mouse look + key state singleton. See design.md §3.
 *
 * Usage:
 *   Input.attach(canvasOrElement)  // once, from GameCanvas mount
 *   Input.detach()                 // on unmount
 *   const mv = Input.moveAxis()    // per frame: {x: strafe, z: forward} in [-1,1]
 *   if (Input.pressed('jump')) ... // edge-triggered (consumed once)
 *   if (Input.held('sprint')) ...  // level-triggered
 *   Input.consumeLook()            // {dx, dy} mouse delta since last frame (pixels)
 */

import { KEYS } from './config'

type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'fire'
  | 'aim'
  | 'slash'
  | 'sprint'
  | 'crouch'
  | 'jump'
  | 'ability1'
  | 'ability2'
  | 'ability3'
  | 'ability4'
  | 'objectiveHint'
  | 'pause'

/**
 * KeyboardEvent.code / Mouse<button> names that map to each action.
 * Single source of truth: config.ts §3. This file used to carry its own
 * duplicate table, which had drifted out of sync (Digit1 fired ability3 and
 * abilities 1/2 had no number key at all, while the HUD labelled them 1-4).
 */
const BINDINGS: Record<Action, readonly string[]> = KEYS

class InputManager {
  /** currently held bindings */
  private down = new Set<string>()
  /** bindings pressed since last frame-end (edge triggers) */
  private justPressed = new Set<string>()
  /** accumulated mouse delta (px) since last consumeLook */
  private lookX = 0
  private lookY = 0
  private attached = false
  private target: HTMLElement | null = null

  /** true while pointer lock is engaged */
  pointerLocked = false

  /** subscribers notified when pointer-lock state changes */
  private lockListeners = new Set<(locked: boolean) => void>()

  // -- lifecycle -------------------------------------------------------------

  attach(el: HTMLElement) {
    if (this.attached) return
    this.attached = true
    this.target = el
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    el.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    el.addEventListener('contextmenu', this.onContextMenu)
    // safety: drop all held keys when focus is lost (alt-tab etc.)
    window.addEventListener('blur', this.onBlur)
  }

  detach() {
    if (!this.attached) return
    this.attached = false
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.target?.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    this.target?.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('blur', this.onBlur)
    this.target = null
    this.down.clear()
    this.justPressed.clear()
    this.lookX = 0
    this.lookY = 0
  }

  // -- pointer lock ----------------------------------------------------------

  /** request pointer lock on the attached element (call from a user gesture).
   *  Failure is non-fatal: headless/iframe contexts may reject — the game
   *  stays playable, only mouse-look is unavailable. */
  requestPointerLock() {
    if (!this.target) return
    try {
      const p = this.target.requestPointerLock() as unknown
      if (p instanceof Promise) p.catch(() => {})
    } catch {
      /* pointer lock unavailable — degrade gracefully */
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock()
  }

  onLockChange(cb: (locked: boolean) => void): () => void {
    this.lockListeners.add(cb)
    return () => this.lockListeners.delete(cb)
  }

  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.target
    if (!this.pointerLocked) this.onBlur()
    this.lockListeners.forEach((cb) => cb(this.pointerLocked))
  }

  // -- event handlers --------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return
    this.down.add(e.code)
    this.justPressed.add(e.code)
    // stop Tab/Escape from stealing focus / browser shortcuts while playing
    if (e.code === 'Tab' || (this.pointerLocked && e.code === 'Space')) e.preventDefault()
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code)
  }

  private onMouseDown = (e: MouseEvent) => {
    const code = `Mouse${e.button}`
    this.down.add(code)
    this.justPressed.add(code)
    if (this.pointerLocked) e.preventDefault()
  }

  private onMouseUp = (e: MouseEvent) => {
    this.down.delete(`Mouse${e.button}`)
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked) return
    this.lookX += e.movementX
    this.lookY += e.movementY
  }

  private onContextMenu = (e: Event) => {
    // RMB is aim — never show the context menu over the canvas
    e.preventDefault()
  }

  private onBlur = () => {
    this.down.clear()
  }

  // -- read API ----------------------------------------------------------------

  /** level-triggered: is any binding for the action currently held? */
  held(action: Action): boolean {
    return BINDINGS[action].some((code) => this.down.has(code))
  }

  /** edge-triggered: true once per physical press; consumes the edge */
  pressed(action: Action): boolean {
    const hit = BINDINGS[action].some((code) => this.justPressed.has(code))
    if (hit) BINDINGS[action].forEach((code) => this.justPressed.delete(code))
    return hit
  }

  /** non-consuming edge check (rarely needed — prefer pressed()) */
  peekPressed(action: Action): boolean {
    return BINDINGS[action].some((code) => this.justPressed.has(code))
  }

  /** camera-relative move axis: x = strafe (+right), z = forward (+forward) */
  moveAxis(): { x: number; z: number } {
    const x = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0)
    const z = (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0)
    return { x, z }
  }

  /**
   * Consume accumulated mouse-look delta (pixels) since last call.
   * Multiply by your sensitivity (e.g. 0.0022 rad/px).
   */
  consumeLook(): { dx: number; dy: number } {
    const dx = this.lookX
    const dy = this.lookY
    this.lookX = 0
    this.lookY = 0
    return { dx, dy }
  }

  /** call at the END of each frame after all systems read input */
  endFrame() {
    this.justPressed.clear()
  }
}

/** Global input singleton. */
export const Input = new InputManager()
export type { Action as InputAction }
