/**
 * Headset captions: a soft panel that floats a little below your gaze and
 * follows lazily, showing the current quest line, who is speaking and what
 * they say (revealed with the voice). The desktop gets the DOM overlay instead.
 */
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, type Object3D, type Quaternion } from '@iwsdk/core';

const W = 1024, H = 360;

export class Caption3D {
  readonly mesh: Mesh;
  private ctx: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private quest = '';
  private speaker = '';
  private words: string[] = [];
  private shown = 0;
  private wordStep = 0.25;
  private lastWord = 0;
  private hideAt = 0;
  private dirty = true;
  private target = new Vector3();
  private fwd = new Vector3();

  constructor() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    this.ctx = c.getContext('2d')!;
    this.tex = new CanvasTexture(c);
    this.mesh = new Mesh(new PlaneGeometry(0.8, 0.8 * (H / W)), new MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false }));
    this.mesh.renderOrder = 20;
    this.mesh.name = 'conjure-caption';
    this.mesh.visible = false;
  }

  setQuest(text: string) { if (text !== this.quest) { this.quest = text; this.dirty = true; } }

  line(speaker: string, text: string, seconds: number, now: number) {
    this.speaker = speaker;
    this.words = text.split(/\s+/).filter(Boolean);
    this.shown = 0;
    this.wordStep = Math.max(0.06, seconds / Math.max(1, this.words.length));
    this.lastWord = now;
    this.hideAt = now + seconds + 4;
    this.dirty = true;
  }

  /** Follow the head lazily; redraw when the text changes. */
  update(now: number, head: Vector3, headQuat: Quaternion, parent: Object3D, visible: boolean) {
    this.mesh.visible = visible && (!!this.quest || now < this.hideAt);
    if (!this.mesh.visible) return;
    while (this.shown < this.words.length && now - this.lastWord >= this.wordStep) { this.shown++; this.lastWord += this.wordStep; this.dirty = true; }
    if (now > this.hideAt && this.words.length) { this.words = []; this.speaker = ''; this.dirty = true; }
    this.fwd.set(0, 0, -1).applyQuaternion(headQuat);
    this.fwd.y = 0; if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1); this.fwd.normalize();
    this.target.copy(head).addScaledVector(this.fwd, 1.1); this.target.y -= 0.32;
    parent.worldToLocal(this.target);
    if (this.mesh.position.distanceToSquared(this.target) > 0.25) this.mesh.position.copy(this.target);
    else this.mesh.position.lerp(this.target, 0.05);
    this.mesh.lookAt(head);
    if (this.dirty) this.draw();
  }

  private draw() {
    this.dirty = false;
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    const hasLine = this.words.length > 0;
    g.fillStyle = 'rgba(16,14,24,0.72)';
    roundRect(g, 8, 8, W - 16, (hasLine ? H : 92) - 16, 36);
    g.fill();
    g.textAlign = 'center';
    let y = 62;
    if (this.quest) {
      g.fillStyle = '#ffd98a'; g.font = '600 34px system-ui, sans-serif';
      g.fillText(this.quest, W / 2, y, W - 80);
      y += 56;
    }
    if (!hasLine) { this.tex.needsUpdate = true; return; }
    if (this.speaker) { g.fillStyle = '#b9f3e4'; g.font = '600 28px system-ui, sans-serif'; g.fillText(this.speaker.toUpperCase(), W / 2, y); y += 50; }
    g.font = '40px system-ui, sans-serif';
    const lines: { words: string[]; start: number }[] = [];
    let cur: string[] = [], start = 0;
    this.words.forEach((w, i) => {
      if (g.measureText([...cur, w].join(' ')).width > W - 110 && cur.length) { lines.push({ words: cur, start }); cur = []; start = i; }
      cur.push(w);
    });
    if (cur.length) lines.push({ words: cur, start });
    for (const l of lines.slice(0, 4)) {
      const full = l.words.join(' ');
      const shownCount = Math.max(0, Math.min(l.words.length, this.shown - l.start));
      const shownText = l.words.slice(0, shownCount).join(' ');
      const x0 = W / 2 - g.measureText(full).width / 2;
      g.textAlign = 'left';
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillText(full, x0, y);
      g.fillStyle = '#ffffff'; g.fillText(shownText, x0, y);
      y += 52;
    }
    this.tex.needsUpdate = true;
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
