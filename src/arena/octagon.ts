/**
 * Geometry helper for the octagonal platforms.
 */

import { ExtrudeGeometry, Shape, type Vector2Tuple } from 'three';

/**
 * Build a flat octagon prism (a thin slab) from a clockwise list of outline
 * vertices in the floor plane. The resulting geometry lies in the XZ plane
 * with its top face at y = `thickness` and bottom at y = 0.
 */
export function octagonSlab(vertices: Vector2Tuple[], thickness = 0.08): ExtrudeGeometry {
  const shape = new Shape();
  shape.moveTo(vertices[0][0], vertices[0][1]);
  for (let i = 1; i < vertices.length; i++) {
    shape.lineTo(vertices[i][0], vertices[i][1]);
  }
  shape.closePath();

  const geo = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 2,
  });
  // Shape is authored in XY; rotate so it lies flat in XZ (the floor).
  geo.rotateX(-Math.PI / 2);
  return geo;
}
