import * as THREE from "three";
import { fixtureColor } from "../shared/theme";
import {
  arenaSize,
  barrierHeight,
  cellSize,
  isWall,
  wallCells,
  wallHeight,
  type Craft,
  type HoverWorld,
  type PodKind,
} from "./hover-world";

type ColorName = Parameters<typeof fixtureColor>[1];

interface CraftView {
  body: THREE.Group;
  craft: Craft;
  glow: THREE.Mesh;
  hull: THREE.MeshLambertMaterial;
  shadow: THREE.Mesh;
}

const podColors: Record<PodKind, ColorName> = {
  spring: "positive",
  barrier: "positive",
  cloak: "positive",
  speed: "focus",
  slow: "warning",
};

function radialTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(0,0,0,0.55)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createHoverRenderer(
  world: HoverWorld,
  host: HTMLElement,
  themeRoot: HTMLElement,
  lost: () => void,
) {
  const color = (name: ColorName) => fixtureColor(themeRoot, name);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 20, 78);
  const camera = new THREE.PerspectiveCamera(64, 1, 0.3, 110);
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(value: T): T => {
    disposables.push(value);
    return value;
  };

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x000000, 1.6);
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(-0.6, 1, 0.35);
  scene.add(hemisphere, sun);

  const floorCanvas = document.createElement("canvas");
  floorCanvas.width = floorCanvas.height = 128;
  const floorTexture = track(new THREE.CanvasTexture(floorCanvas));
  floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  floorTexture.repeat.set(arenaSize.width / 2, arenaSize.depth / 2);
  const floor = new THREE.Mesh(
    track(
      new THREE.PlaneGeometry(
        arenaSize.width * cellSize,
        arenaSize.depth * cellSize,
      ),
    ),
    track(new THREE.MeshBasicMaterial({ map: floorTexture })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(
    (arenaSize.width * cellSize) / 2,
    0,
    (arenaSize.depth * cellSize) / 2,
  );
  scene.add(floor);

  const walls = wallCells();
  const wallSide = track(new THREE.MeshLambertMaterial());
  const wallTop = track(new THREE.MeshLambertMaterial());
  const wallMesh = new THREE.InstancedMesh(
    track(new THREE.BoxGeometry(cellSize, wallHeight, cellSize)),
    [wallSide, wallSide, wallTop, wallSide, wallSide, wallSide],
    walls.length,
  );
  const transform = new THREE.Object3D();
  walls.forEach(({ column, row }, index) => {
    transform.position.set(
      (column + 0.5) * cellSize,
      wallHeight / 2,
      (row + 0.5) * cellSize,
    );
    transform.updateMatrix();
    wallMesh.setMatrixAt(index, transform.matrix);
  });
  scene.add(wallMesh);

  const shadowTexture = track(radialTexture());
  const shadowGeometry = track(new THREE.PlaneGeometry(3, 3));
  const shadowMaterial = track(
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
      color: 0x000000,
    }),
  );
  const hullGeometry = track(new THREE.CylinderGeometry(0.85, 1.1, 0.5, 8));
  hullGeometry.scale(1, 1, 1.25);
  const canopyGeometry = track(
    new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  );
  const finGeometry = track(new THREE.BoxGeometry(0.12, 0.55, 0.6));
  const glowGeometry = track(new THREE.RingGeometry(0.75, 1.15, 16));
  const canopyMaterial = track(new THREE.MeshLambertMaterial());

  const crafts: CraftView[] = world.crafts.map((craft) => {
    const body = new THREE.Group();
    const hull = track(new THREE.MeshLambertMaterial({ transparent: true }));
    const hullMesh = new THREE.Mesh(hullGeometry, hull);
    hullMesh.position.y = 0.35;
    const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
    canopy.position.set(0, 0.6, 0.15);
    const fin = new THREE.Mesh(finGeometry, hull);
    fin.position.set(0, 0.85, 0.95);
    const glow = new THREE.Mesh(
      glowGeometry,
      track(
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.06;
    body.add(hullMesh, canopy, fin, glow);
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    scene.add(body, shadow);
    return { body, craft, glow, hull, shadow };
  });

  const poleGeometry = track(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6));
  const clothGeometry = track(new THREE.BoxGeometry(0.9, 0.6, 0.06));
  const beamGeometry = track(
    new THREE.CylinderGeometry(0.35, 0.35, 14, 10, 1, true),
  );
  const poleMaterial = track(new THREE.MeshLambertMaterial());
  const flagMaterials = {
    player: track(new THREE.MeshLambertMaterial()),
    rival: track(new THREE.MeshLambertMaterial()),
  };
  const beamMaterials = {
    player: track(
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
    rival: track(
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  };
  const flags = world.flags.map((flag) => {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.y = 1.2;
    const cloth = new THREE.Mesh(clothGeometry, flagMaterials[flag.owner]);
    cloth.position.set(0.48, 2.05, 0);
    const beam = new THREE.Mesh(beamGeometry, beamMaterials[flag.owner]);
    beam.position.y = 7;
    group.add(pole, cloth, beam);
    group.position.set(flag.x, 0, flag.z);
    scene.add(group);
    return { flag, group, cloth };
  });

  const podGeometries: Record<PodKind, THREE.BufferGeometry> = {
    spring: track(new THREE.ConeGeometry(0.55, 1, 4)),
    barrier: track(new THREE.BoxGeometry(0.9, 0.9, 0.9)),
    cloak: track(new THREE.IcosahedronGeometry(0.6, 0)),
    speed: track(new THREE.RingGeometry(0.9, 1.5, 3)),
    slow: track(new THREE.CircleGeometry(1.5, 14)),
  };
  const podMaterials = new Map<PodKind, THREE.Material & { color: THREE.Color }>();
  for (const kind of Object.keys(podGeometries) as PodKind[])
    podMaterials.set(
      kind,
      track(
        kind === "speed" || kind === "slow"
          ? new THREE.MeshBasicMaterial({
              transparent: true,
              opacity: 0.75,
              side: THREE.DoubleSide,
              depthWrite: false,
            })
          : new THREE.MeshLambertMaterial({
              transparent: kind === "cloak",
              opacity: kind === "cloak" ? 0.65 : 1,
            }),
      ),
    );
  const pods = world.pods.map((pod) => {
    const mesh = new THREE.Mesh(podGeometries[pod.kind], podMaterials.get(pod.kind));
    const flat = pod.kind === "speed" || pod.kind === "slow";
    mesh.position.set(pod.x, flat ? 0.04 : 1.1, pod.z);
    if (flat) mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    return { pod, mesh, flat };
  });

  const barrierMaterial = track(
    new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.85 }),
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
  let width = 1;
  let height = 1;
  let lastClock = 0;

  const acquire = () => {
    if (renderer) return renderer;
    const created = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    created.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    created.setSize(width, height, false);
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

  const release = () => {
    if (!renderer) return;
    const current = renderer;
    renderer = null;
    sync(lastClock);
    current.render(scene, camera);
    still.width = current.domElement.width;
    still.height = current.domElement.height;
    still.getContext("2d")?.drawImage(current.domElement, 0, 0);
    still.hidden = false;
    current.dispose();
    current.forceContextLoss();
    current.domElement.remove();
  };

  const applyTheme = () => {
    const page = color("page");
    renderer?.setClearColor(page);
    scene.background = new THREE.Color(page);
    scene.fog!.color.set(page);
    hemisphere.color.set(color("text"));
    hemisphere.groundColor.set(color("surface-sunken"));
    const context = floorCanvas.getContext("2d")!;
    context.fillStyle = color("surface-sunken");
    context.fillRect(0, 0, 128, 128);
    context.fillStyle = color("surface");
    context.fillRect(0, 0, 64, 64);
    context.fillRect(64, 64, 64, 64);
    context.strokeStyle = color("border");
    context.lineWidth = 2;
    context.strokeRect(1, 1, 62, 62);
    context.strokeRect(65, 65, 62, 62);
    context.strokeRect(65, 1, 62, 62);
    context.strokeRect(1, 65, 62, 62);
    floorTexture.needsUpdate = true;
    wallSide.color.set(color("surface-raised"));
    wallTop.color.set(color("border"));
    wallSide.emissive.set(color("border")).multiplyScalar(0.25);
    canopyMaterial.color.set(color("page"));
    canopyMaterial.emissive.set(color("text-subtle")).multiplyScalar(0.3);
    for (const view of crafts) {
      const name: ColorName =
        view.craft.kind === "player"
          ? "accent"
          : view.craft.kind === "rival"
            ? "accent-alt"
            : "text-muted";
      view.hull.color.set(color(name));
      (view.glow.material as THREE.MeshBasicMaterial).color.set(color(name));
    }
    poleMaterial.color.set(color("text-subtle"));
    flagMaterials.rival.color.set(color("accent-alt"));
    flagMaterials.player.color.set(color("accent"));
    beamMaterials.rival.color.set(color("accent-alt"));
    beamMaterials.player.color.set(color("accent"));
    for (const [kind, material] of podMaterials)
      material.color.set(color(podColors[kind]));
    barrierMaterial.color.set(color("positive"));
  };

  const followCamera = (dt: number) => {
    const player = world.player;
    const forwardX = Math.sin(player.heading);
    const forwardZ = -Math.cos(player.heading);
    let reach = 8;
    for (let distance = 0.5; distance <= 8; distance += 0.5)
      if (
        isWall(
          Math.floor((player.x - forwardX * distance) / cellSize),
          Math.floor((player.z - forwardZ * distance) / cellSize),
        )
      ) {
        reach = Math.max(0, distance - 0.8);
        break;
      }
    const targetX = player.x - forwardX * reach;
    const targetZ = player.z - forwardZ * reach;
    const ease = dt <= 0 ? 1 : 1 - Math.exp(-5 * dt);
    camera.position.x += (targetX - camera.position.x) * ease;
    camera.position.z += (targetZ - camera.position.z) * ease;
    const lift = 4.6 + (8 - reach) * 0.35 + player.y * 0.6;
    camera.position.y += (lift - camera.position.y) * ease;
    camera.lookAt(player.x + forwardX * 4, 0.9 + player.y * 0.5, player.z + forwardZ * 4);
  };

  const sync = (clock: number) => {
    for (const view of crafts) {
      const { craft, body, shadow, hull, glow } = view;
      const bob = Math.sin(clock * 4 + craft.x) * 0.06;
      body.position.set(craft.x, 0.25 + craft.y + bob, craft.z);
      body.rotation.y = -craft.heading;
      const side = craft.vx * Math.cos(craft.heading) + craft.vz * Math.sin(craft.heading);
      body.rotation.z = -Math.max(-0.3, Math.min(0.3, side * 0.03));
      hull.opacity = craft.cloak > 0 ? 0.25 : 1;
      glow.visible = craft.cloak <= 0;
      (glow.material as THREE.MeshBasicMaterial).opacity =
        craft.boost > 0 ? 1 : craft.slow > 0 ? 0.2 : 0.7;
      shadow.position.set(craft.x, 0.02, craft.z);
      shadow.scale.setScalar(Math.max(0.4, 1 - craft.y * 0.18));
    }
    for (const { flag, group, cloth } of flags) {
      group.visible = !flag.taken;
      cloth.rotation.y = Math.sin(clock * 3 + flag.x) * 0.35;
    }
    for (const { pod, mesh, flat } of pods) {
      mesh.visible = pod.respawn <= 0;
      if (flat) mesh.rotation.z = clock * (pod.kind === "speed" ? 1.5 : 0.3);
      else {
        mesh.rotation.y = clock * 1.4;
        mesh.position.y = 1.1 + Math.sin(clock * 2 + pod.x) * 0.15;
      }
    }
    barriers.forEach((mesh, index) => {
      const barrier = world.barriers[index];
      mesh.visible = barrier !== undefined;
      if (!barrier) return;
      mesh.position.set(barrier.x, barrierHeight / 2, barrier.z);
      mesh.rotation.y = -barrier.heading;
    });
  };

  applyTheme();
  followCamera(0);

  return {
    applyTheme,
    acquire,
    release,
    get active() {
      return renderer !== null;
    },
    resize(nextWidth: number, nextHeight: number) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer?.setSize(width, height, false);
    },
    snapCamera() {
      followCamera(0);
    },
    render(dt: number, clock: number) {
      const current = renderer;
      if (!current) return false;
      lastClock = clock;
      current.setClearColor(scene.background as THREE.Color);
      sync(clock);
      followCamera(dt);
      current.render(scene, camera);
      return true;
    },
    dispose() {
      release();
      still.remove();
      canvasHost.remove();
      wallMesh.dispose();
      for (const value of disposables) value.dispose();
    },
  };
}

export type HoverRenderer = ReturnType<typeof createHoverRenderer>;
