/**
 * 3D Geometry & Procedural Mesh Engine for BlahBlah.
 *
 * Lightweight, hardware-independent software 3D rasterizer that operates on
 * standard HTML5 Canvas 2D contexts for both live preview and export.
 *
 * Capabilities:
 * - 3D Primitives: Cube/Box, Cylinder, Pyramid, UV Sphere
 * - 3D Euler rotations (Rotation X, Y, Z in degrees)
 * - Directional light calculation (Phong/Lambert diffuse + ambient)
 * - Painter's depth sorting algorithm for correct polygon rendering order
 * - Wireframe, Flat, and Lit (shaded) rendering modes
 */

export const SHAPE_3D_TYPES = ['cube', 'cylinder', 'pyramid', 'sphere'];

export function is3DShape(shapeType) {
  return SHAPE_3D_TYPES.includes(shapeType);
}

// ─── Color Shading ──────────────────────────────────────────────────────────

/**
 * Adjusts a hex color by a lighting multiplier (0 = black, 1 = original, > 1 = highlighted).
 */
export function shadeColor(hex, factor) {
  let c = hex ? String(hex).replace('#', '') : 'ffffff';
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c, 16);
  if (Number.isNaN(num)) return hex;

  const r = Math.min(255, Math.max(0, Math.round(((num >> 16) & 255) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((num >> 8) & 255) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((num & 255) * factor)));

  return `rgb(${r}, ${g}, ${b})`;
}

// ─── 3D Vector & Math Helpers ───────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;

/**
 * Rotates a 3D vertex [x, y, z] by Euler angles rx, ry, rz in degrees.
 */
export function rotateVertex([x, y, z], rxDeg = 0, ryDeg = 0, rzDeg = 0) {
  const rx = rxDeg * DEG2RAD;
  const ry = ryDeg * DEG2RAD;
  const rz = rzDeg * DEG2RAD;

  // Rotation around X (Pitch)
  let y1 = y * Math.cos(rx) - z * Math.sin(rx);
  let z1 = y * Math.sin(rx) + z * Math.cos(rx);
  let x1 = x;

  // Rotation around Y (Yaw)
  let x2 = x1 * Math.cos(ry) + z1 * Math.sin(ry);
  let z2 = -x1 * Math.sin(ry) + z1 * Math.cos(ry);
  let y2 = y1;

  // Rotation around Z (Roll)
  let x3 = x2 * Math.cos(rz) - y2 * Math.sin(rz);
  let y3 = x2 * Math.sin(rz) + y2 * Math.cos(rz);
  let z3 = z2;

  return [x3, y3, z3];
}

/**
 * Calculates the surface normal vector for a polygon face given 3 vertices.
 */
export function calculateNormal(v0, v1, v2) {
  const ax = v1[0] - v0[0];
  const ay = v1[1] - v0[1];
  const az = v1[2] - v0[2];

  const bx = v2[0] - v0[0];
  const by = v2[1] - v0[1];
  const bz = v2[2] - v0[2];

  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;

  const len = Math.hypot(nx, ny, nz) || 1e-6;
  return [nx / len, ny / len, nz / len];
}

// ─── Mesh Generators ────────────────────────────────────────────────────────

/**
 * Creates a Cube / Box mesh with specified width, height, and depth.
 */
export function createCubeMesh(w = 140, h = 140, d = 140) {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;

  const vertices = [
    [-hw, -hh, -hd], // 0: Front-top-left
    [hw, -hh, -hd],  // 1: Front-top-right
    [hw, hh, -hd],   // 2: Front-bottom-right
    [-hw, hh, -hd],  // 3: Front-bottom-left
    [-hw, -hh, hd],  // 4: Back-top-left
    [hw, -hh, hd],   // 5: Back-top-right
    [hw, hh, hd],    // 6: Back-bottom-right
    [-hw, hh, hd],   // 7: Back-bottom-left
  ];

  const faces = [
    [0, 1, 2, 3], // Front
    [5, 4, 7, 6], // Back
    [4, 5, 1, 0], // Top
    [3, 2, 6, 7], // Bottom
    [4, 0, 3, 7], // Left
    [1, 5, 6, 2], // Right
  ];

  return { vertices, faces };
}

/**
 * Creates a Pyramid mesh with square base.
 */
export function createPyramidMesh(w = 140, h = 140, d = 140) {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;

  const vertices = [
    [0, -hh, 0],     // 0: Apex (top)
    [-hw, hh, -hd],  // 1: Base Front-Left
    [hw, hh, -hd],   // 2: Base Front-Right
    [hw, hh, hd],    // 3: Base Back-Right
    [-hw, hh, hd],   // 4: Base Back-Left
  ];

  const faces = [
    [0, 2, 1],       // Front face
    [0, 3, 2],       // Right face
    [0, 4, 3],       // Back face
    [0, 1, 4],       // Left face
    [1, 2, 3, 4],    // Base (bottom)
  ];

  return { vertices, faces };
}

