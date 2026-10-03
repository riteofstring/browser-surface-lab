import * as THREE from "three";
import { fixtureColor, observeFixtureTheme } from "../shared/theme";

type SceneKind = "reactor" | "tidal";

let sharedRenderer: THREE.WebGLRenderer | null = null;
const rendererClients = new Set<(message: string) => void>();

function acquireRenderer(failed: (message: string) => void) {
  if (!sharedRenderer) {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.domElement.addEventListener("webglcontextlost", () => {
      if (sharedRenderer !== renderer) return;
      sharedRenderer = null;
      renderer.dispose();
      for (const notify of rendererClients)
        notify("Graphics context lost. Retry to resume this scene.");
    });
    sharedRenderer = renderer;
  }
  rendererClients.add(failed);
}

function releaseRenderer(failed: (message: string) => void) {
  rendererClients.delete(failed);
  if (rendererClients.size || !sharedRenderer) return;
  const renderer = sharedRenderer;
  sharedRenderer = null;
  renderer.dispose();
  renderer.forceContextLoss();
}

export function createThreeScene(
  kind: SceneKind,
  host: HTMLElement,
  failed: (message: string) => void,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas presentation is unavailable");
  acquireRenderer(failed);
  canvas.setAttribute(
    "aria-label",
    kind === "reactor"
      ? "Animated chromatic reactor"
      : "Animated tidal lattice",
  );
  host.append(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80);
  const group = new THREE.Group();
  scene.add(group);
  const uniforms = {
    time: { value: 0 },
    energy: { value: 1 },
    accent: { value: new THREE.Color() },
    alternate: { value: new THREE.Color() },
  };
  const background = new THREE.Color();
  const wireMaterial = new THREE.MeshBasicMaterial({
    wireframe: true,
    transparent: true,
    opacity: 0.12,
  });
  const satelliteMaterial = new THREE.MeshBasicMaterial();
  const starMaterial = new THREE.PointsMaterial({ size: 0.035 });
  const vertexShader =
    kind === "reactor"
      ? `
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      vNormal = normalMatrix * normal;
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `
      : `
    uniform float time;
    uniform float energy;
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      vec3 p = position;
      p.z = energy * (sin(p.x * 1.2 + time) * cos(p.y * 0.8 - time * 0.7) * 0.55 + sin(length(p.xy) * 2.0 - time * 1.8) * 0.25);
      vPosition = p;
      vNormal = normalMatrix * normal;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `;
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader,
    fragmentShader: `
      uniform float time;
      uniform vec3 accent;
      uniform vec3 alternate;
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        float bands = 0.5 + 0.5 * sin(vPosition.y * 2.8 + vPosition.z * 3.0 + time * 0.8);
        vec3 color = mix(accent, alternate, bands);
        float rim = pow(1.0 - abs(normalize(vNormal).z), 2.0);
        gl_FragColor = vec4(color * (0.25 + rim * 0.9 + bands * 0.35), 1.0);
      }
    `,
  });
  let satellites: THREE.InstancedMesh | undefined;
  if (kind === "reactor") {
    camera.position.set(0, 0.3, 7.2);
    const mesh = new THREE.Mesh(
      new THREE.TorusKnotGeometry(1.15, 0.35, 128, 12, 2, 3),
      material,
    );
    group.add(mesh);
    const wire = new THREE.Mesh(mesh.geometry, wireMaterial);
    wire.scale.setScalar(1.005);
    group.add(wire);
    satellites = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.075, 0),
      satelliteMaterial,
      96,
    );
    const transform = new THREE.Object3D();
    for (let index = 0; index < 96; index++) {
      const angle = (index * Math.PI * 2) / 96;
      transform.position.set(
        Math.cos(angle) * 2.35,
        Math.sin(angle) * 2.35,
        Math.sin(angle * 3) * 0.55,
      );
      transform.updateMatrix();
      satellites.setMatrixAt(index, transform.matrix);
    }
    group.add(satellites);
  } else {
    camera.position.set(0, -6.5, 5.8);
    camera.lookAt(0, 0, 0);
    const geometry = new THREE.PlaneGeometry(9, 9, 64, 64);
    material.wireframe = true;
    group.add(new THREE.Mesh(geometry, material));
  }
  const positions = new Float32Array(450 * 3);
  for (let index = 0; index < 450; index++) {
    positions[index * 3] = Math.sin(index * 127.1) * 13;
    positions[index * 3 + 1] = Math.cos(index * 311.7) * 13;
    positions[index * 3 + 2] = -3 - (index % 17);
  }
  const stars = new THREE.BufferGeometry();
  stars.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  scene.add(new THREE.Points(stars, starMaterial));
  let visible = true;
  const present = () => {
    const renderer = sharedRenderer;
    if (!visible || !renderer) return;
    if (
      renderer.domElement.width < canvas.width ||
      renderer.domElement.height < canvas.height
    )
      renderer.setSize(
        Math.max(renderer.domElement.width, canvas.width),
        Math.max(renderer.domElement.height, canvas.height),
        false,
      );
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    renderer.setScissor(0, 0, canvas.width, canvas.height);
    renderer.setScissorTest(true);
    renderer.setClearColor(background);
    renderer.render(scene, camera);
    context.drawImage(
      renderer.domElement,
      0,
      renderer.domElement.height - canvas.height,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  };
  const resize = (redraw = true) => {
    if (!visible) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const ratio = Math.min(devicePixelRatio, 1.5);
    const pixelWidth = Math.max(1, Math.floor(width * ratio));
    const pixelHeight = Math.max(1, Math.floor(height * ratio));
    if (canvas.width === pixelWidth && canvas.height === pixelHeight) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    if (redraw) present();
  };
  const observer = new ResizeObserver(() => resize());
  observer.observe(host);
  resize(false);
  const removeTheme = observeFixtureTheme(() => {
    background.set(fixtureColor(host, "surface"));
    uniforms.accent.value.set(fixtureColor(host, "accent"));
    uniforms.alternate.value.set(fixtureColor(host, "accent-alt"));
    wireMaterial.color.set(fixtureColor(host, "positive"));
    satelliteMaterial.color.set(fixtureColor(host, "warning"));
    starMaterial.color.set(fixtureColor(host, "text-subtle"));
    if (visible) {
      resize(false);
      present();
    } else {
      acquireRenderer(failed);
      visible = true;
      resize(false);
      present();
      visible = false;
      releaseRenderer(failed);
    }
  });
  return {
    canvas,
    setVisible(value: boolean) {
      if (visible === value) return false;
      visible = value;
      if (visible) {
        acquireRenderer(failed);
        resize(false);
      } else releaseRenderer(failed);
      return visible;
    },
    draw(time: number, energy: number, pointer: { x: number; y: number }) {
      uniforms.time.value = time;
      uniforms.energy.value = energy;
      if (kind === "reactor") {
        group.rotation.x = Math.sin(time * 0.2) * 0.25 + pointer.y * 0.3;
        group.rotation.y = time * 0.18 + pointer.x * 0.5;
        if (satellites) satellites.rotation.z = time * 0.12 * energy;
      } else group.rotation.z = Math.sin(time * 0.08) * 0.12 + pointer.x * 0.18;
      present();
    },
    dispose() {
      removeTheme();
      observer.disconnect();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>([
        wireMaterial,
        satelliteMaterial,
        starMaterial,
      ]);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          geometries.add(object.geometry);
          for (const value of Array.isArray(object.material)
            ? object.material
            : [object.material])
            materials.add(value);
          if (object instanceof THREE.InstancedMesh) object.dispose();
        }
      });
      for (const geometry of geometries) geometry.dispose();
      for (const value of materials) value.dispose();
      releaseRenderer(failed);
      canvas.remove();
    },
  };
}
