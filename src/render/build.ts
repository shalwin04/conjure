/**
 * Builds three.js objects from a Creation spec. The AI never touches geometry
 * or materials directly: it picks shapes, a style and a palette slot, and the
 * presets here decide how that looks.
 */
import {
  BoxGeometry, CapsuleGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group,
  MathUtils, Matrix4, Mesh, MeshPhysicalMaterial, SphereGeometry, TorusGeometry,
} from '@iwsdk/core';
import type { BufferGeometry } from '@iwsdk/core';
import type { CreationT, PartT } from '../spec/schema.js';
import { createZone, setZonePose, type PartZone } from '../engine/verbs.js';
import { resolvePos } from '../engine/transform.js';
import { PALETTE_COLORS } from './palettes.js';
import { blobGeometry, hashSeed, latheGeometry, tubeGeometry } from './geometry.js';
import { buildAsset, type AssetInstance } from './assets.js';
import { assetDims } from '../spec/schema.js';

export interface PartRuntime {
  spec: PartT;
  pivot: Group;
  mesh: Mesh;
  material: MeshPhysicalMaterial;
  zone: PartZone;
  baseEmissive: number;
  /** 0-1, decays after a hit. */
  flash: number;
  /** Spring state for squash on hit. */
  squash: number;
  squashVel: number;
  /** Assembly: seconds until this part appears, then grows in. */
  appearDelay: number;
  appear: number;
  /** Seconds of idle motion (motion field). */
  motionTime: number;
  /** Resolved rest position (worlds: on the ground). */
  base: [number, number, number];
  /** Centre that orbiting parts circle (world origin, or their area's centre). */
  center: [number, number];
  /** Unique id across every creation and area (ray hits). */
  uid: number;
  /** Realistic asset built by the engine (shape kind 'asset'); `mesh` is then an invisible hit proxy. */
  asset: AssetInstance | null;
  /** Reaction timers (seconds remaining). */
  jumpT: number; growT: number; spinT: number;
  placedSoundPlayed: boolean;
}

export interface CreationRuntime {
  spec: CreationT;
  root: Group;
  parts: PartRuntime[];
  zones: PartZone[];
}

function geometryFor(part: PartT): BufferGeometry {
  const s = part.shape;
  switch (s.kind) {
    case 'cylinder': return new CylinderGeometry(s.radius, s.radius, s.height, 40, 1);
    case 'cone': return new ConeGeometry(s.radius, s.height, 32, 1);
    case 'box': return new BoxGeometry(s.size[0], s.size[1], s.size[2], 1, 1, 1);
    case 'sphere': return new SphereGeometry(s.radius, 32, 20);
    case 'torus': return new TorusGeometry(s.radius, s.tube, 16, 40).rotateX(Math.PI / 2);
    case 'capsule': return new CapsuleGeometry(s.radius, s.length, 8, 20);
    case 'lathe': return latheGeometry(s.profile);
    case 'tube': return tubeGeometry(s.length, s.radius, s.taper, s.curl, s.wave);
    case 'blob': return blobGeometry(s.radius, s.lumps, s.squash, hashSeed(part.id));
    case 'frustum': return new CylinderGeometry(s.top, s.bottom, s.height, 40, 1);
    case 'asset': {
      // Invisible proxy for rays and hands: an upright cylinder from the ground up.
      const d = assetDims(s.type, s.size);
      return new CylinderGeometry(d.radius * 0.8, d.radius * 0.8, d.height, 12, 1).translate(0, d.height / 2, 0);
    }
  }
}

function materialFor(creation: CreationT, part: PartT, index: number) {
  const palette = PALETTE_COLORS[creation.palette];
  const slot = part.material?.color ?? (index % 2 === 0 ? 'base' : 'accent');
  const color = new Color(palette[slot]);
  const glow = Math.min(1, Math.max(0, part.material?.glow ?? 0));
  const m = new MeshPhysicalMaterial({ color });
  switch (creation.style) {
    case 'glass':
      m.roughness = 0.08; m.metalness = 0; m.clearcoat = 1; m.clearcoatRoughness = 0.05;
      m.transparent = true; m.opacity = 0.88; m.emissive = color.clone(); m.emissiveIntensity = 0.3 + glow;
      break;
    case 'clay':
      m.roughness = 0.85; m.metalness = 0; m.sheen = 0.6; m.sheenColor = new Color(0xffffff);
      m.emissive = color.clone(); m.emissiveIntensity = 0.15 + glow;
      break;
    case 'neon':
      m.roughness = 0.35; m.metalness = 0; m.emissive = color.clone(); m.emissiveIntensity = 0.7 + glow;
      break;
    case 'wood':
      m.roughness = 0.7; m.metalness = 0; m.clearcoat = 0.4;
      m.emissive = color.clone(); m.emissiveIntensity = 0.1 + glow;
      break;
    case 'metal':
      m.roughness = 0.3; m.metalness = 0.6; m.emissive = color.clone(); m.emissiveIntensity = 0.15 + glow;
      break;
    case 'jelly':
      // translucent, iridescent edges, inner glow (no transmission pass: too costly on Quest)
      m.roughness = 0.15; m.metalness = 0; m.transparent = true; m.opacity = 0.55; m.depthWrite = false;
      m.iridescence = 0.8; m.iridescenceIOR = 1.4; m.sheen = 1; m.sheenColor = color.clone().offsetHSL(0, 0, 0.3);
      m.clearcoat = 1; m.emissive = color.clone(); m.emissiveIntensity = 0.45 + glow;
      break;
    case 'organic':
      m.roughness = 0.55; m.metalness = 0; m.sheen = 1; m.sheenColor = color.clone().offsetHSL(0, -0.1, 0.25);
      m.emissive = color.clone(); m.emissiveIntensity = 0.12 + glow;
      break;
    case 'crystal':
      m.roughness = 0.02; m.metalness = 0.1; m.clearcoat = 1; m.transparent = true; m.opacity = 0.72;
      m.iridescence = 0.35; m.emissive = color.clone(); m.emissiveIntensity = 0.3 + glow;
      break;
    case 'pearl':
      m.roughness = 0.25; m.metalness = 0.05; m.iridescence = 1; m.iridescenceIOR = 1.6; m.sheen = 0.6;
      m.emissive = color.clone(); m.emissiveIntensity = 0.12 + glow;
      break;
  }
  // Open shapes (bells, tubes) and see-through styles must render both sides.
  if (part.shape.kind === 'lathe' || part.shape.kind === 'tube' || m.transparent) m.side = DoubleSide;
  if (part.material?.opacity != null && part.material.opacity < 1) {
    m.transparent = true;
    m.opacity = Math.max(0.15, part.material.opacity);
  }
  return m;
}

