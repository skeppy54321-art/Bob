/**
 * Minimal WebGL viewer for equirectangular (360°×180°) images.
 * yaw: degrees clockwise from north, pitch: degrees up, fov: vertical field of view.
 */
export interface View { yaw: number; pitch: number; fov: number }
export interface ViewerOptions { pan: boolean; zoom: boolean; onView?: (v: View) => void }

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `precision highp float;
uniform sampler2D tex; uniform vec2 res; uniform float yaw; uniform float pitch; uniform float fovY;
const float PI = 3.14159265359;
void main(){
  vec2 uv = (gl_FragCoord.xy / res) * 2.0 - 1.0;
  float t = tan(fovY * 0.5);
  vec3 d = normalize(vec3(uv.x * (res.x / res.y) * t, uv.y * t, 1.0));
  float cp = cos(pitch), sp = sin(pitch);
  d = vec3(d.x, d.y * cp + d.z * sp, -d.y * sp + d.z * cp);
  float cy = cos(yaw), sy = sin(yaw);
  d = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
  float lon = atan(d.x, d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  gl_FragColor = texture2D(tex, vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI));
}`;

export const FOV_MIN = 25, FOV_MAX = 100, FOV_DEFAULT = 90;

export class EquirectViewer {
  canvas: HTMLCanvasElement;
  view: View = { yaw: 0, pitch: 0, fov: FOV_DEFAULT };
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture | null = null;
  private raf = 0;
  private ro: ResizeObserver;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStart: { dist: number; fov: number } | null = null;
  private disposed = false;

  constructor(private container: HTMLElement, private opts: ViewerOptions) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-label', 'Street-level panorama. Drag or use arrow keys to look around.');
    this.canvas.setAttribute('role', 'img');
    container.appendChild(this.canvas);
    const gl = this.canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false }) as WebGLRenderingContext | null;
    if (!gl) throw new Error('WebGL is not available in this browser.');
    this.gl = gl;
    this.prog = this.program();
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.bindInput();
    this.resize();
  }

  private program(): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    gl.useProgram(p);
    return p;
  }

  setSource(src: TexImageSource) {
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.render();
  }

  setLocks(pan: boolean, zoom: boolean) { this.opts.pan = pan; this.opts.zoom = zoom; }

  setView(v: Partial<View>) {
    const n = { ...this.view, ...v };
    n.yaw = ((n.yaw % 360) + 360) % 360;
    n.pitch = Math.max(-85, Math.min(85, n.pitch));
    n.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, n.fov));
    this.view = n;
    this.render();
    this.opts.onView?.(n);
  }
  look(dYaw: number, dPitch: number) { if (this.opts.pan) this.setView({ yaw: this.view.yaw + dYaw, pitch: this.view.pitch + dPitch }); }
  zoomBy(factor: number) { if (this.opts.zoom) this.setView({ fov: this.view.fov * factor }); }

  private resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.container.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.container.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.render();
  }

  private render() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.tex || this.disposed) return;
      const gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      const u = (n: string) => gl.getUniformLocation(this.prog, n);
      gl.uniform2f(u('res'), this.canvas.width, this.canvas.height);
      gl.uniform1f(u('yaw'), (this.view.yaw * Math.PI) / 180);
      gl.uniform1f(u('pitch'), (this.view.pitch * Math.PI) / 180);
      gl.uniform1f(u('fovY'), (this.view.fov * Math.PI) / 180);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
  }

  private bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), fov: this.view.fov };
      }
    });
    const end = (e: PointerEvent) => { this.pointers.delete(e.pointerId); if (this.pointers.size < 2) this.pinchStart = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 2 && this.pinchStart) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.opts.zoom && d > 0) this.setView({ fov: this.pinchStart.fov * (this.pinchStart.dist / d) });
        return;
      }
      if (!this.opts.pan) return;
      const k = this.view.fov / this.container.clientHeight;
      this.setView({ yaw: this.view.yaw - (cur.x - prev.x) * k, pitch: this.view.pitch + (cur.y - prev.y) * k });
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.opts.zoom) this.setView({ fov: this.view.fov * Math.exp(e.deltaY * 0.0012) });
    }, { passive: false });
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    if (this.tex) this.gl.deleteTexture(this.tex);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.remove();
  }
}
