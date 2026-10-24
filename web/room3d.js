// Optional real 3D scene. If WebGL/CDN are unavailable, the static isometric SVG remains visible.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';

const host = document.getElementById('room3d');
const stage = document.getElementById('roomStage');
if (host && stage && window.WebGLRenderingContext) {
  try {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b1725');
    scene.fog = new THREE.Fog('#0b1725', 11, 24);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(8.7, 7.1, 9.6);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xa5dfff, 0x0b1424, 2.0));
    const key = new THREE.DirectionalLight(0x64dfff, 3.2); key.position.set(4, 8, 4); scene.add(key);
    const purple = new THREE.PointLight(0x9b76ff, 24, 11); purple.position.set(-3, 3, -1); scene.add(purple);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 5.5), new THREE.MeshStandardMaterial({ color: '#102337', roughness: .88, metalness: .1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.04; scene.add(floor);
    const grid = new THREE.GridHelper(8, 16, '#31617c', '#1b354a'); grid.position.y = 0.005; scene.add(grid);
    const roomMat = new THREE.MeshStandardMaterial({ color: '#163048', transparent: true, opacity: .18, side: THREE.DoubleSide, roughness: .8 });
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.1), roomMat); backWall.position.set(0, 1.5, -2.75); scene.add(backWall);
    const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 3.1), roomMat); sideWall.rotation.y = Math.PI / 2; sideWall.position.set(-4, 1.5, 0); scene.add(sideWall);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(8, 3.1, 5.5)), new THREE.LineBasicMaterial({ color: '#28516c', transparent: true, opacity: .8 })); edges.position.y = 1.5; scene.add(edges);

    // Illustrative RF propagation rings; visual aid only, not a physical radio simulation.
    const source = new THREE.Group(); source.position.set(0, .3, -2.1); scene.add(source);
    const sourceBody = new THREE.Mesh(new THREE.BoxGeometry(.62, .26, .2), new THREE.MeshStandardMaterial({ color: '#163d54', emissive: '#126888', emissiveIntensity: .9, metalness: .4, roughness: .3 })); source.add(sourceBody);
    const led = new THREE.Mesh(new THREE.SphereGeometry(.04, 12, 12), new THREE.MeshBasicMaterial({ color: '#8dffd0' })); led.position.set(.22, -.03, .12); source.add(led);
    const waveRings = [];
    for (let i = 0; i < 3; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(.45 + i * .42, .008, 5, 72), new THREE.MeshBasicMaterial({ color: '#4ad9f2', transparent: true, opacity: .18 - i * .035 })); ring.rotation.x = -Math.PI / 2; ring.position.y = .04 + i * .012; source.add(ring); waveRings.push(ring); }

    const people = [];
    function cylinderBetween(a, b, radius, material, parent) {
      const vA = new THREE.Vector3(...a), vB = new THREE.Vector3(...b), diff = new THREE.Vector3().subVectors(vB, vA);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * .72, radius, diff.length(), 8), material);
      mesh.position.copy(vA).add(vB).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), diff.normalize()); parent.add(mesh); return mesh;
    }
    function makePerson(color, name, position) {
      const g = new THREE.Group(); g.position.set(...position); scene.add(g);
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .36, roughness: .5 });
      const joint = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .55 });
      const head = new THREE.Mesh(new THREE.SphereGeometry(.16, 18, 18), mat); head.position.y = 1.48; g.add(head);
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.16, .48, 4, 8), mat); torso.position.y = 1.02; g.add(torso);
      const joints = [[[-.12,1.2,0],[-.34,.84,0]],[[.12,1.2,0],[.33,.91,0]],[[-.08,.78,0],[-.18,.3,.02]],[[.08,.78,0],[.19,.3,-.02]]];
      const bones = joints.map((pair, i) => cylinderBetween(pair[0], pair[1], i < 2 ? .055 : .068, joint, g));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.39, .012, 8, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .8 })); ring.rotation.x = -Math.PI / 2; ring.position.y = .03; g.add(ring);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(.27, .009, 8, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .6 })); halo.position.y = 1.5; halo.rotation.x = Math.PI / 2; g.add(halo);
      const label = makeTextSprite(name, color); label.position.set(0, 1.92, 0); g.add(label);
      people.push({ group: g, head, ring, halo, bones, position: [...position], phase: Math.random() * 6, color });
      return g;
    }
    function makeTextSprite(text, color) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
      const c = canvas.getContext('2d'); c.clearRect(0,0,256,64); c.fillStyle = '#071421d9'; c.fillRect(8,8,240,48); c.strokeStyle = color; c.strokeRect(8,8,240,48);
      c.font = 'bold 23px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color; c.fillText(text,128,33);
      const texture = new THREE.CanvasTexture(canvas); const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })); sprite.scale.set(1.25,.32,1); return sprite;
    }
    makePerson('#58dff4', 'شخص 01', [-1.0, 0, -.25]);
    makePerson('#b095ff', 'شخص 02', [1.05, 0, .9]);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .065; controls.target.set(0, .8, 0); controls.minDistance = 6; controls.maxDistance = 17; controls.maxPolarAngle = Math.PI * .48;

    function resize() { const w = Math.max(host.clientWidth, 1), h = Math.max(host.clientHeight, 1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    stage.classList.add('is-3d');
    const clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      waveRings.forEach((r, i) => { const s = 1 + .08 * Math.sin(t * 1.3 + i); r.scale.setScalar(s); r.material.opacity = .14 + .07 * (Math.sin(t * 1.2 + i) + 1) / 2; });
      people.forEach((p, i) => {
        const bob = Math.sin(t * (i ? 1.4 : 1.05) + p.phase) * .035;
        p.group.position.x = p.position[0] + Math.sin(t * .38 + p.phase) * .18;
        p.group.position.z = p.position[2] + Math.cos(t * .42 + p.phase) * .16;
        p.head.position.y = 1.48 + bob;
        p.ring.scale.setScalar(1 + .06 * Math.sin(t * 1.7 + i));
        p.halo.rotation.y = t * .24;
        p.bones[0].rotation.z = Math.sin(t * 2 + p.phase) * .07;
        p.bones[1].rotation.z = -Math.sin(t * 2 + p.phase) * .07;
      });
      controls.update(); renderer.render(scene, camera);
    }
    animate();
    document.querySelectorAll('.room-control').forEach(btn => btn.addEventListener('click', () => {
      people.forEach((p, i) => { p.ring.visible = btn.dataset.room !== 'skeleton'; p.bones.forEach(b => { b.visible = btn.dataset.room !== 'heat'; }); p.halo.visible = btn.dataset.room === 'paths'; });
      waveRings.forEach(r => r.visible = btn.dataset.room === 'heat');
    }));
    document.getElementById('recenter')?.addEventListener('click', () => { camera.position.set(8.7,7.1,9.6); controls.target.set(0,.8,0); controls.update(); });
    document.getElementById('roomExpand')?.addEventListener('click', () => setTimeout(resize, 120));
  } catch (err) {
    console.warn('3D scene unavailable; keeping the static room view.', err);
  }
}