let nextUid = 1;

/** Seconds between parts appearing during assembly. */
export const ASSEMBLY_STAGGER = 0.12;

/** An empty creation that parts can be added to, e.g. while they stream in. */
export function createRuntime(header: Omit<CreationT, 'parts'> & { parts?: PartT[] }): CreationRuntime {
  const root = new Group();
  root.name = `creation:${header.id}`;
  return { spec: { ...header, parts: [] }, root, parts: [], zones: [] };
}

/** Add one part. `appearDelay` seconds before it grows in (0 = now, -1 = no animation). */
export function addPart(rt: CreationRuntime, spec: PartT, appearDelay = 0): PartRuntime {
  const i = rt.parts.length;
  const animate = appearDelay >= 0;
  const pivot = new Group();
  pivot.name = `part:${spec.id}`;
  const [x, y, z] = resolvePos(rt.spec, spec);
  pivot.position.set(x, y, z);
  const rot = spec.transform.rot ?? [0, 0, 0];
  pivot.rotation.set(MathUtils.degToRad(rot[0]), MathUtils.degToRad(rot[1]), MathUtils.degToRad(rot[2]));
  const material = materialFor(rt.spec, spec, i);
  const mesh = new Mesh(geometryFor(spec), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  let asset: AssetInstance | null = null;
  if (spec.shape.kind === 'asset') {
    material.transparent = true; material.opacity = 0; material.depthWrite = false; material.colorWrite = false;
    mesh.castShadow = false;
    asset = buildAsset(spec.shape.type, spec.shape.size, hashSeed(spec.id), PALETTE_COLORS[rt.spec.palette], spec.shape.variant ?? 0);
    mesh.add(asset.root);
  }
  mesh.userData.partIndex = i;
  pivot.add(mesh);
  pivot.userData.baseScale = spec.transform.scale ?? 1;
  pivot.scale.setScalar(animate ? 0.0001 : pivot.userData.baseScale);
  rt.root.add(pivot);

  const zone = createZone(spec, i);
  const part: PartRuntime = {
    spec, pivot, mesh, material, zone,
    baseEmissive: material.emissiveIntensity,
    flash: 0, squash: 0, squashVel: 0, motionTime: 0,
    base: [x, y, z], jumpT: 0, growT: 0, spinT: 0, center: [0, 0], uid: nextUid++, asset,
    appearDelay: animate ? appearDelay : 0,
    appear: animate ? 0 : 1,
    placedSoundPlayed: !animate,
  };
  rt.spec.parts.push(spec);
  rt.parts.push(part);
  rt.zones.push(zone);
  return part;
}

export function buildCreation(creation: CreationT, animate = true): CreationRuntime {
  const rt = createRuntime(creation);
  creation.parts.forEach((spec, i) => addPart(rt, spec, animate ? i * ASSEMBLY_STAGGER : -1));
  return rt;
}

export function disposeCreation(rt: CreationRuntime) {
  for (const p of rt.parts) {
    p.asset?.dispose();
    p.mesh.geometry.dispose();
    p.material.dispose();
  }
  rt.root.removeFromParent();
}

const tmpInverse = new Matrix4();

/** Refresh every zone from the parts' current world matrices. */
export function syncZones(rt: CreationRuntime) {
  rt.root.updateWorldMatrix(true, true);
  for (const p of rt.parts) {
    // Zones use the pivot (not the squashing mesh) so hit areas stay stable.
    tmpInverse.copy(p.pivot.matrixWorld).invert();
    setZonePose(p.zone, p.pivot.matrixWorld.elements, tmpInverse.elements);
  }
}

