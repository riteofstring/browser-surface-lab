import * as THREE from "three";
import { mazeTextures } from "./hover-textures";
import {
  barrierHeight,
  cellSize,
  tierHeight,
  wallHeight,
  type Craft,
  type CraftKind,
  type HoverWorld,
  type PodKind,
} from "./hover-world";

// Hover!'s own colours: the player is red, flag seekers blue, hunters green.
const teamColors: Record<CraftKind, number> = {
  player: 0xd8342c,
  seeker: 0x2f6de0,
  hunter: 0x3fae4a,
};
const flagColors = { blue: 0x2f6de0, red: 0xd8342c };
const podColors: Record<PodKind, string> = {
  spring: "#ffd23a",
  barrier: "#ff8a2a",
  cloak: "#9b5cff",
  green: "#3bff6a",
  red: "#ff3b3b",
  shield: "#49e6ff",
  eraser: "#f2f2f2",
  calm: "#4a8bff",
  thief: "#2a2a2a",
  random: "#ff66cc",
};
const lighting = {
  castle: { sky: 1.7, sun: 1.5, fog: [26, 92] },
  city: { sky: 1.0, sun: 0.7, fog: [18, 72] },
  sewer: { sky: 0.9, sun: 0.5, fog: [8, 46] },
} as const;
const rampTurn: Record<string, number> = {
  "^": 0,
  ">": -Math.PI / 2,
  "<": Math.PI / 2,
  v: Math.PI,
};

interface CraftView {
  body: THREE.Group;
  craft: Craft;
  hull: THREE.MeshLambertMaterial;
  shadow: THREE.Mesh;
  shield: THREE.Mesh | null;
}

function shadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(0,0,0,0.6)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function padTexture(color: string, pattern: "chevrons" | "cross") {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#101010";
  context.fillRect(0, 0, 64, 64);
  context.strokeStyle = color;
  context.lineWidth = 6;
  context.strokeRect(4, 4, 56, 56);
  context.beginPath();
  if (pattern === "cross") {
    context.moveTo(16, 16);
    context.lineTo(48, 48);
    context.moveTo(48, 16);
    context.lineTo(16, 48);
  } else
    for (const y of [22, 38]) {
      context.moveTo(16, y + 8);
      context.lineTo(32, y - 6);
      context.lineTo(48, y + 8);
    }
  context.stroke();
  const result = new THREE.CanvasTexture(canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  return result;
}

function rampGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(cellSize, tierHeight, cellSize);
  geometry.translate(0, tierHeight / 2, 0);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index++)
    if (position.getZ(index) > 0 && position.getY(index) > 0.01)
      position.setY(index, 0);
  geometry.computeVertexNormals();
  return geometry;
}

type Arena = HoverWorld["arena"];

/** Visible walls (every ninth with the alternate texture), tiers and ramps. */
function sortCells(arena: Arena) {
  const walls: [number, number][][] = [[], []];
  const tiers: [number, number][] = [];
  const ramps: [number, number, string][] = [];
  const open = (column: number, row: number) =>
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dz]) => !arena.isWall(column + dx!, row + dz!));
  for (let row = 0; row < arena.depth; row++)
    for (let column = 0; column < arena.width; column++) {
      const tile = arena.tile(column, row);
      if (tile === "=") tiers.push([column, row]);
      else if (rampTurn[tile] !== undefined) ramps.push([column, row, tile]);
      else if (tile === "#" && open(column, row))
        walls[(column * 7 + row * 3) % 9 === 0 ? 1 : 0]!.push([column, row]);
    }
  return { walls, tiers, ramps };
}

