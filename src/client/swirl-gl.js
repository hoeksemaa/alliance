// The table: a slow pixel-paint swirl behind the whole screen (WebGL). A new pattern on each page load.
const PX = 5; // each swirl pixel is 5 CSS px wide

const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `precision mediump float;
  uniform vec2 r; uniform float t; uniform float k; uniform vec3 a; uniform vec3 b; uniform vec3 c; uniform vec3 d;
  float band(float v, float n) { float q = v * n; return (floor(q) + smoothstep(0.42, 0.58, fract(q))) / n; }
  void main(){
    vec2 p = (gl_FragCoord.xy - 0.5 * r) / min(r.x, r.y);
    float L = length(p) + 0.0001;
    float s = t * 0.045;
    float ang = atan(p.y, p.x) + k + s * 0.5 + 1.2 / (0.5 + L);
    vec2 q = vec2(cos(ang), sin(ang)) * L * 3.6;
    for (int i = 0; i < 5; i++) {
      float f = float(i);
      q += 0.38 * vec2(sin(q.y * 1.15 + s * (1.0 + 0.27 * f) + f * 1.3), cos(q.x * 1.05 - s * (0.85 + 0.21 * f) + f * 2.1));
    }
    float v = band(0.5 + 0.5 * sin(q.x * 0.8 + q.y * 0.6), 5.0);
    float w = band(0.5 + 0.5 * cos(length(q) * 0.9 - s * 1.7), 4.0);
    vec3 col = mix(a, b, smoothstep(0.2, 0.85, v));
    col = mix(col, c, smoothstep(0.45, 0.95, w) * 0.75);
    col = mix(col, d, smoothstep(0.7, 1.0, v * w) * 0.6);
    gl_FragColor = vec4(col, 1.0);
  }`;

export function startSwirl(canvas) {
  const none = { colors() {}, stop() {} };
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) return none;
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return none;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = Object.fromEntries(["r", "t", "k", "a", "b", "c", "d"].map((n) => [n, gl.getUniformLocation(prog, n)]));
  gl.uniform1f(U.k, Math.random() * Math.PI * 2);
  const t0 = performance.now() - (20000 + Math.random() * 600000);
  const hex = (h) => { h = h.trim().replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
  const draw = (now) => { gl.uniform2f(U.r, canvas.width, canvas.height); gl.uniform1f(U.t, (now - t0) / 1000); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
  let last = 0, raf = 0, on = true;
  const loop = (now) => {
    if (!on) return;
    if (now - last > 33) { draw(now); last = now; }
    if (!still.matches) raf = requestAnimationFrame(loop);
  };
  const size = () => {
    canvas.width = Math.max(32, Math.round((canvas.clientWidth || 360) / PX));
    canvas.height = Math.max(32, Math.round((canvas.clientHeight || 640) / PX));
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw(performance.now());
  };
  const colors = () => {
    const cs = getComputedStyle(document.documentElement);
    ["a", "b", "c", "d"].forEach((k) => gl.uniform3fv(U[k], hex(cs.getPropertyValue("--sw-" + k) || "#888888")));
    draw(performance.now());
  };
  const ro = new ResizeObserver(size);
  ro.observe(canvas);
  const wake = () => { if (!still.matches) raf = requestAnimationFrame(loop); };
  still.addEventListener("change", wake);
  colors();
  raf = requestAnimationFrame(loop);
  return {
    colors,
    stop() { on = false; cancelAnimationFrame(raf); ro.disconnect(); still.removeEventListener("change", wake); },
  };
}