/**
 * Creates a Cylinder mesh with radius, height, and radial segments.
 */
export function createCylinderMesh(radius = 70, height = 140, segments = 16) {
  const vertices = [];
  const hh = height / 2;
  const step = (Math.PI * 2) / segments;

  // Top circle vertices (0 to segments - 1)
  for (let i = 0; i < segments; i++) {
    const angle = i * step;
    vertices.push([Math.cos(angle) * radius, -hh, Math.sin(angle) * radius]);
  }

  // Bottom circle vertices (segments to 2 * segments - 1)
  for (let i = 0; i < segments; i++) {
    const angle = i * step;
    vertices.push([Math.cos(angle) * radius, hh, Math.sin(angle) * radius]);
  }

  const faces = [];

  // Side quads
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    const t0 = i;
    const t1 = next;
    const b0 = i + segments;
    const b1 = next + segments;
    faces.push([t0, t1, b1, b0]);
  }

  // Top cap polygon
  const topCap = [];
  for (let i = segments - 1; i >= 0; i--) topCap.push(i);
  faces.push(topCap);

  // Bottom cap polygon
  const bottomCap = [];
  for (let i = 0; i < segments; i++) bottomCap.push(i + segments);
  faces.push(bottomCap);

  return { vertices, faces };
}

/**
 * Creates a UV Sphere mesh.
 */
export function createSphereMesh(radius = 70, rings = 10, segments = 14) {
  const vertices = [];
  const faces = [];

  // Generate vertices
  for (let r = 0; r <= rings; r++) {
    const theta = (r * Math.PI) / rings;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let s = 0; s <= segments; s++) {
      const phi = (s * 2 * Math.PI) / segments;
      const x = Math.cos(phi) * sinTheta * radius;
      const y = -cosTheta * radius;
      const z = Math.sin(phi) * sinTheta * radius;
      vertices.push([x, y, z]);
    }
  }

  // Generate faces
  const stride = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const first = r * stride + s;
      const second = first + stride;

      if (r === 0) {
        // Top pole triangle
        faces.push([first, second, second + 1]);
      } else if (r === rings - 1) {
        // Bottom pole triangle
        faces.push([first, second, first + 1]);
      } else {
        // Mid-latitude quad
        faces.push([first, second, second + 1, first + 1]);
      }
    }
  }

  return { vertices, faces };
}

// ─── 3D Mesh Rasterizer ─────────────────────────────────────────────────────

/**
 * Renders any 3D mesh into an HTML5 Canvas 2D context.
 *
 * Two projection modes:
 *
 * 1. Standalone (no `matrix`): the mesh is rotated in place and projected with
 *    a local perspective, then drawn centred on the context origin. This is the
 *    mode a 3D primitive uses when it is NOT a 3D layer.
 * 2. Camera (`matrix` given): `matrix` is the layer's camera-space model-view
 *    matrix (project3DLayer().camMatrix) and the mesh is projected through the
 *    scene camera into frame pixels. This is what a 3D primitive on a 3D layer
 *    uses: the layer's own rotation/scale/position, the parent chain and the
 *    camera are all already in the matrix, so the mesh never races the preview's
 *    CSS projection (which used to apply perspective a second time on top).
 *
 * @param {CanvasRenderingContext2D} ctx Target 2D rendering context
 * @param {Object} mesh { vertices: Array<[x,y,z]>, faces: Array<Array<number>> }
 * @param {Object} options Rendering options (rotations, shading, color, focal length, camera matrix)
 */
