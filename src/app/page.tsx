"use client";

import { db } from "@/lib/db";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  GridHelper,
  Group,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

type PresencePayload = {
  id: string;
  name: string;
  color: string;
  posX: number;
  posY: number;
  posZ: number;
  rotY: number;
  alive: boolean;
  hp: number;
};

const WORLD_RADIUS = 40;
const PLAYER_HEIGHT = 1.6;
const MAX_HP = 3;
const RESPAWN_MS = 1200;
const FLOOR_Y = 0;

function createPlayerModel(color: string) {
  const root = new Group();
  const add = (
    geo: BoxGeometry,
    hex: string,
    position: [number, number, number],
    scale?: [number, number, number],
  ) => {
    const mat = new MeshLambertMaterial({ color: hex });
    const mesh = new Mesh(geo, mat);
    mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    mesh.castShadow = true;
    root.add(mesh);
  };

  const body = new BoxGeometry(1.2, 1.6, 0.7);
  const limb = new BoxGeometry(0.35, 1.2, 0.35);
  const head = new BoxGeometry(0.85, 0.9, 0.8);
  const shoulder = new BoxGeometry(1.6, 0.25, 0.5);
  const hair = new BoxGeometry(0.9, 0.3, 0.85);

  add(body, color, [0, 1.5, 0]);
  add(head, "#f7d8a6", [0, 2.65, 0]);
  add(hair, "#2f2a28", [0, 3.05, 0]);
  add(shoulder, "#304666", [0, 2.2, 0]);
  add(limb, "#304666", [-0.45, 1.0, 0.05]);
  add(limb, "#304666", [0.45, 1.0, 0.05]);
  add(limb, "#2e5d53", [-0.3, 0.2, 0]);
  add(limb, "#2e5d53", [0.3, 0.2, 0]);
  return root;
}

