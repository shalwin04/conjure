/**
 * Render a still of the creation from a fixed, flattering three-quarter view
 * into an offscreen target and return it as a JPEG data URL for the Critic.
 * Independent of where the user is looking; UI (orb, ghosts) is hidden.
 */
import { Color, PerspectiveCamera, SRGBColorSpace, Vector3, WebGLRenderTarget } from '@iwsdk/core';
import type { Object3D, Scene, WebGLRenderer } from '@iwsdk/core';

export function snapshotCreation(renderer: WebGLRenderer, scene: Scene, anchor: Object3D, hide: Object3D[], size = 512): string {
  anchor.updateWorldMatrix(true, false);
  const cam = new PerspectiveCamera(38, 1, 0.01, 10);
  cam.position.set(0.12, 0.42, 0.8).applyMatrix4(anchor.matrixWorld);
  cam.lookAt(new Vector3(0, 0.12, -0.06).applyMatrix4(anchor.matrixWorld));
  cam.updateMatrixWorld();

  const rt = new WebGLRenderTarget(size, size);
  rt.texture.colorSpace = SRGBColorSpace;
  const prev = { target: renderer.getRenderTarget(), xr: renderer.xr.enabled, bg: scene.background };
  const visible = hide.map((o) => o.visible);
  hide.forEach((o) => { o.visible = false; });
  try {
    renderer.xr.enabled = false;
    scene.background = new Color(0x1b1d26);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    const px = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const row = size * 4;
    for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * row, (size - y) * row), y * row); // flip
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    renderer.setRenderTarget(prev.target);
    renderer.xr.enabled = prev.xr;
    scene.background = prev.bg;
    hide.forEach((o, i) => { o.visible = visible[i]; });
    rt.dispose();
  }
}