export function renderMesh3D(ctx, mesh, {
  x = 0,
  y = 0,
  rotationX = 0,
  rotationY = 0,
  rotationZ = 0,
  scaleX = 1,
  scaleY = 1,
  scaleZ = 1,
  color = '#38bdf8',
  strokeColor = '#0284c7',
  strokeWidth = 1,
  shading = 'lit', // 'lit' | 'flat' | 'wireframe'
  lightDir = null,
  ambient = 0.35,
  diffuse = 0.65,
  focalLength = 1000,
  matrix = null,
  viewport = null,
  near = 1,
  far = Infinity,
  viewMatrix = null,
} = {}) {
  if (!mesh || !mesh.vertices || !mesh.faces || !ctx) return;

  // Default key light, in world space. In camera mode it is rotated into camera
  // space below so the shading stays identical to the old world-space
  // calculation as the camera moves — otherwise every orbit would relight the
  // mesh.
  const DEFAULT_LIGHT = [0.4, -0.6, -0.7];
  let worldLight = lightDir || DEFAULT_LIGHT;
  if (!lightDir && matrix && viewMatrix) {
    worldLight = [
      viewMatrix[0] * DEFAULT_LIGHT[0] + viewMatrix[4] * DEFAULT_LIGHT[1] + viewMatrix[8] * DEFAULT_LIGHT[2],
      viewMatrix[1] * DEFAULT_LIGHT[0] + viewMatrix[5] * DEFAULT_LIGHT[1] + viewMatrix[9] * DEFAULT_LIGHT[2],
      viewMatrix[2] * DEFAULT_LIGHT[0] + viewMatrix[6] * DEFAULT_LIGHT[1] + viewMatrix[10] * DEFAULT_LIGHT[2],
    ];
  }

  // Normalize light direction vector
  const lightLen = Math.hypot(...worldLight) || 1;
  const lx = worldLight[0] / lightLen;
  const ly = worldLight[1] / lightLen;
  const lz = worldLight[2] / lightLen;

  // 1. Transform all vertices. Scale and the shape's own rotation happen in the
  // mesh's local space first; then either translate into the standalone view
  // space or push through the layer's camera-space matrix.
  const localVerts = mesh.vertices.map((v) => {
    const sx = v[0] * scaleX;
    const sy = v[1] * scaleY;
    const sz = v[2] * scaleZ;
    return rotateVertex([sx, sy, sz], rotationX, rotationY, rotationZ);
  });

  const transformed = matrix
    ? localVerts.map(([vx, vy, vz]) => [
        matrix[0] * vx + matrix[4] * vy + matrix[8] * vz + matrix[12],
        matrix[1] * vx + matrix[5] * vy + matrix[9] * vz + matrix[13],
        matrix[2] * vx + matrix[6] * vy + matrix[10] * vz + matrix[14],
      ])
    : localVerts.map(([rx, ry, rz]) => [rx + x, ry + y, rz]);

  // 2. Project vertices to 2D screen coordinates with perspective. In camera
  // mode this is the scene camera's projection, so screen coordinates are frame
  // pixels; otherwise they are offsets from the context origin.
  const vpW = viewport?.width || 1920;
  const vpH = viewport?.height || 1080;
  const projectVertex = ([vx, vy, vz]) => {
    if (matrix) {
      const z = vz > 1e-6 ? vz : 1e-6;
      const factor = focalLength / z;
      return [vx * factor + vpW / 2, vy * factor + vpH / 2];
    }
    const dist = focalLength + vz;
    const factor = dist > 1 ? focalLength / dist : 1;
    return [vx * factor, vy * factor];
  };
  const projected = transformed.map((v) => [...projectVertex(v), v[2]]);

  // 3. Compute face depth and normals for Painter's sorting and lighting.
  // In camera mode the depth is camera-space Z, which is what the projection
  // actually divides by — a face is dropped when any of its vertices is on the
  // wrong side of a clip plane rather than when the whole shape's centre is.
  const sortedFaces = mesh.faces.map((indices) => {
    let avgZ = 0;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const idx of indices) {
      const vz = transformed[idx][2];
      avgZ += vz;
      if (vz < minZ) minZ = vz;
      if (vz > maxZ) maxZ = vz;
    }
    avgZ /= indices.length;

    // Normal computed from first 3 vertices of transformed face
    const v0 = transformed[indices[0]];
    const v1 = transformed[indices[1]];
    const v2 = transformed[indices[2]];
    const normal = calculateNormal(v0, v1, v2);

    // Fully outside a clip plane: nothing to draw. Faces that only cross one
    // are clipped per-vertex at draw time instead of vanishing whole.
    const outside = Boolean(matrix) && (maxZ <= near || minZ >= far);
    return { indices, avgZ, normal, outside };
  });

  // Sort faces from back to front (Painter's algorithm: highest Z rendered first)
  sortedFaces.sort((a, b) => b.avgZ - a.avgZ);

  ctx.save();

  // 4. Render faces
  for (const { indices, normal, outside } of sortedFaces) {
    if (outside) continue;
    if (indices.length < 3) continue;

    // Dot product for diffuse lighting
    const dot = Math.max(0, normal[0] * lx + normal[1] * ly + normal[2] * lz);
    const intensity = shading === 'lit' ? Math.min(1.0, ambient + diffuse * dot) : 1.0;
    const faceFill = shading === 'lit' ? shadeColor(color, intensity) : color;

    // In camera mode, clip the face polygon against the camera planes in
    // camera space and project the survivors, so a face that crosses the near
    // plane is cut at the plane rather than dropped.
    let screenPoints;
    if (matrix) {
      const camFace = indices.map((idx) => {
        const [x, y, z] = transformed[idx];
        return { x, y, z };
      });
      const facing = clipFaceToPlanes(camFace, near, far);
      if (facing.length < 3) continue;
      screenPoints = facing.map((p) => projectVertex([p.x, p.y, p.z]));
    } else {
      screenPoints = indices.map((idx) => projected[idx]);
    }

    ctx.beginPath();
    ctx.moveTo(screenPoints[0][0], screenPoints[0][1]);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i][0], screenPoints[i][1]);
    }
    ctx.closePath();

    if (shading !== 'wireframe') {
      ctx.fillStyle = faceFill;
      ctx.fill();
    }

    if (strokeWidth > 0 || shading === 'wireframe') {
      ctx.strokeStyle = strokeColor || shadeColor(color, 0.7);
      ctx.lineWidth = strokeWidth || 1;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Sutherland-Hodgman clip of a face polygon against the near and far planes in
 * camera space. No texture coordinates to carry — meshes are flat shaded.
 */
function clipFaceToPlanes(vertices, near, far) {
  let poly = vertices;
  if (Number.isFinite(far)) {
    poly = clipFaceAgainst(poly, (p) => p.z < far, far);
  }
  poly = clipFaceAgainst(poly, (p) => p.z > near, near);
  return poly;
}

function clipFaceAgainst(poly, isInside, planeZ) {
  if (poly.length === 0) return poly;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const aIn = isInside(a);
    const bIn = isInside(b);
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const dz = b.z - a.z;
      const t = Math.abs(dz) < 1e-9 ? 0 : (planeZ - a.z) / dz;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: planeZ,
      });
    }
  }
  return out;
}

