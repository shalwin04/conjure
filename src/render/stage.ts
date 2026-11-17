/**
 * A small stage under the creation: a dark disc with a glowing rim and a soft
 * light above. Frames the creation on desktop and grounds it on a real desk in
 * passthrough, so even simple generated shapes read as one designed object.
 */
import { Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PointLight, TorusGeometry } from '@iwsdk/core';

export class Stage {
  readonly root = new Group();
  private rimMat: MeshBasicMaterial;
  private light: PointLight;
  private rimColor = new Color(0x8f9bff);
  private target = new Color(0x8f9bff);

  constructor() {
    this.root.name = 'conjure-stage';
    const disc = new Mesh(
      new CylinderGeometry(0.4, 0.42, 0.012, 64),
      new MeshStandardMaterial({ color: 0x15161f, roughness: 0.6, metalness: 0.2, transparent: true, opacity: 0.85 }),
    );
    disc.position.y = -0.135;
    disc.receiveShadow = true;
    this.rimMat = new MeshBasicMaterial({ color: this.rimColor, transparent: true, opacity: 0.7 });
    const rim = new Mesh(new TorusGeometry(0.41, 0.004, 8, 96), this.rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.128;
    this.light = new PointLight(0xffffff, 1.6, 1.6, 1.5);
    this.light.position.set(0, 0.55, 0.15);
    this.root.add(disc, rim, this.light);
  }

  /** World lighting (day / dusk / night) drives the stage light. */
  setLight(color: Color, intensity: number) {
    this.light.color.copy(color);
    this.light.intensity = 1.6 * intensity;
  }

  /** Tint the rim with the creation's palette. */
  setColor(hex: number) { this.target.set(hex); }

  update(dt: number, time: number) {
    this.rimColor.lerp(this.target, 1 - Math.exp(-Math.min(dt, 1 / 30) * 4));
    this.rimMat.color.copy(this.rimColor);
    this.rimMat.opacity = 0.55 + 0.15 * Math.sin(time * 1.5);
  }
}
