/**
 * The Conjurer orb: the visible face of the agent. Idle it breathes; while
 * the agent works it swirls faster and changes colour by stage, a floating
 * label shows the stage, a live timer and narration, and placeholder ghosts
 * mark where each planned group will appear. Waiting becomes the show.
 */
import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, EdgesGeometry, Group, LineBasicMaterial,
  LineSegments, Mesh, MeshBasicMaterial, PlaneGeometry, SphereGeometry,
} from '@iwsdk/core';
import type { PlanGroupView, Stage } from '../spec/protocol.js';

const STAGE_COLOR: Record<Stage | 'idle', number> = {
  idle: 0x8f9bff, routing: 0x8f9bff, researching: 0x5cc8ff, designing: 0xc77dff, editing: 0x7fd1ff,
  testing: 0x7ff6c8, fixing: 0xffc46b, critiquing: 0xff9ad5, ready: 0x7ff6a0, error: 0xff5c6c,
};
const STAGE_TEXT: Record<Stage, string> = {
  routing: 'Listening', researching: 'Researching', designing: 'Designing', editing: 'Editing', testing: 'Testing',
  fixing: 'Fixing', critiquing: 'Critiquing', ready: 'Ready', error: 'Something went wrong',
};
const MOTES = 14;

interface Ghost { id: string; group: Group; fill: MeshBasicMaterial; edges: LineBasicMaterial; fading: number }

export class Orb {
  readonly root = new Group();
  private core: Mesh;
  private coreMat: MeshBasicMaterial;
  private halo: Mesh;
  private haloMat: MeshBasicMaterial;
  private motes: Mesh[] = [];
  private moteMat: MeshBasicMaterial;
  private label: Mesh;
  private labelCanvas: HTMLCanvasElement;
  private labelCtx: CanvasRenderingContext2D;
  private labelTex: CanvasTexture;
  private ghostRoot = new Group();
  private ghosts: Ghost[] = [];

  private busy = false;
  private stage: Stage | 'idle' = 'idle';
  private startedAt = 0;
  private now = 0;
  private spin = 0;
  private headline = 'Conjure';
  private detail = 'Describe something to build';
  private lastLabel = '';
  private color = new Color(STAGE_COLOR.idle);
  private target = new Color(STAGE_COLOR.idle);

