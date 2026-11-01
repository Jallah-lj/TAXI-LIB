export interface InputFrame {
  forward: number;
  right: number;
  run: boolean;
  brake: boolean;
}

export type ControlAction = 'interact' | 'camera' | 'trip' | 'emote' | 'lights';

export function conversationInput(active: boolean, input: InputFrame): InputFrame {
  return active ? { forward: 0, right: 0, run: false, brake: false } : input;
}

export class Controls {
  private readonly keys = new Set<string>();
  private touchForward = 0;
  private touchRight = 0;
  enabled = true;
  cameraYaw = Math.PI;
  cameraPitch = 0.35;
  cameraDistance = 7;
  orbiting = false;
  private lastPointer = { x: 0, y: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly action: (action: ControlAction) => void) {
    window.addEventListener('keydown', (event) => {
      if (this.isTyping()) return;
      this.keys.add(event.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code) && this.enabled) event.preventDefault();
      if (!event.repeat && this.enabled) {
        if (event.code === 'KeyE') this.action('interact');
        if (event.code === 'KeyC') this.action('camera');
        if (event.code === 'KeyF') this.action('trip');
        if (event.code === 'KeyG') this.action('emote');
        if (event.code === 'KeyL') this.action('lights');
      }
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointerdown', (event) => {
      if (!this.enabled || event.pointerType === 'touch') return;
      this.orbiting = true;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.orbiting || !this.enabled) return;
      this.cameraYaw -= (event.clientX - this.lastPointer.x) * 0.006;
      this.cameraPitch = Math.max(0.12, Math.min(0.75, this.cameraPitch + (event.clientY - this.lastPointer.y) * 0.004));
      this.lastPointer = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('pointerup', () => { this.orbiting = false; });
    canvas.addEventListener('wheel', (event) => {
      if (!this.enabled) return;
      this.cameraDistance = Math.max(4, Math.min(12, this.cameraDistance + event.deltaY * 0.008));
    }, { passive: true });
    this.bindTouch();
  }

  frame(): InputFrame {
    if (!this.enabled) return { forward: 0, right: 0, run: false, brake: false };
    let forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    let right = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    let run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    let brake = this.keys.has('Space');
    const gamepad = navigator.getGamepads?.()[0];
    if (gamepad) {
      const deadzone = (value: number) => Math.abs(value) > 0.16 ? value : 0;
      forward += -deadzone(gamepad.axes[1] ?? 0);
      right += deadzone(gamepad.axes[0] ?? 0);
      forward += (gamepad.buttons[7]?.value ?? 0) - (gamepad.buttons[6]?.value ?? 0);
      brake ||= gamepad.buttons[0]?.pressed ?? false;
      run ||= gamepad.buttons[10]?.pressed ?? false;
      if (gamepad.buttons[1]?.pressed && !this.keys.has('GamepadB')) { this.keys.add('GamepadB'); this.action('interact'); }
      if (!gamepad.buttons[1]?.pressed) this.keys.delete('GamepadB');
    }
    forward = Math.max(-1, Math.min(1, forward + this.touchForward));
    right = Math.max(-1, Math.min(1, right + this.touchRight));
    return { forward, right, run, brake };
  }

  clear() { this.keys.clear(); this.touchForward = 0; this.touchRight = 0; }

  private isTyping() {
    const element = document.activeElement;
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
  }

  private bindTouch() {
    const joystick = document.querySelector<HTMLElement>('[data-touch-joystick]');
    if (joystick) {
      let pointerId: number | null = null;
      const update = (event: PointerEvent) => {
        const rect = joystick.getBoundingClientRect();
        const x = (event.clientX - (rect.left + rect.width / 2)) / (rect.width * 0.36);
        const y = (event.clientY - (rect.top + rect.height / 2)) / (rect.height * 0.36);
        this.touchRight = Math.max(-1, Math.min(1, x));
        this.touchForward = Math.max(-1, Math.min(1, -y));
        joystick.style.setProperty('--stick-x', `${this.touchRight * 24}px`);
        joystick.style.setProperty('--stick-y', `${-this.touchForward * 24}px`);
      };
      joystick.addEventListener('pointerdown', (event) => { pointerId = event.pointerId; joystick.setPointerCapture(pointerId); update(event); });
      joystick.addEventListener('pointermove', (event) => { if (event.pointerId === pointerId) update(event); });
      const end = () => { pointerId = null; this.touchForward = 0; this.touchRight = 0; joystick.style.setProperty('--stick-x', '0px'); joystick.style.setProperty('--stick-y', '0px'); };
      joystick.addEventListener('pointerup', end); joystick.addEventListener('pointercancel', end);
    }
    document.querySelectorAll<HTMLElement>('[data-control]').forEach((button) => {
      const control = button.dataset.control;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (control === 'brake') this.keys.add('Space');
        if (control === 'interact') this.action('interact');
        if (control === 'trip') this.action('trip');
        if (control === 'lights') this.action('lights');
      });
      button.addEventListener('pointerup', () => { if (control === 'brake') this.keys.delete('Space'); });
    });
  }
}
