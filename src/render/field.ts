/**
 * Visuals of the endless world, at real-world scale around the user:
 *  - ground: one mesh per chunk, all sampling the same height field (seamless),
 *    with a detail shader (world-space noise, rock on steep slopes);
 *  - grass: instanced blades on grassy ground near the user, swaying in the wind;
 *  - sea: follows the user;
 *  - sky: the physically based Preetham sky (three.js Sky) with clouds, a sun
 *    that moves between day, dusk and night, stars, and matching sun/sky lights.
 */
import {
  AdditiveBlending, BufferGeometry, CircleGeometry, Color, DirectionalLight, DoubleSide, Float32BufferAttribute,
  Group, HemisphereLight, InstancedMesh, MathUtils, Matrix4, Mesh, MeshLambertMaterial, MeshStandardMaterial,
  PlaneGeometry, Points, PointsMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, CanvasTexture, Vector3,
} from '@iwsdk/core';
import { BIOME_LOOK, type BiomeLook } from '../engine/biome.js';
import { ROAD } from '../engine/city.js';
import { TRACK_WIDTH, trackDistance, trackLoop } from '../engine/track.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { CHUNK, chunkCenter, hashString, rng } from '../engine/chunks.js';
import { isDry, terrainHeight, waterLevel, WORLD_BASE_Y, type TerrainT } from '../engine/terrain.js';
import { terrainColour, terrainPalette } from './world.js';

const SEGMENTS = 24;
const GRASS_PER_CHUNK = 4200;

type Light = 'day' | 'dusk' | 'night';
const SUN: Record<Light, { elevation: number; turbidity: number; rayleigh: number; sun: number; sunColor: number; hemi: number; sky: number; ground: number; fog: number; exposure: number }> = {
  day: { elevation: 38, turbidity: 3, rayleigh: 1.3, sun: 1.7, sunColor: 0xfff2dc, hemi: 0.75, sky: 0xbfdcff, ground: 0x5b5040, fog: 0xc9dcef, exposure: 0.62 },
  dusk: { elevation: 3, turbidity: 8, rayleigh: 3, sun: 1.1, sunColor: 0xffa060, hemi: 0.45, sky: 0xffb69a, ground: 0x3d3040, fog: 0xe8a888, exposure: 0.7 },
  night: { elevation: -6, turbidity: 2, rayleigh: 0.6, sun: 0.3, sunColor: 0x9fb4ff, hemi: 0.25, sky: 0x2a3566, ground: 0x111522, fog: 0x141a33, exposure: 0.9 },
};

/** GLSL value noise, shared by the ground and grass shaders. */
const NOISE_GLSL = `
float cjHash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float cjNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(cjHash(i), cjHash(i+vec2(1,0)), u.x), mix(cjHash(i+vec2(0,1)), cjHash(i+vec2(1,1)), u.x), u.y); }`;

export class ChunkField {
  /** Child of the world anchor (world units). */
  readonly root = new Group();
  /** Follows the user at real-world scale (add to the player rig). */
  readonly sky: Group = new Group();
  readonly horizon = new Color();
  exposure = SUN.day.exposure;
  private chunks = new Map<string, Mesh>();
  private grass = new Map<string, InstancedMesh>();
  private material: MeshStandardMaterial;
  private grassMat: MeshLambertMaterial;
  private bladeGeo: BufferGeometry;
  private water: Mesh | null = null;
  private pal: ReturnType<typeof terrainPalette>;
  private skyMesh: Sky;
  private stars: Points;
  private sun: DirectionalLight;
  private hemi: HemisphereLight;
  private uTime = { value: 0 };
  private elevation = SUN.day.elevation;
  private target: Light = 'day';
  private sunDir = new Vector3();
  private snowy: boolean;
  private clumpX = 0;
  private clumpZ = 0;
  private look: BiomeLook;
  private roads = new Map<string, Mesh[]>();
  private roadMat: MeshStandardMaterial | null = null;
  private loop: [number, number][] | null = null;

