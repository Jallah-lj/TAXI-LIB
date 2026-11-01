import * as THREE from 'three';

function canvasTexture(size: number, paint: (context: CanvasRenderingContext2D, size: number) => void, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  paint(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  return texture;
}

function noise(context: CanvasRenderingContext2D, size: number, amount: number, alpha = 0.08) {
  let seed = 91827;
  for (let index = 0; index < amount; index += 1) {
    seed = (seed * 16807) % 2147483647;
    const x = seed % size;
    seed = (seed * 16807) % 2147483647;
    const y = seed % size;
    const shade = 50 + (seed % 150);
    context.fillStyle = `rgba(${shade},${shade},${shade},${alpha})`;
    context.fillRect(x, y, 1 + (seed % 3), 1 + (seed % 2));
  }
}

export const asphaltTexture = canvasTexture(256, (context, size) => {
  context.fillStyle = '#4b4c48';
  context.fillRect(0, 0, size, size);
  noise(context, size, 4500, 0.12);
  context.strokeStyle = 'rgba(25,28,27,.16)';
  context.lineWidth = 1;
  for (let line = 0; line < 9; line += 1) {
    context.beginPath();
    context.moveTo((line * 47) % size, 0);
    context.bezierCurveTo(80, 60, 10, 170, (line * 71) % size, size);
    context.stroke();
  }
}, 2, 8);

export const plasterTexture = canvasTexture(256, (context, size) => {
  context.fillStyle = '#d8d1c1';
  context.fillRect(0, 0, size, size);
  noise(context, size, 3200, 0.09);
  for (let index = 0; index < 22; index += 1) {
    context.fillStyle = `rgba(70,78,63,${0.015 + (index % 3) * 0.008})`;
    context.fillRect((index * 67) % size, (index * 37) % size, 14 + (index % 5) * 9, 2);
  }
}, 2, 2);

export const corrugatedTexture = canvasTexture(256, (context, size) => {
  context.fillStyle = '#a69f91';
  context.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x += 12) {
    context.fillStyle = x % 24 === 0 ? 'rgba(255,255,255,.17)' : 'rgba(20,25,23,.16)';
    context.fillRect(x, 0, 5, size);
  }
  noise(context, size, 700, 0.12);
}, 3, 3);

export const sandTexture = canvasTexture(256, (context, size) => {
  context.fillStyle = '#c7b487';
  context.fillRect(0, 0, size, size);
  noise(context, size, 5000, 0.09);
}, 12, 20);

export const grassTexture = canvasTexture(256, (context, size) => {
  context.fillStyle = '#667553';
  context.fillRect(0, 0, size, size);
  noise(context, size, 5500, 0.08);
  context.strokeStyle = 'rgba(38,65,38,.14)';
  for (let index = 0; index < 300; index += 1) {
    const x = (index * 83) % size;
    const y = (index * 41) % size;
    context.beginPath(); context.moveTo(x, y); context.lineTo(x + 2, y - 5); context.stroke();
  }
}, 24, 24);

export const waterTexture = canvasTexture(256, (context, size) => {
  context.fillStyle = '#397d86';
  context.fillRect(0, 0, size, size);
  context.strokeStyle = 'rgba(196,229,218,.18)';
  context.lineWidth = 2;
  for (let y = 4; y < size; y += 17) {
    context.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const py = y + Math.sin(x * 0.09 + y) * 3;
      if (x === 0) context.moveTo(x, py); else context.lineTo(x, py);
    }
    context.stroke();
  }
}, 12, 18);

export function makeTextTexture(text: string, options: { background?: string; color?: string; width?: number; height?: number; subtitle?: string } = {}) {
  const width = options.width ?? 512;
  const height = options.height ?? 160;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = options.background ?? '#173a37';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgba(255,255,255,.28)';
  context.lineWidth = 5;
  context.strokeRect(5, 5, width - 10, height - 10);
  context.fillStyle = options.color ?? '#f7f0df';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `700 ${Math.min(58, width / Math.max(7, text.length) * 1.25)}px Arial`;
  context.fillText(text.toUpperCase(), width / 2, options.subtitle ? height * 0.43 : height / 2);
  if (options.subtitle) {
    context.font = '500 24px Arial';
    context.fillStyle = '#e9bd5a';
    context.fillText(options.subtitle.toUpperCase(), width / 2, height * 0.75);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeNameTexture(name: string, color = '#f5f0e6', subtitle?: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'rgba(15,32,32,.82)';
  context.beginPath(); context.roundRect(42, 10, 428, subtitle ? 104 : 82, 16); context.fill();
  context.fillStyle = color;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.font = `600 ${subtitle ? 32 : 36}px Arial`;
  context.fillText(name, 256, subtitle ? 43 : 52, 382);
  if (subtitle) {
    context.fillStyle = '#e9bd5a'; context.font = '500 20px Arial';
    context.fillText(subtitle.toUpperCase(), 256, 84, 382);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeNameSprite(name: string, color = '#f5f0e6', subtitle?: string) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeNameTexture(name, color, subtitle), transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
  }));
  sprite.scale.set(2.75, 0.69, 1);
  sprite.renderOrder = 20;
  return sprite;
}