  constructor() {
    this.root.name = 'conjure-orb';
    this.root.position.set(0, 0.46, -0.24);

    this.coreMat = new MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.95 });
    this.core = new Mesh(new SphereGeometry(0.03, 32, 20), this.coreMat);
    this.haloMat = new MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false });
    this.halo = new Mesh(new SphereGeometry(0.05, 24, 16), this.haloMat);
    this.moteMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
    const moteGeo = new SphereGeometry(0.004, 8, 6);
    for (let i = 0; i < MOTES; i++) {
      const m = new Mesh(moteGeo, this.moteMat);
      this.motes.push(m);
      this.root.add(m);
    }
    this.root.add(this.core, this.halo);

    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 1024;
    this.labelCanvas.height = 192;
    this.labelCtx = this.labelCanvas.getContext('2d')!;
    this.labelTex = new CanvasTexture(this.labelCanvas);
    this.label = new Mesh(
      new PlaneGeometry(0.5, 0.094),
      new MeshBasicMaterial({ map: this.labelTex, transparent: true, depthWrite: false }),
    );
    this.label.position.set(0, 0.1, 0);
    this.root.add(this.label);
    this.drawLabel();
  }

  /** Ghost placeholders live in creation space, so add this to the anchor too. */
  get ghostsRoot() { return this.ghostRoot; }

  start() {
    this.busy = true;
    this.startedAt = this.now;
    this.setStage('routing');
  }

  setStage(stage: Stage, detail?: string) {
    this.stage = stage;
    this.target.set(STAGE_COLOR[stage]);
    this.headline = STAGE_TEXT[stage];
    if (detail !== undefined) this.detail = detail;
    if (stage === 'ready' || stage === 'error') this.busy = false;
  }

  setDetail(detail: string) { this.detail = detail; }

  finish(headline: string, detail: string, ok = true) {
    this.busy = false;
    this.stage = ok ? 'ready' : 'error';
    this.target.set(STAGE_COLOR[this.stage]);
    this.headline = headline;
    this.detail = detail;
    this.clearGhosts();
  }

  showGhosts(groups: PlanGroupView[]) {
    this.clearGhosts(true);
    for (const g of groups) {
      const size = [g.max[0] - g.min[0], g.max[1] - g.min[1], g.max[2] - g.min[2]].map((v) => Math.max(0.03, v - 0.02));
      const geo = new BoxGeometry(size[0], size[1], size[2]);
      const fill = new MeshBasicMaterial({ color: STAGE_COLOR.designing, transparent: true, opacity: 0.06, depthWrite: false });
      const edges = new LineBasicMaterial({ color: STAGE_COLOR.designing, transparent: true, opacity: 0.5 });
      const group = new Group();
      group.add(new Mesh(geo, fill), new LineSegments(new EdgesGeometry(geo), edges));
      group.position.set((g.min[0] + g.max[0]) / 2, (g.min[1] + g.max[1]) / 2, (g.min[2] + g.max[2]) / 2);
      this.ghostRoot.add(group);
      this.ghosts.push({ id: g.id, group, fill, edges, fading: -1 });
    }
  }

  /** A part arrived: fade out the ghost of the group it belongs to. */
  partArrived(partId: string) {
    const ghost = this.ghosts.find((g) => g.fading < 0 && (partId === g.id || partId.startsWith(`${g.id}-`)));
    if (ghost) ghost.fading = 1;
  }

  clearGhosts(immediate = false) {
    for (const g of this.ghosts) {
      if (immediate) this.disposeGhost(g);
      else if (g.fading < 0) g.fading = 1;
    }
    if (immediate) this.ghosts = [];
  }

  update(dt: number, time: number) {
    this.now = time;
    const step = Math.min(dt, 1 / 30);
    this.color.lerp(this.target, 1 - Math.exp(-step * 6));
    this.coreMat.color.copy(this.color);
    this.haloMat.color.copy(this.color);

    const pulse = this.busy ? 1 + 0.12 * Math.sin(time * 9) : 1 + 0.05 * Math.sin(time * 2);
    this.core.scale.setScalar(pulse);
    this.halo.scale.setScalar(pulse * (this.busy ? 1.25 : 1));
    this.haloMat.opacity = this.busy ? 0.28 : 0.15;

    this.spin += step * (this.busy ? 5 : 0.7);
    const radius = this.busy ? 0.065 : 0.05;
    for (let i = 0; i < MOTES; i++) {
      const a = this.spin + (i / MOTES) * Math.PI * 2;
      const tilt = (i % 2 ? 1 : -1) * 0.5;
      this.motes[i].position.set(Math.cos(a) * radius, Math.sin(a * 2 + i) * 0.012 + Math.sin(a) * tilt * 0.02, Math.sin(a) * radius);
    }
    this.moteMat.opacity = this.busy ? 0.95 : 0.45;

    for (const g of this.ghosts) {
      if (g.fading >= 0) {
        g.fading = Math.max(0, g.fading - step * 3);
        g.fill.opacity = 0.06 * g.fading;
        g.edges.opacity = 0.5 * g.fading;
      } else {
        g.edges.opacity = 0.3 + 0.25 * Math.sin(time * 5);
      }
    }
    const gone = this.ghosts.filter((g) => g.fading === 0);
    if (gone.length) {
      gone.forEach((g) => this.disposeGhost(g));
      this.ghosts = this.ghosts.filter((g) => g.fading !== 0);
    }
    this.drawLabel();
  }

  /** Seconds since the current request started (for the desktop bar too). */
  get elapsed() { return this.busy ? this.now - this.startedAt : 0; }
  get isBusy() { return this.busy; }

  private drawLabel() {
    const timer = this.busy ? ` · ${(this.now - this.startedAt).toFixed(1)}s` : '';
    const text = `${this.headline}${timer}|${this.detail}`;
    if (text === this.lastLabel) return;
    this.lastLabel = text;
    const ctx = this.labelCtx;
    const { width, height } = this.labelCanvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(16,16,26,0.72)';
    roundRect(ctx, 8, 8, width - 16, height - 16, 40);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = `#${this.color.getHexString()}`;
    ctx.font = '600 64px system-ui, sans-serif';
    ctx.fillText(`${this.headline}${timer}`, width / 2, 88);
    ctx.fillStyle = 'rgba(240,240,248,0.85)';
    ctx.font = '44px system-ui, sans-serif';
    ctx.fillText(clip(ctx, this.detail, width - 80), width / 2, 152);
    this.labelTex.needsUpdate = true;
  }

  private disposeGhost(g: Ghost) {
    g.group.traverse((o) => { const m = o as Mesh; m.geometry?.dispose(); });
    g.fill.dispose();
    g.edges.dispose();
    g.group.removeFromParent();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clip(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