  constructor(private terrain: TerrainT, accent: number, light: Light, snowy = false, private scale = 40) {
    this.root.name = 'conjure-field';
    const biome = terrain.biome ?? (snowy ? 'snow' : 'meadow');
    this.snowy = snowy || biome === 'snow';
    this.look = BIOME_LOOK[biome];
    this.pal = terrainPalette(accent, biome);
    this.loop = trackLoop(terrain);
    if (this.loop) this.buildTrack(this.loop);
    if (biome === 'city') this.roadMat = new MeshStandardMaterial({ map: asphalt(), roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCjPos;\nvarying vec3 vCjN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCjPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCjN = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vCjPos;\nvarying vec3 vCjN;\n${NOISE_GLSL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float n = cjNoise(vCjPos.xz * 0.35) * 0.45 + cjNoise(vCjPos.xz * 1.7) * 0.35 + cjNoise(vCjPos.xz * 7.0) * 0.2;
          diffuseColor.rgb *= 0.78 + 0.42 * n;
          float slope = 1.0 - clamp(vCjN.y, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.43, 0.41, 0.38) * (0.75 + 0.5 * n), smoothstep(0.3, 0.55, slope));`);
    };

    // Grass blade: unit height, tapering, uv.y = 0 at the root and 1 at the tip.
    this.bladeGeo = new BufferGeometry();
    const bp: number[] = [], buv: number[] = [];
    const rows = 4;
    for (let i = 0; i <= rows; i++) {
      const k = i / rows, w = 0.045 * (1 - k * 0.92);
      bp.push(-w, k, 0, w, k, 0);
      buv.push(0, k, 1, k);
    }
    const bi: number[] = [];
    for (let i = 0; i < rows; i++) { const a = i * 2; bi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.bladeGeo.setAttribute('position', new Float32BufferAttribute(bp, 3));
    this.bladeGeo.setAttribute('uv', new Float32BufferAttribute(buv, 2));
    this.bladeGeo.setIndex(bi);
    this.bladeGeo.computeVertexNormals();
    this.grassMat = new MeshLambertMaterial({ side: DoubleSide });
    this.grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vCjTip;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vCjTip = uv.y;
          vec4 cjRoot = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float cjW = sin(uTime * 1.7 + cjRoot.x * 31.0 + cjRoot.z * 17.0) * 0.6 + sin(uTime * 0.7 + cjRoot.x * 9.0) * 0.4;
          transformed.x += cjW * uv.y * uv.y * 0.28;
          transformed.z += cos(uTime * 1.2 + cjRoot.z * 23.0) * uv.y * uv.y * 0.12;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCjTip;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.35, 1.15, vCjTip);');
    };

    if (terrain.water) {
      this.water = new Mesh(
        new CircleGeometry(4.5, 96).rotateX(-Math.PI / 2),
        new MeshStandardMaterial({ color: 0x1f6f8f, transparent: true, opacity: 0.84, roughness: 0.06, metalness: 0.25, emissive: new Color(0x06263a), emissiveIntensity: 0.4 }),
      );
      this.water.position.y = WORLD_BASE_Y + waterLevel(terrain);
      this.water.renderOrder = 1;
      this.root.add(this.water);
    }

    // Sky, stars and lights live at real scale around the user.
    this.sky.name = 'conjure-sky';
    this.skyMesh = new Sky();
    this.skyMesh.scale.setScalar(160);
    this.skyMesh.renderOrder = -10;
    this.skyMesh.frustumCulled = false;
    const u = this.skyMesh.material.uniforms;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;
    if (u.cloudCoverage) { u.cloudCoverage.value = 0.35; u.cloudDensity.value = 0.45; }
    this.sky.add(this.skyMesh);

    const starPos = new Float32Array(700 * 3);
    const r = rng(7);
    for (let i = 0; i < 700; i++) {
      const th = r() * Math.PI * 2, ph = Math.acos(r() * 0.95);
      starPos.set([Math.sin(ph) * Math.cos(th) * 120, Math.cos(ph) * 120, Math.sin(ph) * Math.sin(th) * 120], i * 3);
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new Float32BufferAttribute(starPos, 3));
    this.stars = new Points(sg, new PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, fog: false }));
    this.stars.frustumCulled = false;
    this.sky.add(this.stars);

    this.sun = new DirectionalLight(0xffffff, 2);
    this.hemi = new HemisphereLight(0xbfdcff, 0x6b5d45, 0.9);
    this.sky.add(this.sun, this.sun.target, this.hemi);
    this.setLight(light, true);
  }

  has(key: string) { return this.chunks.has(key); }
  keys() { return this.chunks.keys(); }

  /** Build the ground of one chunk. */
  add(key: string, ix: number, iz: number) {
    if (this.chunks.has(key)) return;
    const [cx, cz] = chunkCenter(ix, iz);
    const n = SEGMENTS + 1;
    const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
    const c = new Color();
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = cx - CHUNK / 2 + (CHUNK * i) / SEGMENTS;
        const z = cz - CHUNK / 2 + (CHUNK * j) / SEGMENTS;
        const h = terrainHeight(this.terrain, x, z);
        const o = (i * n + j) * 3;
        pos[o] = x; pos[o + 1] = WORLD_BASE_Y + h; pos[o + 2] = z;
        terrainColour(this.pal, this.terrain, h, c);
        if (this.snowy && h > waterLevel(this.terrain) + 0.004) c.lerp(this.pal.snow, 0.75);
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      for (let j = 0; j < SEGMENTS; j++) {
        const a = i * n + j, b = (i + 1) * n + j;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.name = `chunk:${key}`;
    this.root.add(mesh);
    this.chunks.set(key, mesh);
    if (this.roadMat) this.addRoads(key, cx, cz);
  }

  /** The race track: one ribbon draped on the ground, kerbs on both edges, a chequered start line. */
  private buildTrack(pts: [number, number][]) {
    const n = pts.length, w = TRACK_WIDTH / 2;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let v = 0;
    for (let i = 0; i <= n; i++) {
      const [ax, az] = pts[i % n], [bx, bz] = pts[(i + 1) % n], [px, pz] = pts[(i - 1 + n) % n];
      let tx = bx - px, tz = bz - pz;
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      if (i > 0) v += Math.hypot(ax - pts[(i - 1) % n][0], az - pts[(i - 1) % n][1]) / TRACK_WIDTH;
      for (const side of [-1, 1]) {
        const x = ax + -tz * w * side, z = az + tx * w * side;
        pos.push(x, WORLD_BASE_Y + terrainHeight(this.terrain, x, z) + 0.0012, z);
        uv.push(side < 0 ? 0 : 1, v);
      }
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new MeshStandardMaterial({ map: trackTexture(), roughness: 0.85, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new Mesh(geo, mat);
    mesh.name = 'race-track';
    mesh.receiveShadow = true;
    this.root.add(mesh);
    // Start / finish line.
    const [sx, sz] = pts[0], [nx2, nz2] = pts[1];
    const line = new Mesh(new PlaneGeometry(TRACK_WIDTH, TRACK_WIDTH * 0.12).rotateX(-Math.PI / 2), new MeshStandardMaterial({ map: checker(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    line.rotation.y = Math.atan2(nx2 - sx, nz2 - sz);
    line.position.set(sx, WORLD_BASE_Y + terrainHeight(this.terrain, sx, sz) + 0.0016, sz);
    this.root.add(line);
  }

  /** The two streets this chunk owns (its west and north edges), draped on the ground. */
  private addRoads(key: string, cx: number, cz: number) {
    const out: Mesh[] = [];
    for (const dir of ['ns', 'ew'] as const) {
      const segs = 16;
      const geo = new PlaneGeometry(ROAD, CHUNK, 1, segs);
      geo.rotateX(-Math.PI / 2);
      if (dir === 'ew') geo.rotateY(Math.PI / 2);
      const pos = geo.attributes.position;
      const ox = dir === 'ns' ? cx - CHUNK / 2 : cx, oz = dir === 'ns' ? cz : cz - CHUNK / 2;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + ox, z = pos.getZ(i) + oz;
        pos.setXYZ(i, x, WORLD_BASE_Y + terrainHeight(this.terrain, x, z) + (dir === 'ns' ? 0.0006 : 0.0008), z);
      }
      // Repeat the asphalt texture along the street.
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 4);
      geo.computeVertexNormals();
      const m = new Mesh(geo, this.roadMat!);
      m.receiveShadow = true;
      m.name = `road:${key}:${dir}`;
      this.root.add(m);
      out.push(m);
    }
    this.roads.set(key, out);
  }

  remove(key: string) {
    const mesh = this.chunks.get(key);
    if (mesh) { mesh.geometry.dispose(); mesh.removeFromParent(); this.chunks.delete(key); }
    for (const r of this.roads.get(key) ?? []) { r.geometry.dispose(); r.removeFromParent(); }
    this.roads.delete(key);
    this.removeGrass(key);
  }

  /** Grass on the grassy band (not beaches, rock, snow or sea) of a chunk near the user. */
  addGrass(key: string, ix: number, iz: number) {
    const total = Math.round(GRASS_PER_CHUNK * this.look.grassDensity);
    if (this.grass.has(key) || this.snowy || total < 50) return;
    const [cx, cz] = chunkCenter(ix, iz);
    const rand = rng(hashString(`grass:${key}`));
    const city = this.terrain.biome === 'city';
    const mesh = new InstancedMesh(this.bladeGeo, this.grassMat, total);
    const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), up = new Vector3(0, 1, 0);
    const base = new Color(this.look.grassColor), c = new Color();
    let n = 0;
    for (let tries = 0; tries < total * 3 && n < total; tries++) {
      // Clumps look natural: most blades sit near a few clump centres.
      if (n % 12 === 0) { this.clumpX = cx + (rand() - 0.5) * CHUNK; this.clumpZ = cz + (rand() - 0.5) * CHUNK; }
      const x = this.clumpX + (rand() - 0.5) * 0.05, z = this.clumpZ + (rand() - 0.5) * 0.05;
      if (!isDry(this.terrain, x, z, 0.003)) {
        // Clump landed in the sea: move it.
        if (rand() < 0.3) { this.clumpX = cx + (rand() - 0.5) * CHUNK; this.clumpZ = cz + (rand() - 0.5) * CHUNK; }
        continue;
      }
      if (city && roadDist(x, z) < ROAD / 2 + 0.01) continue;
      if (this.loop && Math.abs(x) + Math.abs(z) > this.terrain.radius * 0.8 && trackDistance(this.loop, x, z) < TRACK_WIDTH / 2 + 0.01) continue;
      const h = terrainHeight(this.terrain, x, z);
      if (h > 0.068 || (this.terrain.water && h < waterLevel(this.terrain) + 0.012)) continue;
      p.set(x, WORLD_BASE_Y + h - 0.0005, z);
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      // Real grass height (25-45 cm) whatever the world's scale.
      const k = (0.22 + rand() * 0.2) / this.scale;
      s.set(k, k * (0.8 + rand() * 0.7), k);
      m.compose(p, q, s);
      mesh.setMatrixAt(n, m);
      c.copy(base).offsetHSL((rand() - 0.5) * 0.04, (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.12);
      mesh.setColorAt(n, c);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.grass.set(key, mesh);
  }

  removeGrass(key: string) {
    const g = this.grass.get(key);
    if (!g) return;
    g.removeFromParent();
    g.dispose();
    this.grass.delete(key);
  }

  /** Sky dome and stars (off = see the room around the world); lights stay. */
  setSkyVisible(on: boolean) {
    this.skyMesh.visible = on && this.elevation > -12;
    this.stars.visible = on;
    this.skyOn = on;
  }
  private skyOn = true;

  /** Keep the sea under the user. */
  setFocus(x: number, z: number) {
    this.water?.position.set(x, this.water.position.y, z);
  }

  setLight(light: Light, instant = false) {
    this.target = light;
    if (instant) this.elevation = SUN[light].elevation;
    this.applySun(1);
  }

  update(dt: number, time: number) {
    this.uTime.value = time;
    const goal = SUN[this.target].elevation;
    if (Math.abs(goal - this.elevation) > 0.05) {
      this.elevation += (goal - this.elevation) * (1 - Math.exp(-Math.min(dt, 1 / 30) * 0.8));
      this.applySun(1 - Math.exp(-Math.min(dt, 1 / 30) * 1.5));
    }
    const u = this.skyMesh.material.uniforms;
    if (u.time) u.time.value = time;
    if (this.water) this.water.position.y = WORLD_BASE_Y + waterLevel(this.terrain) + 0.0012 * Math.sin(time * 1.1);
  }

  dispose() {
    for (const key of [...this.chunks.keys()]) this.remove(key);
    for (const key of [...this.grass.keys()]) this.removeGrass(key);
    this.material.dispose();
    this.grassMat.dispose();
    this.bladeGeo.dispose();
    if (this.water) { this.water.geometry.dispose(); (this.water.material as MeshStandardMaterial).dispose(); }
    this.skyMesh.geometry.dispose();
    this.skyMesh.material.dispose();
    this.stars.geometry.dispose();
    (this.stars.material as PointsMaterial).dispose();
    this.sun.dispose();
    this.hemi.dispose();
    this.sky.removeFromParent();
    this.root.removeFromParent();
  }

  private tmpColor = new Color();
  private hazeTmp = new Color();
  private applySun(k: number) {
    const cfg = SUN[this.target];
    const u = this.skyMesh.material.uniforms;
    const phi = MathUtils.degToRad(90 - this.elevation), theta = MathUtils.degToRad(150);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value += (cfg.turbidity + this.look.dust - u.turbidity.value) * k;
    u.rayleigh.value += (cfg.rayleigh - u.rayleigh.value) * k;
    // Night: the "sun" becomes moonlight from above.
    const night = Math.min(1, Math.max(0, -this.elevation / 6));
    this.sun.position.copy(this.sunDir).multiplyScalar(50);
    if (this.elevation < 8) this.sun.position.y = Math.max(this.sun.position.y, 20);
    this.sun.color.lerp(this.tmpColor.set(cfg.sunColor), k);
    this.sun.intensity += (cfg.sun - this.sun.intensity) * k;
    this.hemi.color.lerp(this.tmpColor.set(cfg.sky), k);
    this.hemi.groundColor.lerp(this.tmpColor.set(cfg.ground), k);
    this.hemi.intensity += (cfg.hemi - this.hemi.intensity) * k;
    this.horizon.lerp(this.tmpColor.set(cfg.fog).lerp(this.hazeTmp.set(this.look.hazeColor), this.target === 'night' ? this.look.haze * 0.2 : this.look.haze), k);
    this.exposure += (cfg.exposure - this.exposure) * k;
    (this.stars.material as PointsMaterial).opacity = night * 0.9;
    this.skyMesh.visible = this.skyOn && this.elevation > -12;
  }
}


/** Distance to the nearest street centre line (streets run along chunk edges). */
function roadDist(x: number, z: number) {
  const fx = (((x / CHUNK + 0.5) % 1) + 1) % 1, fz = (((z / CHUNK + 0.5) % 1) + 1) % 1;
  return Math.min(Math.min(fx, 1 - fx), Math.min(fz, 1 - fz)) * CHUNK;
}

let asphaltTex: CanvasTexture | null = null;
/** Asphalt with kerbs, pale sidewalks and a dashed centre line (u across, v along). */
function asphalt() {
  if (asphaltTex) return asphaltTex;
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a4c50';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    const v = 60 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`;
    g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }
  // sidewalks (about 1 m each side) with paving joints, and the kerb
  for (const x0 of [0, W - 22]) {
    g.fillStyle = '#b9b3a8';
    g.fillRect(x0, 0, 22, H);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < H; y += 16) g.fillRect(x0, y, 22, 1);
    g.fillStyle = '#8e8a84';
    g.fillRect(x0 === 0 ? 20 : x0, 0, 2, H);
  }
  // centre dashes and edge lines
  g.fillStyle = '#f2e6b8';
  for (let y = 0; y < H; y += 64) g.fillRect(W / 2 - 1.5, y + 8, 3, 34);
  g.fillStyle = 'rgba(240,240,235,0.6)';
  g.fillRect(27, 0, 1.5, H); g.fillRect(W - 28.5, 0, 1.5, H);
  asphaltTex = new CanvasTexture(c);
  asphaltTex.wrapS = asphaltTex.wrapT = RepeatWrapping;
  asphaltTex.colorSpace = SRGBColorSpace;
  asphaltTex.anisotropy = 8;
  return asphaltTex;
}

let trackTex: CanvasTexture | null = null;
/** Race asphalt (u across, v along): red and white kerbs, white edge lines. */
function trackTexture() {
  if (trackTex) return trackTex;
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3d3f44';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 5000; i++) { const v = 50 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v + 3},0.4)`; g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5); }
  // Darker racing line down the middle.
  g.fillStyle = 'rgba(20,20,22,0.25)';
  g.fillRect(W * 0.35, 0, W * 0.3, H);
  for (const x0 of [0, W - 16]) for (let y = 0; y < H; y += 32) { g.fillStyle = (y / 32) % 2 ? '#f4f4f4' : '#d8232a'; g.fillRect(x0, y, 16, 32); }
  g.fillStyle = '#f4f4f0';
  g.fillRect(19, 0, 3, H); g.fillRect(W - 22, 0, 3, H);
  trackTex = new CanvasTexture(c);
  trackTex.wrapS = trackTex.wrapT = RepeatWrapping;
  trackTex.colorSpace = SRGBColorSpace;
  trackTex.anisotropy = 8;
  return trackTex;
}

let checkerTex: CanvasTexture | null = null;
function checker() {
  if (checkerTex) return checkerTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 16;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 8, y * 8, 8, 8); }
  checkerTex = new CanvasTexture(c);
  checkerTex.colorSpace = SRGBColorSpace;
  return checkerTex;
}