function FPSPresenceArena() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<PointerLockControls | null>(null);
  const remoteMeshesRef = useRef<Map<string, Group>>(new Map());
  const peersRef = useRef<Record<string, PresencePayload>>({});
  const animationRef = useRef<number | null>(null);
  const gunRef = useRef<Group | null>(null);
  const recoilRef = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);
  const hpBarRefs = useRef<Map<string, { bar: Mesh; width: number }>>(
    new Map(),
  );
  const playerId = useMemo(
    () => Math.random().toString(16).slice(2, 10),
    [],
  );
  const { data: mapsData, isLoading: mapsLoading } = db.useQuery({
    maps: { $: { order: { createdAt: "desc" } } },
  });
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  useEffect(() => {
    if (!mapsLoading && mapsData?.maps?.length && !selectedMapId) {
      setSelectedMapId(mapsData.maps[0].id);
    }
  }, [mapsLoading, mapsData?.maps, selectedMapId]);

  const room = useMemo(
    () => db.room("maps", selectedMapId || "lobby"),
    [selectedMapId],
  );
  const presenceState = room.usePresence({});
  const publishShot = room.usePublishTopic("shot");
  const [peers, setPeers] = useState<Record<string, PresencePayload>>({});
  const [selfPresence, setSelfPresence] = useState<PresencePayload | null>(null);
  const [hp, setHp] = useState(MAX_HP);
  const [isDead, setIsDead] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !selectedMapId) return;

    const scene = new Scene();
    scene.background = new Color("#c7def5");

    const camera = new PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );
    camera.position.set(0, PLAYER_HEIGHT, 10);
    scene.add(camera);

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    audioRef.current = new AudioContext();

    const controls = new PointerLockControls(camera, renderer.domElement);
    controlsRef.current = controls;

    const hemi = new HemisphereLight("#e7f3ff", "#9bb5d3", 1.1);
    hemi.position.set(0, 20, 0);
    scene.add(hemi);

    const ambient = new DirectionalLight("#ffffff", 0.9);
    ambient.position.set(12, 18, 10);
    scene.add(ambient);

    const keyLight = new DirectionalLight("#f7d046", 0.6);
    keyLight.position.set(-6, 10, -6);
    scene.add(keyLight);

    const floorGeo = new PlaneGeometry(200, 200);
    const floorMat = new MeshLambertMaterial({ color: "#dfe9f5" });
    const floor = new Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    scene.add(floor);

    const grid = new GridHelper(200, 40, "#7aa7e0", "#9fbde7");
    (grid.material as any).opacity = 0.25;
    (grid.material as any).transparent = true;
    grid.position.y = FLOOR_Y + 0.02;
    scene.add(grid);

    const wallGeo = new BoxGeometry(200, 6, 2);
    const wallMat = new MeshLambertMaterial({ color: "#9cb6d9" });
    const makeWall = (x: number, z: number, rotY: number) => {
      const wall = new Mesh(wallGeo, wallMat);
      wall.position.set(x, 3, z);
      wall.rotation.y = rotY;
      wall.receiveShadow = true;
      scene.add(wall);
    };
    const buildPlayerGun = () => {
      const group = new Group();
      const addPiece = (
        geo: BoxGeometry,
        color: string,
        position: [number, number, number],
        scale?: [number, number, number],
      ) => {
        const mat = new MeshLambertMaterial({ color });
        const mesh = new Mesh(geo, mat);
        mesh.position.set(...position);
        if (scale) mesh.scale.set(...scale);
        group.add(mesh);
      };
      addPiece(new BoxGeometry(0.2, 0.6, 0.2), "#0d1b2f", [0, -0.2, 0]);
      addPiece(new BoxGeometry(0.7, 0.4, 0.4), "#1a2f4a", [0.2, 0.2, 0]);
      addPiece(new BoxGeometry(0.6, 0.2, 0.2), "#8fb0d8", [0.55, 0.35, 0]);
      addPiece(new BoxGeometry(0.4, 0.18, 0.18), "#c5d8f1", [0.8, 0.2, 0]);
      addPiece(new BoxGeometry(0.12, 0.12, 0.3), "#0f1724", [-0.05, 0, -0.2]);
      addPiece(new BoxGeometry(0.12, 0.12, 0.3), "#0f1724", [-0.05, 0, 0.2]);
      addPiece(new BoxGeometry(0.15, 0.08, 0.08), "#f5c05c", [0.25, 0.5, 0]);
      return group;
    };

    const makeObstacles = () => {
      const seedString = selectedMapId || "seed";
      let seed = 0;
      for (let i = 0; i < seedString.length; i++) {
        seed = (seed * 31 + seedString.charCodeAt(i)) >>> 0;
      }
      const rand = () => {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        return ((seed >>> 0) % 1000) / 1000;
      };
      const obstacleGeo = new BoxGeometry(4, 2, 8);
      for (let i = 0; i < 8; i++) {
        const w = 2 + rand() * 6;
        const h = 1 + rand() * 3;
        const d = 2 + rand() * 8;
        const geo = new BoxGeometry(w, h, d);
        const mat = new MeshLambertMaterial({
          color: new Color().setHSL(0.55 + rand() * 0.1, 0.4, 0.65),
        });
        const box = new Mesh(geo, mat);
        box.position.set(
          (rand() - 0.5) * (WORLD_RADIUS * 1.2),
          FLOOR_Y + h / 2,
          (rand() - 0.5) * (WORLD_RADIUS * 1.2),
        );
        box.castShadow = true;
        box.receiveShadow = true;
        scene.add(box);
      }
    };

    makeWall(0, -WORLD_RADIUS, 0);
    makeWall(0, WORLD_RADIUS, 0);
    makeWall(-WORLD_RADIUS, 0, Math.PI / 2);
    makeWall(WORLD_RADIUS, 0, Math.PI / 2);
    makeObstacles();

    const pressed = {
      forward: false,
      backward: false,
      left: false,
      right: false,
    };

    const velocity = new Vector3();
    const direction = new Vector3();
    const lastPresenceSent = { time: 0 };
    const raycaster = new Raycaster();

    const randomSpawn = () => {
      const angle = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 10;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      return new Vector3(x, PLAYER_HEIGHT, z);
    };

    const spawnPos = randomSpawn();
    controls.object.position.copy(spawnPos);

    const colorHue = Math.random();
    const ownColor = new Color().setHSL(colorHue, 0.7, 0.55).getStyle();
    const name = `P${Math.floor(Math.random() * 900 + 100)}`;

    const gunBasePosition = new Vector3(0.6, -0.55, -1.05);
    const gunRecoilOffset = new Vector3(0.05, -0.05, -0.2);

    const gun = buildPlayerGun();
    gun.position.copy(gunBasePosition);
    gun.rotation.y = -0.2;
    gunRef.current = gun;
    camera.add(gun);

    const initialPresence: PresencePayload = {
      posX: spawnPos.x,
      posY: FLOOR_Y,
      posZ: spawnPos.z,
      rotY: 0,
      color: ownColor,
      name,
      alive: true,
      hp: MAX_HP,
      id: playerId,
    };

    presenceState.publishPresence?.(initialPresence);
    peersRef.current = peersRef.current || {};
    setSelfPresence(initialPresence);
    setHp(MAX_HP);

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case "KeyW":
        case "ArrowUp":
          pressed.forward = true;
          break;
        case "KeyS":
        case "ArrowDown":
          pressed.backward = true;
          break;
        case "KeyA":
        case "ArrowLeft":
          pressed.left = true;
          break;
        case "KeyD":
        case "ArrowRight":
          pressed.right = true;
          break;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case "KeyW":
        case "ArrowUp":
          pressed.forward = false;
          break;
        case "KeyS":
        case "ArrowDown":
          pressed.backward = false;
          break;
        case "KeyA":
        case "ArrowLeft":
          pressed.left = false;
          break;
        case "KeyD":
        case "ArrowRight":
          pressed.right = false;
          break;
      }
    };

    const findPlayerId = (obj: any): string | undefined => {
      let current = obj as any;
      while (current) {
        if (current.userData?.playerId) return current.userData.playerId;
        current = current.parent;
      }
      return undefined;
    };

    const handleShoot = () => {
      if (!controls.isLocked || isDead) return;
      const targetMeshes = [...remoteMeshesRef.current.values()];
      if (!targetMeshes.length) return;
      raycaster.setFromCamera(new Vector2(0, 0), camera);
      const hits = raycaster.intersectObjects(targetMeshes, true);
      if (!hits.length) return;
      const hit = hits[0].object;
      const targetId = findPlayerId(hit);
      if (!targetId) return;
      publishShot({
        targetId,
        damage: 1,
        shooterId: playerId,
      });
    };
    const playShotSound = () => {
      const ctx = audioRef.current;
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(1400, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.15);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    };

    const animate = () => {
      const delta = 1 / 60;
      const speed = controls.isLocked ? 25.0 : 0;

      velocity.x -= velocity.x * 8.0 * delta;
      velocity.z -= velocity.z * 8.0 * delta;

      direction.z = Number(pressed.forward) - Number(pressed.backward);
      direction.x = Number(pressed.right) - Number(pressed.left);
      direction.normalize();

      const activeSpeed = isDead ? 0 : speed;

      if (pressed.forward || pressed.backward)
        velocity.z -= direction.z * activeSpeed * delta;
      if (pressed.left || pressed.right)
        velocity.x -= direction.x * activeSpeed * delta;

      controls.moveRight(-velocity.x * delta);
      controls.moveForward(-velocity.z * delta);
      if (gunRef.current) {
        recoilRef.current = Math.max(0, recoilRef.current - delta * 6);
        const recoil = recoilRef.current;
        const targetPos = gunBasePosition
          .clone()
          .add(gunRecoilOffset.clone().multiplyScalar(recoil));
        gunRef.current.position.lerp(targetPos, 0.25);
        gunRef.current.rotation.x = -0.2 * recoil;
        gunRef.current.rotation.z = -0.12 * recoil;
      }

      const { x, z } = controls.object.position;
      const clamp = WORLD_RADIUS - 6;
      controls.object.position.set(
        Math.max(-clamp, Math.min(clamp, x)),
        PLAYER_HEIGHT,
        Math.max(-clamp, Math.min(clamp, z)),
      );

      const now = performance.now();
      if (
        controls.isLocked &&
        now - lastPresenceSent.time > 60 &&
        presenceState.publishPresence
      ) {
        presenceState.publishPresence?.({
          posX: controls.object.position.x,
          posY: FLOOR_Y,
          posZ: controls.object.position.z,
          rotY: controls.object.rotation.y,
          color: ownColor,
          name,
          alive: !isDead,
          hp,
          id: playerId,
        });
        lastPresenceSent.time = now;
      }

      const livePeers = peersRef.current;
      Object.entries(livePeers).forEach(([peerId, presence]) => {
        let mesh = remoteMeshesRef.current.get(peerId);
        if (!mesh) {
          mesh = createPlayerModel(presence.color);
          mesh.userData.playerId = presence.id;
          // HP bar
          const barBgGeo = new BoxGeometry(1.4, 0.12, 0.05);
          const barBgMat = new MeshLambertMaterial({ color: "#1b2c3f" });
          const barBg = new Mesh(barBgGeo, barBgMat);
          const barFgGeo = new BoxGeometry(1.4, 0.1, 0.04);
          const barFgMat = new MeshLambertMaterial({ color: "#2af26a" });
          const barFg = new Mesh(barFgGeo, barFgMat);
          const hpGroup = new Group();
          barFg.position.set(0, 0, 0.01);
          hpGroup.add(barBg);
          hpGroup.add(barFg);
          hpGroup.position.set(0, 3.1, 0);
          mesh.add(hpGroup);
          hpBarRefs.current.set(peerId, { bar: barFg, width: 1.4 });
          scene.add(mesh);
          remoteMeshesRef.current.set(peerId, mesh);
        }
        mesh.position.set(presence.posX, FLOOR_Y, presence.posZ);
        mesh.rotation.y = presence.rotY;
        mesh.visible = presence.alive !== false;
        mesh.scale.setScalar(1);
        if (!presence.alive) {
          mesh.visible = false;
          const hpEntry = hpBarRefs.current.get(peerId);
          if (hpEntry) {
            hpEntry.bar.visible = false;
          }
        }
        const hpEntry = hpBarRefs.current.get(peerId);
        if (hpEntry) {
          const ratio = Math.max(0, Math.min(1, presence.hp / MAX_HP));
          hpEntry.bar.scale.x = ratio;
          hpEntry.bar.position.x = -((1 - ratio) * hpEntry.width) / 2;
          hpEntry.bar.material = new MeshLambertMaterial({
            color: ratio > 0.5 ? "#2af26a" : ratio > 0.25 ? "#f7d046" : "#f2625d",
          });
        }
      });

      for (const [peerId, mesh] of remoteMeshesRef.current) {
        if (!livePeers[peerId]) {
          scene.remove(mesh);
          hpBarRefs.current.delete(peerId);
          remoteMeshesRef.current.delete(peerId);
        }
      }

      renderer.render(scene, camera);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    const handleClick = () => {
      if (!controls.isLocked) controls.lock();
    };

    const handlePointerLockError = () => {
      console.warn("Pointer lock not granted. Click the scene to enter.");
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    window.addEventListener("resize", handleResize);
    const handleShootClick = () => {
      recoilRef.current = 1;
      handleShoot();
      playShotSound();
    };

    renderer.domElement.addEventListener("click", handleClick);
    renderer.domElement.addEventListener("mousedown", handleShootClick);
    document.addEventListener("pointerlockerror", handlePointerLockError);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("click", handleClick);
      renderer.domElement.removeEventListener("mousedown", handleShootClick);
      document.removeEventListener("pointerlockerror", handlePointerLockError);
      animationRef.current && cancelAnimationFrame(animationRef.current);
      remoteMeshesRef.current.forEach((mesh) => {
        scene.remove(mesh);
        mesh.traverse((obj) => {
          if (obj instanceof Mesh) {
            obj.geometry.dispose();
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        });
      });
      if (gunRef.current) {
        gunRef.current.traverse((obj) => {
          if (obj instanceof Mesh) {
            obj.geometry.dispose();
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        });
        camera.remove(gunRef.current);
      }
      audioRef.current?.close();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      controls.dispose();
    };
  }, [room, presenceState.publishPresence, selectedMapId]);

  useEffect(() => {
    peersRef.current = presenceState?.peers || {};
    setPeers(peersRef.current);
    if (presenceState?.user) {
      setSelfPresence(presenceState.user);
    }
  }, [presenceState?.peers, presenceState?.user]);

  // Handle incoming shots and local HP/death/respawn
  room.useTopicEffect("shot", (data: any) => {
    if (!data || data.targetId !== playerId) return;
    if (isDead) return;
    setHp((prev) => {
      const next = Math.max(0, prev - (data.damage || 1));
      if (next <= 0) {
        setIsDead(true);
        presenceState.publishPresence?.({
          posX: controlsRef.current?.object.position.x || 0,
          posY: FLOOR_Y,
          posZ: controlsRef.current?.object.position.z || 0,
          rotY: controlsRef.current?.object.rotation.y || 0,
          color: selfPresence?.color || "#fff",
          name: selfPresence?.name || "Player",
          alive: false,
          hp: 0,
          id: playerId,
        });
        const respawn = () => {
          const angle = Math.random() * Math.PI * 2;
          const dist = 8 + Math.random() * 10;
          const x = Math.cos(angle) * dist;
          const z = Math.sin(angle) * dist;
          controlsRef.current?.object.position.set(x, PLAYER_HEIGHT, z);
          setHp(MAX_HP);
          setIsDead(false);
          presenceState.publishPresence?.({
            posX: x,
            posY: FLOOR_Y,
            posZ: z,
            rotY: 0,
            color: selfPresence?.color || "#fff",
            name: selfPresence?.name || "Player",
            alive: true,
            hp: MAX_HP,
            id: playerId,
          });
        };
        setTimeout(respawn, RESPAWN_MS);
      }
      return next;
    });
  });

  const maps = mapsData?.maps || [];
  const currentMap = maps.find((m) => m.id === selectedMapId) || maps[0];

  const loadingView = (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#0d1a2d] to-[#0a1020] text-white">
      Loading maps...
    </div>
  );

  if (!maps.length) {
    // Gracefully handle empty state without blocking the app
    return loadingView;
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#05060b] via-[#0a1222] to-[#0a0f1c] text-white overflow-hidden">
      <div className="absolute top-4 left-4 right-4 z-20">
        <div className="mb-3 text-xs tracking-[0.3em] uppercase text-cyan-300">
          Classic Map Rotation
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {maps.map((map) => {
            const active = map.id === selectedMapId;
            return (
              <button
                key={map.id}
                onClick={() => setSelectedMapId(map.id)}
                className={`relative overflow-hidden text-left border border-cyan-500/30 bg-gradient-to-br from-[#102036] to-[#0b1322] px-4 py-3 rounded-lg transition transform ${
                  active
                    ? "shadow-[0_10px_50px_rgba(0,255,255,0.25)] -translate-y-0.5"
                    : "hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(0,255,255,0.12)]"
                }`}
                style={{
                  clipPath:
                    "polygon(10% 0, 90% 0, 100% 25%, 100% 75%, 90% 100%, 10% 100%, 0 75%, 0 25%)",
                }}
              >
                <div className="text-lg font-semibold text-cyan-100">
                  {map.name}
                </div>
                <div className="text-xs text-cyan-300/70">
                  {active ? "Joined" : "Join room"}
                </div>
                <div className="absolute -bottom-6 -right-6 h-20 w-20 bg-cyan-500/10 rotate-12" />
              </button>
            );
          })}
        </div>
      </div>

      <div ref={mountRef} className="fixed inset-0 z-0" />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative h-10 w-10 flex items-center justify-center">
          <span className="block h-1 w-8 bg-cyan-400/70 rounded-full blur-[1px]" />
          <span className="absolute h-8 w-1 bg-cyan-400/70 rounded-full blur-[1px]" />
          <span className="absolute h-1 w-4 bg-cyan-200/80 rounded-full" />
          <span className="absolute h-4 w-1 bg-cyan-200/80 rounded-full" />
        </div>
      </div>

      <div className="pointer-events-none absolute left-6 bottom-6 space-y-3 text-sm max-w-xs">
        <div className="uppercase tracking-[0.2em] text-cyan-200 text-xs">
          Shared Range (Presence only)
        </div>
        <div className="text-lg font-semibold">
          Players online:{" "}
          <span className="text-cyan-300">
            {1 + Object.keys(peers || {}).length}
          </span>
        </div>
        <div className="text-cyan-100/70">
          Positions sync through Instant presence. Move to broadcast your spot.
        </div>
        <div className="text-xs text-white/50">
          Move: WASD · Look: Mouse · Click screen to lock cursor
        </div>
        {currentMap && (
          <div className="text-xs text-cyan-200">
            Map: {currentMap.name} · Room: {currentMap.id.slice(0, 6)}
          </div>
        )}
        {selfPresence && (
          <div className="text-xs text-cyan-300/80">
            You are {selfPresence.name} ({selfPresence.color}) · HP {hp}/
            {MAX_HP} {isDead ? "· Respawning..." : ""}
          </div>
        )}
      </div>

    </div>
  );
}

export default FPSPresenceArena;
