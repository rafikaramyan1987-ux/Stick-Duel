import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Theme } from './theme';

/**
 * Renderer, camera and lights. The camera looks at the play plane (z = 0) from the front, a little
 * from above, with a narrow field of view: 2.5D side view with slight depth and parallax.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  width = 1;
  height = 1;
  /** Camera target (centre of the framed box) and half-height of the framed area at z = 0. */
  private cx = 0;
  private cy = 0;
  private halfH = 5;
  private tx = 0;
  private ty = 0;
  private tHalfH = 5;
  private shakeT = 0;
  private shakeAmp = 0;
  /** Extra space for the HUD in CSS px (top, bottom). */
  insetTop = 0;
  insetBottom = 0;
  readonly fov = 30;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.5, 900);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.4);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    const mobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const size = mobile ? 1024 : 2048;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    const sc = this.sun.shadow.camera;
    sc.left = -18;
    sc.right = 18;
    sc.top = 12;
    sc.bottom = -12;
    sc.near = 1;
    sc.far = 80;
    this.scene.add(this.sun, this.sun.target);
    this.resize();
  }

  applyTheme(t: Theme): void {
    this.scene.fog = new THREE.Fog(t.fog, t.fogNear, t.fogFar);
    this.scene.background = new THREE.Color(t.skyBottom);
    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.sun.color.set(t.sun);
    this.sun.intensity = t.sunIntensity;
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.width = w;
    this.height = h;
    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 2 : 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Frames a box (physics coordinates, y down) so it fills the screen minus the HUD insets. */
  frame(x0: number, x1: number, y0: number, y1: number, instant = false): void {
    const usable = Math.max(0.3, 1 - (this.insetTop + this.insetBottom) / this.height);
    const aspect = this.width / this.height;
    const w = x1 - x0;
    const h = y1 - y0;
    // half height of the visible area needed to fit both dimensions
    const halfH = Math.max(h / 2 / usable, w / 2 / aspect);
    // shift the centre so the box sits between the insets
    const offset = ((this.insetTop - this.insetBottom) / this.height) * halfH;
    this.tx = (x0 + x1) / 2;
    this.ty = -(y0 + y1) / 2 + offset;
    this.tHalfH = halfH;
    if (instant) {
      this.cx = this.tx;
      this.cy = this.ty;
      this.halfH = this.tHalfH;
    }
  }

  shake(amount: number, seconds = 0.35): void {
    this.shakeAmp = Math.max(this.shakeAmp * (this.shakeT > 0 ? 1 : 0), amount);
    this.shakeT = Math.max(this.shakeT, seconds);
  }

  update(dt: number, follow = 3): void {
    const k = 1 - Math.exp(-follow * dt);
    this.cx += (this.tx - this.cx) * k;
    this.cy += (this.ty - this.cy) * k;
    this.halfH += (this.tHalfH - this.halfH) * k;
    const dist = this.halfH / Math.tan(THREE.MathUtils.degToRad(this.fov / 2));
    let sx = 0;
    let sy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * clamp(this.shakeT * 3, 0, 1);
      sx = (Math.random() - 0.5) * a;
      sy = (Math.random() - 0.5) * a;
    }
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = dist + 8;
      fog.far = dist + 75;
    }
    const lift = this.halfH * 0.22;
    this.camera.position.set(this.cx + sx, this.cy + lift + sy, dist);
    this.camera.lookAt(this.cx + sx * 0.5, this.cy + sy * 0.5, 0);
    // the sun follows the camera so shadows stay sharp where we look
    this.sun.position.set(this.cx - 9, this.cy + 18, 14);
    this.sun.target.position.set(this.cx, this.cy, 0);
    const half = Math.max(this.halfH * this.camera.aspect, this.halfH) + 3;
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - half) > 0.5) {
      sc.left = -half;
      sc.right = half;
      sc.top = half * 0.8;
      sc.bottom = -half * 0.8;
      sc.updateProjectionMatrix();
    }
  }

  /** Pixel size that a 1 m point sprite has at distance 1 (for the particle shader). */
  pointScale(): number {
    return (this.height * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.fov / 2)));
  }

  /** Screen position (CSS px) of a physics point (y down). */
  toScreen(x: number, y: number, z = 0): { x: number; y: number } {
    const v = new THREE.Vector3(x, -y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  /** Physics point (y down) on the play plane under a screen position (CSS px). */
  toWorld(sx: number, sy: number): { x: number; y: number } {
    const ndc = new THREE.Vector3((sx / this.width) * 2 - 1, 1 - (sy / this.height) * 2, 0.5);
    ndc.unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const t = -this.camera.position.z / dir.z;
    const p = this.camera.position.clone().add(dir.multiplyScalar(t));
    return { x: p.x, y: -p.y };
  }

  /** Metres per CSS pixel on the play plane. */
  metersPerPixel(): number {
    return (this.halfH * 2) / this.height;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