export function createHoverRenderer(
  world: HoverWorld,
  host: HTMLElement,
  lost: () => void,
) {
  const { arena } = world;
  const { maze } = arena;
  const light = lighting[maze.name as keyof typeof lighting];
  const textures = mazeTextures(maze);
  const scene = new THREE.Scene();
  scene.background = textures.sky;
  scene.fog = new THREE.Fog(maze.look.fog, light.fog[0], light.fog[1]);
  const camera = new THREE.PerspectiveCamera(64, 1, 0.2, 120);
  const mirror = new THREE.PerspectiveCamera(58, 3, 0.2, 60);
  const disposables: { dispose(): void }[] = Object.values(textures);
  const track = <T extends { dispose(): void }>(value: T): T => {
    disposables.push(value);
    return value;
  };

  const sun = new THREE.DirectionalLight(0xffffff, light.sun);
  sun.position.set(-0.5, 1, 0.3);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, light.sky), sun);

  const width = arena.width * cellSize;
  const depth = arena.depth * cellSize;
  textures.floor.repeat.set(arena.width, arena.depth);
  const floor = new THREE.Mesh(
    track(new THREE.PlaneGeometry(width, depth)),
    track(new THREE.MeshLambertMaterial({ map: textures.floor })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(width / 2, 0, depth / 2);
  scene.add(floor);

  const city = maze.name === "city";
  const wallMaterial = (map: THREE.Texture) =>
    track(
      new THREE.MeshLambertMaterial({
        map,
        ...(city
          ? { emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.35 }
          : {}),
      }),
    );
  const { walls, tiers, ramps } = sortCells(arena);
  const transform = new THREE.Object3D();
  const instanced = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    cells: [number, number][],
    height: number,
  ) => {
    const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
    cells.forEach(([column, row], index) => {
      transform.position.set(
        (column + 0.5) * cellSize,
        height / 2,
        (row + 0.5) * cellSize,
      );
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    scene.add(mesh);
    disposables.push(mesh);
    return mesh;
  };
  const wallGeometry = track(
    new THREE.BoxGeometry(cellSize, wallHeight, cellSize),
  );
  instanced(wallGeometry, wallMaterial(textures.wall), walls[0]!, wallHeight);
  instanced(
    wallGeometry,
    wallMaterial(textures.wallAlternate),
    walls[1]!,
    wallHeight,
  );
  const tierSide = wallMaterial(textures.wall);
  const tierTop = track(new THREE.MeshLambertMaterial({ map: textures.top }));
  instanced(
    track(new THREE.BoxGeometry(cellSize, tierHeight, cellSize)),
    [tierSide, tierSide, tierTop, tierSide, tierSide, tierSide],
    tiers,
    tierHeight,
  );
  const ramp = track(rampGeometry());
  const rampTop = track(new THREE.MeshLambertMaterial({ map: textures.ramp }));
  for (const [column, row, tile] of ramps) {
    const mesh = new THREE.Mesh(ramp, [
      tierSide,
      tierSide,
      rampTop,
      tierSide,
      tierSide,
      tierSide,
    ]);
    mesh.position.set((column + 0.5) * cellSize, 0, (row + 0.5) * cellSize);
    mesh.rotation.y = rampTurn[tile]!;
    scene.add(mesh);
  }

  const shadow = track(shadowTexture());
  const shadowGeometry = track(new THREE.PlaneGeometry(3.2, 3.2));
  const shadowMaterial = track(
    new THREE.MeshBasicMaterial({
      map: shadow,
      transparent: true,
      depthWrite: false,
      color: 0x000000,
    }),
  );
  const bodyGeometry = track(new THREE.CylinderGeometry(0.82, 0.95, 0.5, 14));
  const bumperGeometry = track(new THREE.TorusGeometry(1.0, 0.22, 8, 22));
  bumperGeometry.rotateX(Math.PI / 2);
  const domeGeometry = track(
    new THREE.SphereGeometry(0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  );
  const finGeometry = track(new THREE.BoxGeometry(0.1, 0.5, 0.45));
  const bumperMaterial = track(
    new THREE.MeshLambertMaterial({ color: 0x1c1c1c }),
  );
  const domeMaterial = track(
    new THREE.MeshLambertMaterial({
      color: 0x9fd8ff,
      transparent: true,
      opacity: 0.75,
      emissive: 0x16324a,
    }),
  );
  const shieldMaterial = track(
    new THREE.MeshBasicMaterial({
      color: 0x49e6ff,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const shieldGeometry = track(new THREE.SphereGeometry(1.7, 16, 10));
  const crafts: CraftView[] = world.crafts.map((craft) => {
    const body = new THREE.Group();
    const hull = track(
      new THREE.MeshLambertMaterial({
        color: teamColors[craft.kind],
        transparent: true,
      }),
    );
    const shell = new THREE.Mesh(bodyGeometry, hull);
    shell.position.y = 0.45;
    const bumper = new THREE.Mesh(bumperGeometry, bumperMaterial);
    bumper.position.y = 0.3;
    const dome = new THREE.Mesh(domeGeometry, domeMaterial);
    dome.position.set(0, 0.68, 0.12);
    const fin = new THREE.Mesh(finGeometry, hull);
    fin.position.set(0, 0.9, 0.7);
    body.add(shell, bumper, dome, fin);
    let bubble: THREE.Mesh | null = null;
    if (craft.kind === "player") {
      bubble = new THREE.Mesh(shieldGeometry, shieldMaterial);
      bubble.position.y = 0.6;
      body.add(bubble);
    }
    const blob = new THREE.Mesh(shadowGeometry, shadowMaterial);
    blob.rotation.x = -Math.PI / 2;
    scene.add(body, blob);
    return { body, craft, hull, shadow: blob, shield: bubble };
  });

  const poleGeometry = track(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6));
  const clothGeometry = track(new THREE.BoxGeometry(1.1, 0.7, 0.05));
  clothGeometry.translate(0.55, 0, 0);
  const poleMaterial = track(
    new THREE.MeshLambertMaterial({ color: 0xd8d0c0 }),
  );
  const clothMaterials = {
    blue: track(new THREE.MeshLambertMaterial({ color: flagColors.blue })),
    red: track(new THREE.MeshLambertMaterial({ color: flagColors.red })),
  };
  const flags = world.flags.map((flag) => {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.y = 1.3;
    const cloth = new THREE.Mesh(clothGeometry, clothMaterials[flag.owner]);
    cloth.position.set(0.06, 2.2, 0);
    group.add(pole, cloth);
    group.position.set(flag.x, flag.y, flag.z);
    scene.add(group);
    return { flag, group, cloth };
  });

  const orbGeometry = track(new THREE.SphereGeometry(0.55, 14, 10));
  const ringGeometry = track(new THREE.TorusGeometry(0.78, 0.06, 6, 24));
  const podMaterials = new Map<PodKind, THREE.MeshLambertMaterial>();
  const podMaterial = (kind: PodKind) => {
    let material = podMaterials.get(kind);
    if (!material) {
      material = track(
        new THREE.MeshLambertMaterial({
          color: podColors[kind],
          emissive: podColors[kind],
          emissiveIntensity: 0.45,
        }),
      );
      podMaterials.set(kind, material);
    }
    return material;
  };
  const pods = world.pods.map((pod) => {
    const group = new THREE.Group();
    const orb = new THREE.Mesh(orbGeometry, podMaterial(pod.kind));
    const ring = new THREE.Mesh(ringGeometry, podMaterial(pod.kind));
    group.add(orb, ring);
    group.position.set(pod.x, pod.y + 1.1, pod.z);
    scene.add(group);
    return { pod, group, ring };
  });

  const padGeometry = track(new THREE.PlaneGeometry(3.2, 3.2));
  const padMaterials = {
    fling: track(
      new THREE.MeshBasicMaterial({
        map: track(padTexture("#3bff6a", "chevrons")),
      }),
    ),
    hold: track(
      new THREE.MeshBasicMaterial({
        map: track(padTexture("#ff3b3b", "cross")),
      }),
    ),
  };
  for (const trap of world.traps) {
    const pad = new THREE.Mesh(padGeometry, padMaterials[trap.kind]);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(trap.x, trap.y + 0.03, trap.z);
    scene.add(pad);
  }

  const barrierMaterial = track(
    new THREE.MeshLambertMaterial({ color: 0xff8a2a, map: textures.wall }),
  );
  const barrierGeometry = track(new THREE.BoxGeometry(4.6, barrierHeight, 0.7));
  const barriers = Array.from({ length: 3 }, () => {
    const mesh = new THREE.Mesh(barrierGeometry, barrierMaterial);
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  });

  let renderer: THREE.WebGLRenderer | null = null;
  const canvasHost = document.createElement("div");
  canvasHost.className = "hover-canvas";
  host.append(canvasHost);
  const still = document.createElement("canvas");
  still.className = "hover-still";
  still.hidden = true;
  host.append(still);
  let viewWidth = 1;
  let viewHeight = 1;
  let lastClock = 0;

  const acquire = () => {
    if (renderer) return renderer;
    const created = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    created.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    created.setSize(viewWidth, viewHeight, false);
    created.domElement.setAttribute("aria-hidden", "true");
    created.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      if (renderer !== created) return;
      renderer = null;
      created.dispose();
      created.domElement.remove();
      lost();
    });
    canvasHost.replaceChildren(created.domElement);
    still.hidden = true;
    renderer = created;
    return created;
  };

  const followCamera = (dt: number) => {
    const player = world.player;
    const forwardX = Math.sin(player.heading);
    const forwardZ = -Math.cos(player.heading);
    let reach = 7.5;
    for (let distance = 0.5; distance <= 7.5; distance += 0.5) {
      const x = player.x - forwardX * distance;
      const z = player.z - forwardZ * distance;
      const cell = arena.cellAt(x, z);
      if (
        arena.isWall(cell.column, cell.row) ||
        arena.heightAt(x, z) > player.y + 1.6
      ) {
        reach = Math.max(1.2, distance - 0.8);
        break;
      }
    }
    const ease = dt <= 0 ? 1 : 1 - Math.exp(-6 * dt);
    camera.position.x +=
      (player.x - forwardX * reach - camera.position.x) * ease;
    camera.position.z +=
      (player.z - forwardZ * reach - camera.position.z) * ease;
    const lift = player.y + 2.9 + (7.5 - reach) * 0.3;
    camera.position.y += (lift - camera.position.y) * ease;
    camera.lookAt(
      player.x + forwardX * 5,
      player.y + 1.1,
      player.z + forwardZ * 5,
    );
    mirror.position.set(
      player.x - forwardX * 1.4,
      player.y + 1.2,
      player.z - forwardZ * 1.4,
    );
    mirror.lookAt(
      player.x - forwardX * 10,
      player.y + 1.1,
      player.z - forwardZ * 10,
    );
  };

  const syncCraft = (view: CraftView, clock: number) => {
    const { craft, body, shadow: blob, hull, shield } = view;
    const ground = arena.heightAt(craft.x, craft.z);
    const bob = craft.held > 0 ? 0 : Math.sin(clock * 4 + craft.x) * 0.05;
    body.position.set(craft.x, craft.y + 0.2 + bob, craft.z);
    body.rotation.y = -craft.heading;
    const side =
      craft.vx * Math.cos(craft.heading) + craft.vz * Math.sin(craft.heading);
    body.rotation.z = -Math.max(-0.3, Math.min(0.3, side * 0.03));
    body.rotation.x = craft.fling > 0 ? Math.sin(clock * 30) * 0.3 : 0;
    hull.opacity = craft.cloak > 0 ? 0.2 : 1;
    if (shield) shield.visible = craft.shield > 0;
    blob.position.set(craft.x, ground + 0.03, craft.z);
    blob.scale.setScalar(Math.max(0.4, 1 - (craft.y - ground) * 0.18));
  };

  const sync = (clock: number) => {
    for (const view of crafts) syncCraft(view, clock);
    for (const { flag, group, cloth } of flags) {
      group.visible = !flag.taken;
      cloth.rotation.y = Math.sin(clock * 3 + flag.x) * 0.4;
    }
    for (const { pod, group, ring } of pods) {
      group.visible = pod.respawn <= 0;
      group.position.y = pod.y + 1.1 + Math.sin(clock * 2 + pod.x) * 0.15;
      ring.rotation.x = clock * 1.6;
      ring.rotation.y = clock * 1.1;
    }
    barriers.forEach((mesh, index) => {
      const barrier = world.barriers[index];
      mesh.visible = barrier !== undefined;
      if (!barrier) return;
      mesh.position.set(barrier.x, barrier.y + barrierHeight / 2, barrier.z);
      mesh.rotation.y = -barrier.heading;
    });
  };

  const mirrorBox = () => {
    if (viewWidth < 520) return null;
    const mirrorWidth = Math.round(viewWidth * 0.34);
    return {
      left: Math.round((viewWidth - mirrorWidth) / 2),
      top: 10,
      width: mirrorWidth,
      height: Math.round(mirrorWidth / 3.4),
    };
  };

  const draw = (current: THREE.WebGLRenderer) => {
    current.setScissorTest(true);
    current.setViewport(0, 0, viewWidth, viewHeight);
    current.setScissor(0, 0, viewWidth, viewHeight);
    current.render(scene, camera);
    const box = mirrorBox();
    if (!box) return;
    // The rear-view mirror across the top, as in Hover!.
    const bottom = viewHeight - box.top - box.height;
    current.setViewport(box.left, bottom, box.width, box.height);
    current.setScissor(box.left, bottom, box.width, box.height);
    current.render(scene, mirror);
  };

  const release = () => {
    if (!renderer) return;
    const current = renderer;
    renderer = null;
    sync(lastClock);
    draw(current);
    still.width = current.domElement.width;
    still.height = current.domElement.height;
    still.getContext("2d")?.drawImage(current.domElement, 0, 0);
    still.hidden = false;
    current.dispose();
    current.forceContextLoss();
    current.domElement.remove();
  };

  followCamera(0);

  return {
    acquire,
    release,
    mirrorBox,
    get active() {
      return renderer !== null;
    },
    resize(nextWidth: number, nextHeight: number) {
      viewWidth = Math.max(1, nextWidth);
      viewHeight = Math.max(1, nextHeight);
      camera.aspect = viewWidth / viewHeight;
      // Portrait panes keep a usable horizontal view.
      camera.fov = camera.aspect < 1 ? 64 + (1 - camera.aspect) * 30 : 64;
      camera.updateProjectionMatrix();
      mirror.aspect = 3.4;
      mirror.updateProjectionMatrix();
      renderer?.setSize(viewWidth, viewHeight, false);
    },
    snapCamera() {
      followCamera(0);
    },
    render(dt: number, clock: number) {
      const current = renderer;
      if (!current) return false;
      lastClock = clock;
      sync(clock);
      followCamera(dt);
      draw(current);
      return true;
    },
    dispose() {
      release();
      still.remove();
      canvasHost.remove();
      for (const value of disposables) value.dispose();
    },
  };
}

export type HoverRenderer = ReturnType<typeof createHoverRenderer>;
