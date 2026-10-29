/**
 * Procedural 360° demo scenes (our own code, no photos).
 *
 * Used only in DEMO mode when no live imagery provider is configured. A scene is a road through a
 * biome with a few region cues taken from the server's scene description: driving side, centre
 * line colour, and the sun's position (which depends on latitude). The camera can travel along the
 * road ("Moving" rules): `step` moves it STEP_M metres forward/back.
 */
export interface DemoScene { biome: string; line: 'white' | 'yellow' | 'none'; side: 'L' | 'R'; sun: { elev: number; az: number }; seed: number }

export const STEP_M = 14;
export const MAX_STEPS = 12;
const CAM_H = 2.4;
const ROAD_W = 7.4;

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

interface Biome {
  skyTop: string; skyHor: string; ground: [string, string]; shoulder: string; road: string; ridge: [string, string] | null;
  ridgeH: [number, number]; fog: number; clouds: number; objects: [string, number][]; density: number; snow?: boolean; water?: boolean; urban?: boolean;
}
const B: Record<string, Biome> = {
  desert: { skyTop: '#2f6fc9', skyHor: '#d9e6ef', ground: ['#d8b47c', '#c39258'], shoulder: '#c9a46c', road: '#55524f', ridge: ['#a9714a', '#c99b70'], ridgeH: [3, 8], fog: 900, clouds: 0.05, objects: [['shrub', 6], ['rock', 3], ['pole', 2], ['cactus', 1]], density: 0.55 },
  dunes: { skyTop: '#3170c4', skyHor: '#e8e2d4', ground: ['#e2a964', '#c98443'], shoulder: '#d8a467', road: '#5b544c', ridge: ['#d48a49', '#e7aa6a'], ridgeH: [2, 6], fog: 1100, clouds: 0.02, objects: [['rock', 1], ['pole', 1]], density: 0.25 },
  farmland: { skyTop: '#3d7ad6', skyHor: '#dbe9f3', ground: ['#86a944', '#b5a64d'], shoulder: '#8f9a55', road: '#47494d', ridge: ['#6d8a5c', '#93a77d'], ridgeH: [1, 3], fog: 700, clouds: 0.35, objects: [['tree', 3], ['pole', 3], ['house', 1], ['fence', 2]], density: 0.7 },
  forest: { skyTop: '#4b80c9', skyHor: '#d6e3ea', ground: ['#4f7a35', '#3e6229'], shoulder: '#6c7a4b', road: '#3f4246', ridge: ['#3d5c3a', '#58775a'], ridgeH: [3, 8], fog: 450, clouds: 0.45, objects: [['tree', 8], ['pine', 3], ['pole', 1]], density: 1.6 },
  boreal: { skyTop: '#5a86c2', skyHor: '#dfe7ec', ground: ['#4c6b45', '#6d7e5d'], shoulder: '#7c7d70', road: '#3d4043', ridge: ['#33503f', '#4f6b5e'], ridgeH: [2, 6], fog: 420, clouds: 0.5, objects: [['pine', 10], ['tree', 1], ['pole', 1]], density: 1.8 },
  jungle: { skyTop: '#4a86c4', skyHor: '#e3ece6', ground: ['#2f6b2b', '#4e8b2e'], shoulder: '#8b5a35', road: '#4a4643', ridge: ['#2d5a32', '#3f7346'], ridgeH: [4, 10], fog: 320, clouds: 0.55, objects: [['palm', 4], ['tree', 6], ['shrub', 3]], density: 2.2 },
  savanna: { skyTop: '#3b77cf', skyHor: '#e7e4d6', ground: ['#c7a85a', '#a99645'], shoulder: '#b67a49', road: '#4f4b47', ridge: ['#8c7a55', '#a8986e'], ridgeH: [1, 4], fog: 800, clouds: 0.2, objects: [['acacia', 4], ['shrub', 4], ['pole', 1]], density: 0.6 },
  alpine: { skyTop: '#2b67c8', skyHor: '#dbe8f4', ground: ['#5f7c48', '#7b8c5f'], shoulder: '#8a8a80', road: '#43464a', ridge: ['#6d7686', '#e9eef5'], ridgeH: [12, 26], fog: 700, clouds: 0.3, objects: [['pine', 6], ['rock', 3], ['pole', 1]], density: 0.9, snow: true },
  tundra: { skyTop: '#577fb0', skyHor: '#d9e0e6', ground: ['#7d8462', '#99916f'], shoulder: '#8d8a7e', road: '#4a4c4e', ridge: ['#626c70', '#8f989b'], ridgeH: [3, 9], fog: 650, clouds: 0.7, objects: [['rock', 4], ['shrub', 2], ['pole', 2]], density: 0.4 },
  steppe: { skyTop: '#3d76c6', skyHor: '#e1e7ea', ground: ['#a6a560', '#c0b07a'], shoulder: '#a49673', road: '#4f4f4f', ridge: ['#8e8a6a', '#aaa587'], ridgeH: [1, 4], fog: 1000, clouds: 0.25, objects: [['pole', 3], ['shrub', 2], ['fence', 1]], density: 0.35 },
  mediterranean: { skyTop: '#2c6fd0', skyHor: '#dce9f2', ground: ['#a49a5a', '#8c8a4b'], shoulder: '#b39c74', road: '#45464a', ridge: ['#7d8460', '#a5a585'], ridgeH: [3, 8], fog: 700, clouds: 0.12, objects: [['olive', 4], ['cypress', 2], ['house', 2], ['pole', 1]], density: 0.8 },
  city: { skyTop: '#4d7fbf', skyHor: '#d8dee5', ground: ['#8e9196', '#7c7f84'], shoulder: '#a3a5a8', road: '#3a3c40', ridge: null, ridgeH: [0, 0], fog: 380, clouds: 0.4, objects: [['building', 10], ['streetlight', 3], ['tree', 1]], density: 1.4, urban: true },
  coast: { skyTop: '#2f72d2', skyHor: '#e2edf4', ground: ['#e6d3a0', '#d8c28a'], shoulder: '#cbb68a', road: '#4a4b4d', ridge: ['#5d7a8c', '#88a2b2'], ridgeH: [1, 3], fog: 900, clouds: 0.2, objects: [['palm', 4], ['house', 1], ['pole', 2]], density: 0.6, water: true },
  outback: { skyTop: '#2e6bc9', skyHor: '#e3e4dc', ground: ['#b5562c', '#c8763e'], shoulder: '#a3532d', road: '#4d4844', ridge: ['#9c4d2c', '#b8693f'], ridgeH: [1, 4], fog: 1100, clouds: 0.08, objects: [['shrub', 5], ['rock', 2], ['gum', 2]], density: 0.45 },
  ice: { skyTop: '#5b88c6', skyHor: '#eef3f7', ground: ['#e9eef4', '#d8e2ec'], shoulder: '#c8d3de', road: '#8d96a0', ridge: ['#c3d1df', '#f4f8fb'], ridgeH: [2, 6], fog: 800, clouds: 0.3, objects: [['pole', 2], ['rock', 1]], density: 0.2, snow: true },
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash2(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

interface Obj { kind: string; x: number; z: number; h: number; w: number; color: RGB; color2: RGB; r: number }

function placeObjects(b: Biome, seed: number, scene: DemoScene): Obj[] {
  const R = rng(seed ^ 0x9e3779b9);
  const total = b.objects.reduce((a, o) => a + o[1], 0);
  const pick = () => { let x = R() * total; for (const [k, w] of b.objects) { x -= w; if (x <= 0) return k; } return b.objects[0][0]; };
  const objs: Obj[] = [];
  const span = 260;
  const count = Math.round(span * 2 * b.density * 0.5);
  for (let i = 0; i < count; i++) {
    const kind = pick();
    const sideSign = R() < 0.5 ? -1 : 1;
    const z = (R() * 2 - 1) * span;
    let x = sideSign * (ROAD_W / 2 + 2.5 + R() * (b.urban ? 3 : 40));
    if (kind === 'pole' || kind === 'streetlight') x = (scene.side === 'R' ? 1 : -1) * (ROAD_W / 2 + 1.6) * (kind === 'streetlight' ? sideSign : 1);
    if (kind === 'fence') x = sideSign * (ROAD_W / 2 + 4);
    if (b.water && x < -ROAD_W / 2 - 10) continue; // water on the left
    const base: Record<string, [number, number]> = {
      tree: [7, 5], pine: [12, 3.6], palm: [10, 4], cactus: [4, 1.2], shrub: [1.2, 2.2], rock: [1.4, 2.6], pole: [9, 0.35], house: [6.5, 9],
      building: [14, 14], streetlight: [8, 0.3], acacia: [6, 8], olive: [4, 4.5], cypress: [11, 2.2], gum: [9, 6], fence: [1.2, 6],
    };
    const [h, w] = base[kind] ?? [3, 3];
    const s = 0.7 + R() * 0.6;
    const hue = R();
    const palette: Record<string, [string, string]> = {
      tree: ['#3f6e2f', '#2f5524'], pine: ['#24452d', '#1b3622'], palm: ['#3f7d31', '#7a5a3a'], cactus: ['#4f7d3d', '#3c6530'], shrub: ['#6f7d3c', '#5a6830'],
      rock: ['#8a8077', '#6e665e'], pole: ['#6b5642', '#4f4134'], house: [hue < 0.33 ? '#d9c7a5' : hue < 0.66 ? '#e8e3d9' : '#c98e6b', '#8d3b2e'],
      building: [hue < 0.3 ? '#9aa3ad' : hue < 0.6 ? '#b8a48c' : hue < 0.8 ? '#6f7b88' : '#c9c2b6', '#2c3540'], streetlight: ['#4d5257', '#f4e7b2'],
      acacia: ['#5d7031', '#4a3a28'], olive: ['#7c8a5a', '#5b4a3a'], cypress: ['#2d4a2c', '#24391f'], gum: ['#7d8c5d', '#d9d2c3'], fence: ['#7a6a55', '#7a6a55'],
    };
    const [c1, c2] = palette[kind] ?? ['#777777', '#555555'];
    if (b.urban && kind === 'building') { x = sideSign * (ROAD_W / 2 + 3 + R() * 2); }
    objs.push({ kind, x, z, h: h * (kind === 'building' ? 0.6 + R() * 3.2 : s), w: w * (kind === 'building' ? 0.8 + R() : s), color: hex(c1), color2: hex(c2), r: R() });
  }
  return objs;
}

export function renderDemoScene(scene: DemoScene, step: number, W = 2048, H = 1024): HTMLCanvasElement {
  const b = B[scene.biome] ?? B.farmland;
  const seed = scene.seed >>> 0;
  const R = rng(seed);
  const camZ = step * STEP_M;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const px = img.data;

  const skyTop = hex(b.skyTop), skyHor = hex(b.skyHor), g1 = hex(b.ground[0]), g2 = hex(b.ground[1]);
  const shoulder = hex(b.shoulder), road = hex(b.road), lineC = scene.line === 'yellow' ? hex('#f2c230') : hex('#f2f2ee');
  const ridgeA = b.ridge ? hex(b.ridge[0]) : skyHor, ridgeB = b.ridge ? hex(b.ridge[1]) : skyHor;
  const water = hex('#2d6c8f');
  const sunEl = (scene.sun.elev * Math.PI) / 180, sunAz = (scene.sun.az * Math.PI) / 180;
  const sun = [Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), Math.cos(sunAz) * Math.cos(sunEl)];
  // Two ridge layers built from integer harmonics so they wrap seamlessly around 360°.
  const harm = Array.from({ length: 7 }, (_, i) => ({ k: i + 1 + Math.floor(R() * 3), a: R() / (i + 1.3), p: R() * Math.PI * 2 }));
  const harm2 = Array.from({ length: 6 }, (_, i) => ({ k: i + 2 + Math.floor(R() * 4), a: R() / (i + 1), p: R() * Math.PI * 2 }));
  const ridgeAt = (lon: number, hs: typeof harm, lo: number, hi: number) => {
    let v = 0, n = 0;
    for (const h of hs) { v += h.a * Math.sin(h.k * lon + h.p); n += h.a; }
    return ((lo + (hi - lo) * (0.5 + 0.5 * v / n)) * Math.PI) / 180;
  };
  const sinLon = new Float32Array(W), cosLon = new Float32Array(W), r1 = new Float32Array(W), r2 = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const lon = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
    sinLon[x] = Math.sin(lon); cosLon[x] = Math.cos(lon);
    r1[x] = b.ridge ? ridgeAt(lon, harm, b.ridgeH[0], b.ridgeH[1]) : -1;
    r2[x] = b.ridge ? ridgeAt(lon, harm2, b.ridgeH[0] * 0.4, b.ridgeH[1] * 0.55) : -1;
  }
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < W; x++) {
      const dx = cl * sinLon[x], dy = sl, dz = cl * cosLon[x];
      let c: RGB;
      if (lat >= 0) {
        const t = Math.pow(lat / (Math.PI / 2), 0.55);
        c = mix(skyHor, skyTop, t);
        const sd = dx * sun[0] + dy * sun[1] + dz * sun[2];
        if (sd > 0.9995) c = [255, 252, 238];
        else if (sd > 0.96) c = mix(c, [255, 246, 220], Math.pow((sd - 0.96) / 0.0395, 3) * 0.85);
        if (b.clouds > 0 && lat > 0.02) {
          const cn = noise(cosLon[x] * 3 + 10, sl * 9 + sinLon[x] * 3, seed) * 0.65 + noise(cosLon[x] * 9, sl * 25 + sinLon[x] * 9, seed + 1) * 0.35;
          const cv = Math.max(0, cn - (1 - b.clouds)) / Math.max(0.05, b.clouds);
          c = mix(c, [250, 251, 253], Math.min(0.9, cv * 1.6) * (1 - t * 0.5));
        }
        if (lat < r1[x]) {
          const shade = 0.75 + 0.25 * (lat / r1[x]);
          let rc: RGB = mix(ridgeA, ridgeB, 0.3);
          if (b.snow && lat > r1[x] * 0.62) rc = [236, 241, 247];
          c = mix(mix(rc, ridgeA, 1 - shade), skyHor, 0.55);
        }
        if (lat < r2[x]) c = mix(mix(ridgeA, g2, 0.4), skyHor, 0.35);
      } else {
        const tt = CAM_H / -dy;
        const gx = tt * dx, gz = tt * dz + camZ;
        const dist = tt * cl;
        const ax = Math.abs(gx);
        if (ax < ROAD_W / 2) {
          c = mix(road, [0, 0, 0], noise(gx * 2, gz * 2, seed + 5) * 0.08);
          const dash = ((gz % 9) + 9) % 9 < 4.5;
          if (scene.line !== 'none' && ax < 0.09 && (scene.line === 'yellow' || dash)) c = lineC;
          if (scene.line === 'yellow' && Math.abs(ax - 0.22) < 0.07) c = lineC; // double yellow
          if (ax > ROAD_W / 2 - 0.3 && ax < ROAD_W / 2 - 0.15 && !b.urban && scene.line !== 'none') c = [232, 232, 228];
        } else if (ax < ROAD_W / 2 + 1.4) {
          c = mix(shoulder, g2, noise(gx, gz, seed + 7) * 0.4);
          if (b.urban) c = mix([170, 172, 176], [150, 152, 156], ((Math.floor(gx) + Math.floor(gz)) & 1) * 0.5);
        } else if (b.water && gx < -ROAD_W / 2 - 10) {
          c = mix(water, skyHor, Math.min(0.75, 1 - Math.exp(-dist / 260)));
          c = mix(c, [255, 255, 255], Math.max(0, noise(gx * 0.5, gz * 2, seed) - 0.82) * 2);
        } else {
          const n1 = noise(gx * 0.045, gz * 0.045, seed + 11), n2 = noise(gx * 0.6, gz * 0.6, seed + 13);
          c = mix(g1, g2, n1);
          if (scene.biome === 'farmland') c = mix(c, (Math.floor(gz / 60) + Math.floor(gx / 70)) % 2 ? [176, 160, 74] : [104, 140, 58], 0.45);
          const detail = Math.exp(-dist / 30);
          c = mix(c, mix(c, [0, 0, 0], 0.25), (n2 - 0.5) * detail);
        }
        c = mix(c, skyHor, Math.min(1, 1 - Math.exp(-dist / b.fog)));
      }
      const i = (y * W + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Billboards, far to near.
  const objs = placeObjects(b, seed, scene);
  // Vehicles: one ahead in our lane, one oncoming in the other lane — reveals the driving side.
  const lane = scene.side === 'R' ? 1 : -1;
  const carCols = ['#c0392b', '#e8e8e8', '#2c3e50', '#3a6ea5', '#7f8c8d', '#d4ac0d'];
  objs.push({ kind: 'car', x: lane * 1.8, z: 26 + R() * 30, h: 1.5, w: 1.9, color: hex(carCols[Math.floor(R() * carCols.length)]), color2: [30, 30, 30], r: R() });
  objs.push({ kind: 'car', x: -lane * 1.8, z: 70 + R() * 60, h: 1.5, w: 1.9, color: hex(carCols[Math.floor(R() * carCols.length)]), color2: [30, 30, 30], r: R() });
  const vis = objs.map((o) => ({ o, rx: o.x, rz: o.z - camZ })).map((v) => ({ ...v, d: Math.hypot(v.rx, v.rz) })).filter((v) => v.d > 1.2 && v.d < 280);
  vis.sort((a, b2) => b2.d - a.d);
  const U = (lon: number) => (lon / (Math.PI * 2) + 0.5) * W;
  const V = (ang: number) => (0.5 - ang / Math.PI) * H;
  for (const { o, rx, rz, d } of vis) {
    const lon = Math.atan2(rx, rz);
    const fog = Math.min(1, 1 - Math.exp(-d / b.fog));
    const col = css(mix(o.color, skyHor, fog)), col2 = css(mix(o.color2, skyHor, fog));
    const base = V(Math.atan2(-CAM_H, d));
    const top = V(Math.atan2(o.h - CAM_H, d));
    const hp = base - top;
    const wp = ((o.w / d) / (Math.PI * 2)) * W;
    for (const off of [0, -W, W]) {
      const u = U(lon) + off;
      if (u < -wp * 2 || u > W + wp * 2) continue;
      drawObj(ctx, o, u, base, hp, wp, col, col2);
    }
  }
  return canvas;
}

function drawObj(ctx: CanvasRenderingContext2D, o: Obj, u: number, base: number, hp: number, wp: number, col: string, col2: string) {
  ctx.save();
  switch (o.kind) {
    case 'tree': case 'olive': case 'gum': {
      ctx.fillStyle = col2; ctx.fillRect(u - wp * 0.07, base - hp * 0.45, wp * 0.14, hp * 0.45);
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(u, base - hp * 0.62, wp * 0.5, hp * 0.38, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(u - wp * 0.18, base - hp * 0.75, wp * 0.3, hp * 0.22, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'pine': case 'cypress': {
      ctx.fillStyle = col2; ctx.fillRect(u - wp * 0.06, base - hp * 0.15, wp * 0.12, hp * 0.15);
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(u, base - hp); ctx.lineTo(u + wp / 2, base - hp * 0.12); ctx.lineTo(u - wp / 2, base - hp * 0.12); ctx.closePath(); ctx.fill();
      break;
    }
    case 'palm': {
      ctx.strokeStyle = col2; ctx.lineWidth = Math.max(1, wp * 0.08); ctx.beginPath(); ctx.moveTo(u, base); ctx.quadraticCurveTo(u + wp * 0.15, base - hp * 0.5, u + wp * 0.05, base - hp); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, wp * 0.07);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(u + wp * 0.05, base - hp); ctx.quadraticCurveTo(u + Math.cos(a) * wp * 0.4, base - hp - hp * 0.12, u + Math.cos(a) * wp * 0.55, base - hp + Math.abs(Math.sin(a)) * hp * 0.18); ctx.stroke(); }
      break;
    }
    case 'acacia': {
      ctx.strokeStyle = col2; ctx.lineWidth = Math.max(1, wp * 0.06); ctx.beginPath(); ctx.moveTo(u, base); ctx.lineTo(u, base - hp * 0.7); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(u, base - hp * 0.78, wp * 0.55, hp * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'cactus': {
      ctx.fillStyle = col; ctx.fillRect(u - wp * 0.18, base - hp, wp * 0.36, hp);
      ctx.fillRect(u - wp * 0.5, base - hp * 0.6, wp * 0.18, hp * 0.3); ctx.fillRect(u - wp * 0.5, base - hp * 0.6, wp * 0.4, hp * 0.08);
      break;
    }
    case 'shrub': case 'rock': {
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(u, base - hp * 0.45, wp * 0.5, hp * 0.5, 0, Math.PI, 0); ctx.lineTo(u + wp * 0.5, base); ctx.lineTo(u - wp * 0.5, base); ctx.fill();
      break;
    }
    case 'pole': case 'streetlight': {
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, wp); ctx.beginPath(); ctx.moveTo(u, base); ctx.lineTo(u, base - hp); ctx.stroke();
      if (o.kind === 'pole') { ctx.lineWidth = Math.max(1, wp * 0.6); ctx.beginPath(); ctx.moveTo(u - hp * 0.12, base - hp * 0.92); ctx.lineTo(u + hp * 0.12, base - hp * 0.92); ctx.stroke(); }
      else { ctx.fillStyle = col2; ctx.fillRect(u - hp * 0.08, base - hp, hp * 0.16, hp * 0.04); }
      break;
    }
    case 'fence': {
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, hp * 0.08);
      ctx.beginPath(); ctx.moveTo(u - wp / 2, base - hp * 0.8); ctx.lineTo(u + wp / 2, base - hp * 0.8); ctx.moveTo(u - wp / 2, base - hp * 0.4); ctx.lineTo(u + wp / 2, base - hp * 0.4); ctx.stroke();
      break;
    }
    case 'house': {
      ctx.fillStyle = col; ctx.fillRect(u - wp / 2, base - hp * 0.62, wp, hp * 0.62);
      ctx.fillStyle = col2; ctx.beginPath(); ctx.moveTo(u - wp * 0.58, base - hp * 0.6); ctx.lineTo(u, base - hp); ctx.lineTo(u + wp * 0.58, base - hp * 0.6); ctx.fill();
      ctx.fillStyle = 'rgba(40,50,60,.7)'; ctx.fillRect(u - wp * 0.3, base - hp * 0.45, wp * 0.16, hp * 0.16); ctx.fillRect(u + wp * 0.14, base - hp * 0.45, wp * 0.16, hp * 0.16);
      break;
    }
    case 'building': {
      ctx.fillStyle = col; ctx.fillRect(u - wp / 2, base - hp, wp, hp);
      ctx.fillStyle = 'rgba(30,40,55,.55)';
      const rows = Math.max(1, Math.floor(o.h / 3.2)), cols = Math.max(1, Math.floor(o.w / 3));
      if (hp / rows > 2 && wp / cols > 2) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ctx.fillRect(u - wp / 2 + (c + 0.25) * (wp / cols), base - hp + (r + 0.25) * (hp / rows), (wp / cols) * 0.5, (hp / rows) * 0.45);
      break;
    }
    case 'car': {
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(u - wp / 2, base - hp * 0.75, wp, hp * 0.6, Math.max(1, wp * 0.08)); ctx.fill();
      ctx.fillStyle = 'rgba(25,30,40,.85)'; ctx.fillRect(u - wp * 0.32, base - hp, wp * 0.64, hp * 0.3);
      ctx.fillStyle = col2; ctx.fillRect(u - wp * 0.45, base - hp * 0.15, wp * 0.18, hp * 0.15); ctx.fillRect(u + wp * 0.27, base - hp * 0.15, wp * 0.18, hp * 0.15);
      break;
    }
  }
  ctx.restore();
}
