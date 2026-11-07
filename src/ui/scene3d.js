// Three.js view of the crush rig: deforming can, rigid crusher, anvil.
// Units in the scene are millimetres.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';

// ---------------------------------------------------------------------------
// Minimal orbit controls (rotate / zoom / pan, mouse + touch)
class Orbit {
  constructor(camera, el, onChange) {
    this.camera = camera; this.el = el; this.onChange = onChange;
    this.target = new THREE.Vector3(0, 60, 0);
    this.radius = 300; this.theta = 0.6; this.phi = 1.15;
    this.pointers = new Map();
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointercancel', (e) => this._up(e));
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.update();
  }
  _down(e) {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
    this._pinch = null;
  }
  _up(e) { this.pointers.delete(e.pointerId); this._pinch = null; }
  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (this.pointers.size >= 2) {
      const pts = [...this.pointers.values()];
      p.x = e.clientX; p.y = e.clientY;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
      if (this._pinch) {
        this.zoom(this._pinch.d / Math.max(1, d));
        this.pan(cx - this._pinch.cx, cy - this._pinch.cy);
      }
      this._pinch = { d, cx, cy };
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (p.button === 2 || p.shift || e.shiftKey) this.pan(dx, dy);
    else {
      this.theta -= dx * 0.008;
      this.phi = Math.min(Math.PI - 0.08, Math.max(0.08, this.phi - dy * 0.008));
      this.update();
    }
  }
  zoom(f) { this.radius = Math.min(1200, Math.max(60, this.radius * f)); this.update(); }
  pan(dx, dy) {
    const s = this.radius * 0.0018;
    const cam = this.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    this.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    this.update();
  }
  set(target, radius, theta, phi) {
    this.target.copy(target); this.radius = radius;
    if (theta !== undefined) this.theta = theta;
    if (phi !== undefined) this.phi = phi;
    this.update();
  }
  update() {
    const { radius: r, theta, phi } = this;
    this.camera.position.set(
      this.target.x + r * Math.sin(phi) * Math.sin(theta),
      this.target.y + r * Math.cos(phi),
      this.target.z + r * Math.sin(phi) * Math.cos(theta),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.onChange && this.onChange();
  }
}

// ---------------------------------------------------------------------------
// Can label texture (an invented, generic test-can livery)
function makeLabelTexture(spec) {
  const W = 2048, Hc = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = Hc;
  const g = c.getContext('2d');
  // v = z/H, canvas y is flipped (v=1 at top)
  const vy = (v) => (1 - v) * Hc;
  const H = spec.H;
  const vBody0 = (0.33 * spec.R + 3) / H, vBody1 = (H - 22) / H;
  // bare aluminium
  const al = g.createLinearGradient(0, 0, 0, Hc);
  al.addColorStop(0, '#d9dde1'); al.addColorStop(1, '#c9ced3');
  g.fillStyle = al; g.fillRect(0, 0, W, Hc);
  // printed body: pearl-white base, navy wordmark, orange crush band
  const y0 = vy(vBody1), y1 = vy(vBody0), hh = y1 - y0;
  g.fillStyle = '#eef1f3'; g.fillRect(0, y0, W, hh);
  g.fillStyle = '#123a5a'; g.fillRect(0, y0 + hh * 0.70, W, hh * 0.30);
  g.fillStyle = '#e0561c'; g.fillRect(0, y0 + hh * 0.62, W, hh * 0.08);
  // diagonal test stripes near the shoulder
  g.save();
  g.beginPath(); g.rect(0, y0 + hh * 0.03, W, hh * 0.06); g.clip();
  g.fillStyle = '#123a5a';
  for (let x = -100; x < W + 100; x += 56) {
    g.beginPath(); g.moveTo(x, y0); g.lineTo(x + 26, y0); g.lineTo(x + 86, y1); g.lineTo(x + 60, y1); g.fill();
  }
  g.restore();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const fs = Math.round(hh * 0.24);
  g.fillStyle = '#123a5a';
  g.font = `700 ${fs}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  for (const cx of [W * 0.25, W * 0.75]) g.fillText('CRUSH LAB', cx, y0 + hh * 0.36);
  g.fillStyle = '#ffffff';
  g.font = `600 ${Math.round(fs * 0.3)}px "IBM Plex Mono", monospace`;
  for (const cx of [W * 0.25, W * 0.75]) g.fillText('TEST SPECIMEN · EMPTY · 3104-H19', cx, y0 + hh * 0.80);
  g.font = `500 ${Math.round(fs * 0.24)}px "IBM Plex Mono", monospace`;
  for (const cx of [W * 0.25, W * 0.75]) g.fillText('ALUMINUM · RECYCLE ME', cx, y0 + hh * 0.91);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// strain colour ramp: aluminium grey -> amber -> deep red
const RAMP = [
  [0.0, [0.78, 0.80, 0.83]],
  [0.15, [0.96, 0.78, 0.38]],
  [0.45, [0.92, 0.42, 0.16]],
  [1.0, [0.55, 0.06, 0.08]],
];
function rampColor(u, out, o) {
  u = Math.max(0, Math.min(1, u));
  for (let k = 1; k < RAMP.length; k++) {
    if (u <= RAMP[k][0]) {
      const a = RAMP[k - 1], b = RAMP[k];
      const t = (u - a[0]) / (b[0] - a[0]);
      out[o] = a[1][0] + (b[1][0] - a[1][0]) * t;
      out[o + 1] = a[1][1] + (b[1][1] - a[1][1]) * t;
      out[o + 2] = a[1][2] + (b[1][2] - a[1][2]) * t;
      return;
    }
  }
}
export const STRAIN_MAX = 0.08; // colour scale: 0 .. 8 % plastic strain
export function strainRampCss(n = 6) {
  const stops = [];
  const c = [0, 0, 0];
  for (let i = 0; i <= n; i++) {
    rampColor(i / n, c, 0);
    stops.push(`rgb(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0}) ${(i / n) * 100}%`);
  }
  return `linear-gradient(90deg, ${stops.join(',')})`;
}

// ---------------------------------------------------------------------------
export class CrushView {
  constructor(container) {
    this.container = container;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false }));
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);
    renderer.domElement.className = 'gl';

    const scene = (this.scene = new THREE.Scene());
    const camera = (this.camera = new THREE.PerspectiveCamera(32, 1, 5, 5000));
    this.orbit = new Orbit(camera, renderer.domElement, () => this.requestRender());

    // environment for metallic reflections (procedural studio)
    const envScene = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
    const cols = [];
    const pa = sky.geometry.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i) / 500;
      const t = (y + 1) / 2;
      cols.push(0.42 + 0.58 * t, 0.44 + 0.56 * t, 0.47 + 0.53 * t);
    }
    sky.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    envScene.add(sky);
    const panel = (w, h, x, y, z, ry, intensity) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m);
    };
    panel(300, 120, 0, 350, 150, 0, 4.0);
    panel(200, 300, -380, 80, 0, 0, 2.4);
    panel(200, 300, 380, 60, -80, 0, 1.8);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x6a7076, 0.9);
    scene.add(hemi);
    const key = (this.key = new THREE.DirectionalLight(0xffffff, 1.6));
    key.position.set(160, 320, 220);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160; sc.near = 50; sc.far = 900;
    key.shadow.bias = -0.0004;
    scene.add(key);

    // anvil (bed plate)
    const steel = (this.steelMat = new THREE.MeshStandardMaterial({ color: 0x8a9299, metalness: 0.6, roughness: 0.5 }));
    const bed = new THREE.Mesh(new THREE.BoxGeometry(260, 18, 260), steel);
    bed.position.y = -9;
    bed.receiveShadow = true;
    scene.add(bed);
    const grid = new THREE.GridHelper(260, 26, 0x8a939b, 0x737b82);
    grid.position.y = 0.05;
    grid.material.transparent = true; grid.material.opacity = 0.35;
    scene.add(grid);
    this.bed = bed;

    this.toolGroup = new THREE.Group();
    scene.add(this.toolGroup);
    this.toolMat = new THREE.MeshStandardMaterial({ color: 0xb8c0c7, metalness: 0.7, roughness: 0.32 });
    this.ramMat = new THREE.MeshStandardMaterial({ color: 0x6b737a, metalness: 0.6, roughness: 0.45 });

    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this.colorMode = 'paint';
    this.cutaway = false;
    this._needsRender = true;

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
    const loop = () => {
      if (this._needsRender) { this._needsRender = false; this.renderer.render(this.scene, this.camera); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  requestRender() { this._needsRender = true; }

  setBackground(css) {
    this.scene.background = new THREE.Color(css);
    this.requestRender();
  }

  resize() {
    const w = this.container.clientWidth || 300, h = this.container.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** Build the can geometry from the simulation topology. */
  setCan(mesh, spec, info) {
    if (this.canGroup) {
      this.scene.remove(this.canGroup);
      this.canGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    const { tris, uv, positions } = mesh;
    const nNodes = positions.length / 3;
    // duplicate vertices along the texture seam (u wraps 1 -> 0)
    const src = [];
    for (let i = 0; i < nNodes; i++) src.push(i);
    const uvs = Array.from(uv);
    const dup = new Map();
    const idx = new Uint32Array(tris.length);
    for (let t = 0; t < tris.length; t += 3) {
      const us = [uv[2 * tris[t]], uv[2 * tris[t + 1]], uv[2 * tris[t + 2]]];
      const wrap = Math.max(...us) - Math.min(...us) > 0.5;
      for (let k = 0; k < 3; k++) {
        let vi = tris[t + k];
        if (wrap && us[k] < 0.5) {
          if (!dup.has(vi)) {
            dup.set(vi, src.length);
            src.push(vi);
            uvs.push(uv[2 * vi] + 1, uv[2 * vi + 1]);
          }
          vi = dup.get(vi);
        }
        idx[t + k] = vi;
      }
    }
    this.src = Int32Array.from(src);
    const nv = src.length;
    const geom = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(3 * nv), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(3 * nv), 3);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', this.posAttr);
    geom.setAttribute('color', this.colAttr);
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geom = geom;

    if (!this.labelTex || this._labelFor !== spec.label) {
      this.labelTex = makeLabelTexture(spec);
      this._labelFor = spec.label;
    }
    this.paintMat = new THREE.MeshStandardMaterial({ map: this.labelTex, metalness: 0.62, roughness: 0.3, side: THREE.FrontSide });
    this.strainMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.45, side: THREE.FrontSide });
    this.innerMat = new THREE.MeshStandardMaterial({ color: 0xb9bfc5, metalness: 0.5, roughness: 0.5, side: THREE.BackSide });
    for (const m of [this.paintMat, this.strainMat, this.innerMat]) m.clippingPlanes = this.cutaway ? [this.clipPlane] : [];

    const group = new THREE.Group();
    this.outer = new THREE.Mesh(geom, this.colorMode === 'strain' ? this.strainMat : this.paintMat);
    this.outer.castShadow = true;
    this.outer.receiveShadow = true;
    this.inner = new THREE.Mesh(geom, this.innerMat);
    group.add(this.outer, this.inner);
    this.canGroup = group;
    this.scene.add(group);
    this.updateCan(positions, null);

    // frame the camera on first build or when the can changes size/orientation
    const box = new THREE.Box3().setFromBufferAttribute(this.posAttr);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const key = `${info.axis.map((v) => v.toFixed(2)).join()}|${spec.H}`;
    if (this._frameKey !== key) {
      this._frameKey = key;
      this.orbit.set(new THREE.Vector3(0, c.y + 6, 0), size * 3.0, 0.62, 1.22);
    }
    this.requestRender();
  }

  updateCan(positions, strain) {
    if (!this.posAttr) return;
    const p = this.posAttr.array, src = this.src;
    for (let k = 0; k < src.length; k++) {
      const i = 3 * src[k];
      p[3 * k] = positions[i]; p[3 * k + 1] = positions[i + 1]; p[3 * k + 2] = positions[i + 2];
    }
    this.posAttr.needsUpdate = true;
    this.geom.computeVertexNormals();
    this.geom.computeBoundingSphere();
    if (strain) this._lastStrain = strain;
    if (this.colorMode === 'strain') this._applyStrain();
    this.requestRender();
  }

  _applyStrain() {
    const s = this._lastStrain;
    const c = this.colAttr.array, src = this.src;
    for (let k = 0; k < src.length; k++) rampColor(s ? s[src[k]] / STRAIN_MAX : 0, c, 3 * k);
    this.colAttr.needsUpdate = true;
  }

  setColorMode(mode) {
    this.colorMode = mode;
    if (this.outer) {
      this.outer.material = mode === 'strain' ? this.strainMat : this.paintMat;
      if (mode === 'strain') this._applyStrain();
    }
    this.requestRender();
  }

  setCutaway(on) {
    this.cutaway = on;
    for (const m of [this.paintMat, this.strainMat, this.innerMat]) if (m) m.clippingPlanes = on ? [this.clipPlane] : [];
    this.requestRender();
  }

  /** Build the crusher geometry (tool description in metres, as from the solver). */
  setTool(tool, pos) {
    const g = this.toolGroup;
    while (g.children.length) {
      const o = g.children.pop();
      o.geometry && o.geometry.dispose();
    }
    let body;
    let top = 20;
    this.hinge = null;
    g.rotation.set(0, 0, 0);
    if (tool.kind === 'hinge') {
      // clamshell jaw: a pivot group at the hinge line, the plate extending along +z
      const w = tool.width * 1000, L = tool.length * 1000, t = tool.thickness * 1000;
      const piv = new THREE.Group();
      const plate = new THREE.Mesh(new THREE.BoxGeometry(w, t, L), this.toolMat);
      plate.position.set(0, t / 2, L / 2);
      plate.castShadow = true; plate.receiveShadow = true;
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, w + 30, 24), this.ramMat);
      pin.rotation.z = Math.PI / 2;
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 260, 20), this.ramMat);
      handle.rotation.x = Math.PI / 2; handle.position.set(0, t + 8, L + 120);
      piv.add(plate, pin, handle);
      piv.rotation.x = -(tool.phi || 0);
      g.add(piv);
      g.position.set(pos.x, tool.pivotY * 1000, tool.pivotZ * 1000);
      this.hinge = piv;
      this.requestRender();
      return;
    }
    if (tool.kind === 'profile') {
      // extrude the face profile (along z) across the platen width (x)
      const w = tool.width * 1000, hz = (tool.length * 1000) / 2, t = tool.thickness * 1000;
      const R = tool.radius * 1000, ta = Math.tan((tool.angleDeg * Math.PI) / 180);
      const yb = (z) => {
        switch (tool.profile) {
          case 'convex': return R - Math.sqrt(R * R - z * z);
          case 'concave': return Math.sqrt(R * R - z * z) - Math.sqrt(R * R - hz * hz);
          case 'roof': return Math.abs(z) * ta;
          case 'valley': return (hz - Math.abs(z)) * ta;
          case 'tilt': return (z + hz) * ta;
          default: return 0;
        }
      };
      let ymax = 0;
      const shape = new THREE.Shape();
      const n = 48;
      for (let i = 0; i <= n; i++) {
        const z = -hz + (2 * hz * i) / n, y = yb(z);
        ymax = Math.max(ymax, y);
        if (i === 0) shape.moveTo(z, y); else shape.lineTo(z, y);
      }
      shape.lineTo(hz, ymax + t); shape.lineTo(-hz, ymax + t); shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
      geo.rotateY(-Math.PI / 2);
      geo.translate(w / 2, 0, 0);
      body = new THREE.Mesh(geo, this.toolMat);
      top = ymax + t;
    } else if (tool.kind === 'plate') {
      const w = tool.width * 1000, l = tool.length * 1000, t = tool.thickness * 1000;
      body = new THREE.Mesh(new THREE.BoxGeometry(w, t, l), this.toolMat);
      body.position.y = t / 2;
      top = t;
    } else if (tool.kind === 'bar') {
      const r = (tool.diameter * 1000) / 2, L = tool.length * 1000;
      body = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.1, L - 2 * r), 8, 32), this.toolMat);
      body.rotation.z = Math.PI / 2;
      body.position.y = r;
      top = 2 * r;
    } else {
      const R = (tool.diameter * 1000) / 2, h = tool.height * 1000;
      body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, h, 64), this.toolMat);
      body.position.y = h / 2;
      top = h;
    }
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    // ram (press rod) above the tool
    const rr = tool.ramDiameter !== undefined ? (tool.ramDiameter * 1000) / 2 : 9;
    if (rr > 0) {
      const ram = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, 400, 32), this.ramMat);
      ram.position.y = top + 200;
      ram.castShadow = true;
      g.add(ram);
    } else if (tool.kind === 'plate' || tool.kind === 'bar') {
      // driven from its ends: two posts at the far ends of the plate / bar
      const halfX = tool.kind === 'plate' ? (tool.width * 1000) / 2 - 6 : (tool.length * 1000) / 2 - 6;
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 400, 24), this.ramMat);
        post.position.set(sx * halfX, top + 200, 0);
        post.castShadow = true;
        g.add(post);
      }
    }
    g.rotation.y = tool.yaw || 0;
    g.position.set(pos.x, pos.y, pos.z);
    this.requestRender();
  }

  /** Show/hide the pre-dent ball and backstop (positions in mm). */
  setAux(aux) {
    if (!this.auxGroup) {
      this.auxGroup = new THREE.Group();
      this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.toolMat);
      this.ball.castShadow = true;
      this.ballRod = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 60, 16), this.ramMat);
      this.backstopMesh = new THREE.Mesh(new THREE.BoxGeometry(6, 110, 90), new THREE.MeshStandardMaterial({ color: 0x8a9299, metalness: 0.5, roughness: 0.5, transparent: true, opacity: 0.55 }));
      this.auxGroup.add(this.ball, this.ballRod, this.backstopMesh);
      this.scene.add(this.auxGroup);
    }
    const on = !!(aux && aux.active);
    this.auxGroup.visible = on;
    if (on) {
      const b = aux.ball;
      this.ball.scale.setScalar(b.d / 2);
      this.ball.position.set(b.x, b.y, b.z);
      if (aux.backstop) {
        const n = new THREE.Vector3(...aux.backstop.n);
        // rod behind the ball, pointing away from the can
        this.ballRod.visible = true;
        this.ballRod.position.set(b.x, b.y, b.z).addScaledVector(n, 30 + b.d / 2);
        this.ballRod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
        this.backstopMesh.visible = true;
        this.backstopMesh.position.set(aux.backstop.x, aux.backstop.y, aux.backstop.z).addScaledVector(n, -3);
        this.backstopMesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), n);
        this.backstopMesh.position.y = 55;
      } else {
        this.ballRod.visible = true;
        this.ballRod.position.set(b.x, b.y + 30 + b.d / 2, b.z);
        this.ballRod.quaternion.identity();
        this.backstopMesh.visible = false;
      }
    }
    this.requestRender();
  }

  setToolY(y, phi) {
    cancelAnimationFrame(this._liftRaf);
    if (this.hinge) this.hinge.rotation.x = -(phi || 0);
    else this.toolGroup.position.y = y;
    this.requestRender();
  }

  /** Animate the crusher up by `dy` mm (after a run) so the crushed can is visible. */
  liftTool(y0, dy) {
    cancelAnimationFrame(this._liftRaf);
    if (this.hinge) {
      const p0 = -this.hinge.rotation.x, t0h = performance.now();
      const stepH = (now) => {
        const u = Math.min(1, (now - t0h) / 900);
        this.hinge.rotation.x = -(p0 + 0.7 * u * u * (3 - 2 * u));
        this.requestRender();
        if (u < 1) this._liftRaf = requestAnimationFrame(stepH);
      };
      this._liftRaf = requestAnimationFrame(stepH);
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const u = Math.min(1, (now - t0) / 900);
      this.toolGroup.position.y = y0 + dy * (u * u * (3 - 2 * u));
      this.requestRender();
      if (u < 1) this._liftRaf = requestAnimationFrame(step);
    };
    this._liftRaf = requestAnimationFrame(step);
  }

  resetView() {
    this._frameKey = null;
    if (this.posAttr) {
      const box = new THREE.Box3().setFromBufferAttribute(this.posAttr);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      this.orbit.set(new THREE.Vector3(0, c.y + 6, 0), size * 3.0, 0.62, 1.22);
    }
  }
}