// ─── Primitive Convenience Helpers ──────────────────────────────────────────

export function drawCube3D(ctx, options = {}) {
  const { width = 140, height = 140, depth = 140 } = options;
  const mesh = createCubeMesh(width, height, depth);
  renderMesh3D(ctx, mesh, options);
}

export function drawPyramid3D(ctx, options = {}) {
  const { width = 140, height = 140, depth = 140 } = options;
  const mesh = createPyramidMesh(width, height, depth);
  renderMesh3D(ctx, mesh, options);
}

export function drawCylinder3D(ctx, options = {}) {
  const { width = 140, height = 140, segments = 16 } = options;
  const radius = width / 2;
  const mesh = createCylinderMesh(radius, height, segments);
  renderMesh3D(ctx, mesh, options);
}

export function drawSphere3D(ctx, options = {}) {
  const { width = 140, rings = 10, segments = 14 } = options;
  const radius = width / 2;
  const mesh = createSphereMesh(radius, rings, segments);
  renderMesh3D(ctx, mesh, options);
}

/**
 * High-level 3D shape renderer for BlahBlah entities.
 */
export function drawShape3D(ctx, shapeComp, transform = {}) {
  if (!ctx || !shapeComp) return;

  const shapeType = shapeComp.shapeType || 'cube';
  const width = shapeComp.width || 140;
  const height = shapeComp.height || 140;
  const depth = shapeComp.depth || width || 140;

  const tf = transform || {};
  const options = {
    x: 0,
    y: 0,
    rotationX: (tf.rotationX || 0) + (shapeComp.rotationX || 0),
    rotationY: (tf.rotationY || 0) + (shapeComp.rotationY || 0),
    rotationZ: (tf.rotation || 0) + (shapeComp.rotationZ || 0),
    scaleX: tf.scaleX ?? 1,
    scaleY: tf.scaleY ?? 1,
    scaleZ: tf.scaleZ ?? 1,
    color: shapeComp.color || '#38bdf8',
    strokeColor: shapeComp.strokeColor || '#0284c7',
    strokeWidth: shapeComp.strokeWidth ?? 1,
    shading: shapeComp.shading || 'lit',
    focalLength: tf.focalLength || shapeComp.focalLength || 500,
    lightDir: tf.lightDir || shapeComp.lightDir,
    // Camera mode: the layer's camera-space matrix (project3DLayer().camMatrix).
    // When present the mesh is projected by the scene camera instead of the
    // local one, which is what keeps the export identical to the preview.
    matrix: tf.matrix || null,
    viewport: tf.viewport || null,
    near: tf.near ?? 1,
    far: tf.far ?? Infinity,
    viewMatrix: tf.viewMatrix || null,
    width,
    height,
    depth,
  };

  switch (shapeType) {
    case 'cube':
      drawCube3D(ctx, options);
      break;
    case 'pyramid':
      drawPyramid3D(ctx, options);
      break;
    case 'cylinder':
      drawCylinder3D(ctx, options);
      break;
    case 'sphere':
      drawSphere3D(ctx, options);
      break;
    default:
      drawCube3D(ctx, options);
      break;
  }
}
