import * as THREE from 'three';
import {
  PLAYER, POTIONS, addToPack, rollWeapon, rollArmor, randomSlot,
  rollArtifact, createPotion, saveGame
} from './save.js';

const TILE_SIZE = 4.5; // 1マス4.5m（カメラが引っかからず大剣が振れる広さ）
const WALL_HEIGHT = 6.0;
const BOX_SIZE = 2.0;
const HALF = BOX_SIZE / 2;
const BOX_GRAVITY = 0.012;
const EPS = 0.001;

export class World {
  constructor(scene, onToast) {
    this.scene = scene;
    this.onToast = onToast || (() => {});

    this.walls = [];         // すべての壁・高台・ブロック（当たり判定対象）
    this.destructibles = []; // 破壊可能結晶ブロック
    this.dungeonMeshes = []; // 階層切り替え時に破棄するメッシュ群
    this.interactables = []; // 宝箱・回復の泉
    this.traps = [];         // トゲ罠
    this.hitEffects = [];

    this.portalMesh = null;
    this.portalPos = new THREE.Vector3();
    this.portalLocked = false;

    this.boxGeo = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);

    this.setupLights();
    this.createTextures();
  }

  setupLights() {
    const dirLight = new THREE.DirectionalLight(0xcce0ff, 1.05);
    dirLight.position.set(50, 85, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 220;
    const d = 80;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    this.scene.add(dirLight);

    const ambient = new THREE.AmbientLight(0x7090d0, 0.65);
    this.scene.add(ambient);
  }

  createTextures() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#161b26';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#252f42';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, 256, 256);
    ctx.fillStyle = '#1c2331';
    ctx.fillRect(16, 16, 224, 224);

    this.floorTex = new THREE.CanvasTexture(canvas);
    this.floorTex.wrapS = THREE.RepeatWrapping;
    this.floorTex.wrapT = THREE.RepeatWrapping;
    this.floorTex.repeat.set(48, 48);
  }

  clearDungeon() {
    for (const m of this.dungeonMeshes) {
      this.scene.remove(m);
    }
    this.dungeonMeshes = [];
    this.walls = [];
    this.destructibles = [];
    this.interactables = [];
    this.traps = [];
    if (this.portalMesh) {
      this.scene.remove(this.portalMesh);
      this.portalMesh = null;
    }
  }

  // ---- 広大＆立体3Dダンジョン生成（通常階 / ボス階 X.5F 分岐） ----
  buildFloor(floor, isBossFloor = false) {
    this.clearDungeon();

    // 広大な石畳フロア（240m × 240m）
    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshStandardMaterial({ map: this.floorTex, roughness: 0.85 })
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);
    this.dungeonMeshes.push(floorMesh);

    if (isBossFloor) {
      return this.buildBossArena(floor);
    }

    // 以下、通常の41×41迷宮生成（フェーズ5と同一）
    const W = 41;
    const H = 41;
    const grid = Array.from({ length: H }, () => Array(W).fill(1));
    const rooms = [];
    const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

    for (let t = 0; t < 90 && rooms.length < 12; t++) {
      const isGrand = rooms.length === 2 || rooms.length === 5;
      const rw = isGrand ? randInt(6, 8) : randInt(3, 5);
      const rh = isGrand ? randInt(6, 8) : randInt(3, 5);
      const rx = randInt(2, W - rw - 3);
      const ry = randInt(2, H - rh - 3);

      if (rooms.some((r) => !(rx + rw + 2 < r.x || r.x + r.w + 2 < rx || ry + rh + 2 < r.y || r.y + r.h + 2 < ry))) {
        continue;
      }

      const room = {
        x: rx, y: ry, w: rw, h: rh,
        cx: Math.floor(rx + rw / 2),
        cy: Math.floor(ry + rh / 2),
        isGrand
      };
      rooms.push(room);

      for (let yy = ry; yy < ry + rh; yy++) {
        for (let xx = rx; xx < rx + rw; xx++) {
          grid[yy][xx] = 0;
        }
      }
    }

    const carveCorridor = (x1, y1, x2, y2, width = 1) => {
      let x = x1;
      let y = y1;
      const carveCell = (cx, cy) => {
        for (let dy = 0; dy < width; dy++) {
          for (let dx = 0; dx < width; dx++) {
            if (grid[cy + dy] && grid[cy + dy][cx + dx] !== undefined) {
              grid[cy + dy][cx + dx] = 0;
            }
          }
        }
      };

      if (Math.random() < 0.5) {
        while (x !== x2) { carveCell(x, y); x += x < x2 ? 1 : -1; }
        while (y !== y2) { carveCell(x, y); y += y < y2 ? 1 : -1; }
      } else {
        while (y !== y2) { carveCell(x, y); y += y < y2 ? 1 : -1; }
        while (x !== x2) { carveCell(x, y); x += x < x2 ? 1 : -1; }
      }
      carveCell(x2, y2);
    };

    for (let i = 1; i < rooms.length; i++) {
      carveCorridor(rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy, 1);
      if (i >= 2 && Math.random() < 0.45) {
        const other = rooms[randInt(0, i - 2)];
        carveCorridor(rooms[i].cx, rooms[i].cy, other.cx, other.cy, 1);
      }
    }

    const toWorldX = (gx) => (gx - Math.floor(W / 2)) * TILE_SIZE;
    const toWorldZ = (gy) => (gy - Math.floor(H / 2)) * TILE_SIZE;

    const wallPositions = [];
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        if (grid[gy][gx] === 1) {
          const hasOpenNeighbor =
            (grid[gy - 1]?.[gx] === 0) || (grid[gy + 1]?.[gx] === 0) ||
            (grid[gy]?.[gx - 1] === 0) || (grid[gy]?.[gx + 1] === 0) ||
            (grid[gy - 1]?.[gx - 1] === 0) || (grid[gy - 1]?.[gx + 1] === 0) ||
            (grid[gy + 1]?.[gx - 1] === 0) || (grid[gy + 1]?.[gx + 1] === 0);

          if (hasOpenNeighbor) {
            wallPositions.push({ x: toWorldX(gx), z: toWorldZ(gy) });
          }
        }
      }
    }

    this.buildInstancedDungeonWalls(wallPositions, 0x242c3d);

    const startRoom = rooms[0];
    const endRoom = rooms[rooms.length - 1];
    this.createExitPortal(toWorldX(endRoom.cx), toWorldZ(endRoom.cy), false);

    const spawnPoints = [];
    for (let i = 1; i < rooms.length; i++) {
      const r = rooms[i];
      const rcx = toWorldX(r.cx);
      const rcz = toWorldZ(r.cy);

      if (r.isGrand) {
        this.buildElevatedPlatform(rcx, rcz, 7.0, 2.0, 7.0);
        this.spawnChest(rcx, 2.0, rcz, true, floor);
      } else {
        const roll = Math.random();
        if (roll < 0.35 && r !== endRoom) {
          this.spawnChest(rcx, 0, rcz, false, floor);
        } else if (roll < 0.55 && r !== endRoom) {
          this.spawnFountain(rcx, rcz);
        }
      }

      const mobCount = r.isGrand ? randInt(2, 4) : randInt(1, 2);
      for (let c = 0; c < mobCount; c++) {
        const sx = toWorldX(r.x + 1 + Math.floor(Math.random() * Math.max(1, r.w - 2)));
        const sz = toWorldZ(r.y + 1 + Math.floor(Math.random() * Math.max(1, r.h - 2)));
        spawnPoints.push({ x: sx, z: sz });
      }

      if (!r.isGrand && r !== endRoom && Math.random() < 0.35) {
        const tx = toWorldX(r.x + 1);
        const tz = toWorldZ(r.y + 1);
        this.spawnSpikeTrap(tx, tz, 14 + floor * 3);
      }

      if (Math.random() < 0.55) {
        const bx = toWorldX(r.x + r.w - 1);
        const bz = toWorldZ(r.y + 1);
        this.addDestructibleBlock(bx, HALF, bz, 0x4fd1c5, 25);
        this.addDestructibleBlock(bx, HALF + BOX_SIZE, bz, 0xffd36a, 25);
      }
    }

    return {
      playerStart: new THREE.Vector3(toWorldX(startRoom.cx), 0, toWorldZ(startRoom.cy)),
      spawnPoints,
      bossPoint: null,
      bossRoomBounds: null
    };
  }

  // ---- ボス階（X.5F）：開始部屋（8×8タイル）＋ボス部屋（22×20タイル）の2部屋固定生成 ----
  buildBossArena(floor) {
    // グリッド上で2部屋と連絡通路を作成（1タイル = TILE_SIZE = 4.5m）
    const W = 26;
    const H = 34;
    const grid = Array.from({ length: H }, () => Array(W).fill(1));

    // 1. ボス部屋（北側：幅22タイル × 奥行き20タイル、x: 2..23, y: 2..21）
    for (let y = 2; y < 22; y++) {
      for (let x = 2; x < 24; x++) {
        grid[y][x] = 0;
      }
    }

    // 2. 連絡通路（幅3タイル、x: 11..13, y: 22..23）
    for (let y = 22; y < 24; y++) {
      for (let x = 11; x <= 14; x++) {
        grid[y][x] = 0;
      }
    }

    // 3. 開始部屋（南側：8×8タイル、x: 9..16, y: 24..31）
    for (let y = 24; y < 32; y++) {
      for (let x = 9; x < 17; x++) {
        grid[y][x] = 0;
      }
    }

    const toWorldX = (gx) => (gx - 12.5) * TILE_SIZE;
    const toWorldZ = (gy) => (gy - 16.0) * TILE_SIZE;

    const wallPositions = [];
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        if (grid[gy][gx] === 1) {
          const hasOpenNeighbor =
            (grid[gy - 1]?.[gx] === 0) || (grid[gy + 1]?.[gx] === 0) ||
            (grid[gy]?.[gx - 1] === 0) || (grid[gy]?.[gx + 1] === 0) ||
            (grid[gy - 1]?.[gx - 1] === 0) || (grid[gy - 1]?.[gx + 1] === 0) ||
            (grid[gy + 1]?.[gx - 1] === 0) || (grid[gy + 1]?.[gx + 1] === 0);

          if (hasOpenNeighbor) {
            wallPositions.push({ x: toWorldX(gx), z: toWorldZ(gy) });
          }
        }
      }
    }

    this.buildInstancedDungeonWalls(wallPositions, 0x3b1832);

    // 開始部屋の中央（x: 12.5, y: 28）にプレイヤー配置＆回復の泉
    const startX = toWorldX(12.5);
    const startZ = toWorldZ(28);
    this.spawnFountain(startX - 6, startZ);

    // ボス部屋の四隅座標（無敵バリアの魔力結晶4体召喚用）
    const bossRoomCorners = [
      { x: toWorldX(4),  z: toWorldZ(4) },
      { x: toWorldX(21), z: toWorldZ(4) },
      { x: toWorldX(4),  z: toWorldZ(19) },
      { x: toWorldX(21), z: toWorldZ(19) }
    ];

    // ボス部屋奥（x: 12.5, y: 4）に封印された階段ポータル
    this.createExitPortal(toWorldX(12.5), toWorldZ(4), true);

    return {
      playerStart: new THREE.Vector3(startX, 0, startZ),
      spawnPoints: [],
      bossPoint: { x: toWorldX(12.5), z: toWorldZ(11) },
      bossRoomCorners
    };
  }
    this.buildInstancedDungeonWalls(wallPositions, 0x3b1832);

    // 4隅に高台と破壊可能魔力結晶柱
    const corners = [[-16, -16], [16, -16], [-16, 16], [16, 16]];
    for (const [cx, cz] of corners) {
      for (let h = 0; h < 3; h++) {
        this.addDestructibleBlock(cx, HALF + h * BOX_SIZE, cz, 0xb15cff, 50);
      }
    }

    // ボス戦前の回復の泉を入口付近に1つ配置
    this.spawnFountain(-8, 26);

    this.createExitPortal(0, -32, true);
    return {
      playerStart: new THREE.Vector3(0, 0, 28),
      spawnPoints: [],
      bossPoint: { x: 0, z: -16 }
    };
  }

  // ---- InstancedMeshによる高速な壁一括生成 ----
  buildInstancedDungeonWalls(positions, colorHex) {
    if (positions.length === 0) return;

    const geo = new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, TILE_SIZE);
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.72,
      metalness: 0.1
    });

    const instMesh = new THREE.InstancedMesh(geo, mat, positions.length);
    instMesh.castShadow = true;
    instMesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    positions.forEach((pos, idx) => {
      dummy.position.set(pos.x, WALL_HEIGHT / 2, pos.z);
      dummy.updateMatrix();
      instMesh.setMatrixAt(idx, dummy.matrix);

      // 当たり判定用の軽量オブジェクトをwalls配列に登録
      this.walls.push({
        position: new THREE.Vector3(pos.x, WALL_HEIGHT / 2, pos.z),
        userData: {
          destructible: false,
          halfX: TILE_SIZE / 2,
          halfY: WALL_HEIGHT / 2,
          halfZ: TILE_SIZE / 2
        }
      });
    });

    instMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(instMesh);
    this.dungeonMeshes.push(instMesh);
  }

  // ---- 立体ギミック：登れる高台＆階段ステップ ----
  buildElevatedPlatform(x, z, width, height, depth) {
    const platMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 });
    const platMesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), platMat);
    platMesh.position.set(x, height / 2, z);
    platMesh.castShadow = true;
    platMesh.receiveShadow = true;
    platMesh.userData = {
      destructible: false,
      halfX: width / 2,
      halfY: height / 2,
      halfZ: depth / 2
    };
    this.scene.add(platMesh);
    this.dungeonMeshes.push(platMesh);
    this.walls.push(platMesh);

    // 登るための階段ステップ（高さ1.0m）を南側に配置
    const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(3.0, height * 0.5, 2.0), platMat);
    stepMesh.position.set(x, height * 0.25, z + depth / 2 + 1.0);
    stepMesh.castShadow = true;
    stepMesh.receiveShadow = true;
    stepMesh.userData = {
      destructible: false,
      halfX: 1.5,
      halfY: height * 0.25,
      halfZ: 1.0
    };
    this.scene.add(stepMesh);
    this.dungeonMeshes.push(stepMesh);
    this.walls.push(stepMesh);
  }

  // ---- ギミック1：宝箱（通常 / レア） ----
  spawnChest(x, y, z, isRare, floor) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.85, 0.9),
      new THREE.MeshStandardMaterial({
        color: isRare ? 0xffd36a : 0xb7791f,
        emissive: isRare ? 0xffa500 : 0x442200,
        emissiveIntensity: isRare ? 0.35 : 0.15,
        metalness: 0.5,
        roughness: 0.3
      })
    );
    body.position.y = 0.425;
    body.castShadow = true;
    group.add(body);

    const band = new THREE.Mesh(
      new THREE.BoxGeometry(1.34, 0.15, 0.94),
      new THREE.MeshBasicMaterial({ color: isRare ? 0x00ffff : 0xffd36a })
    );
    band.position.y = 0.65;
    group.add(band);

    this.scene.add(group);
    this.dungeonMeshes.push(group);

    this.interactables.push({
      type: 'chest',
      mesh: group,
      pos: new THREE.Vector3(x, y, z),
      opened: false,
      isRare,
      floor,
      label: isRare ? '[F] 黄金のレア宝箱を開ける' : '[F] 宝箱を開ける'
    });
  }

  // ---- ギミック2：回復の泉 ----
  spawnFountain(x, z) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.6, 0.4, 16),
      new THREE.MeshStandardMaterial({ color: 0x4a5568 })
    );
    base.position.y = 0.2;
    group.add(base);

    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.45, 16),
      new THREE.MeshBasicMaterial({ color: 0x48bb78, transparent: true, opacity: 0.8 })
    );
    water.position.y = 0.22;
    group.add(water);

    this.scene.add(group);
    this.dungeonMeshes.push(group);

    this.interactables.push({
      type: 'fountain',
      mesh: group,
      waterMesh: water,
      pos: new THREE.Vector3(x, 0, z),
      used: false,
      label: '[F] 回復の泉を飲む (HP50%回復)'
    });
  }

  // ---- ギミック3：周期トゲ罠 ----
  spawnSpikeTrap(x, z, dmg) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.08, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x2d3748 })
    );
    plate.position.y = 0.04;
    group.add(plate);

    const spikes = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 1.1, 6),
      new THREE.MeshBasicMaterial({ color: 0xff2244 })
    );
    spikes.position.y = -0.5;
    group.add(spikes);

    this.scene.add(group);
    this.dungeonMeshes.push(group);

    this.traps.push({
      pos: new THREE.Vector3(x, 0, z),
      spikes,
      timer: Math.random() * 3.0,
      active: false,
      dmg
    });
  }

  // ---- プレイヤーが近づいているギミックを取得 ----
  getNearbyInteractable(playerPos) {
    for (const item of this.interactables) {
      if (item.type === 'chest' && item.opened) continue;
      if (item.type === 'fountain' && item.used) continue;
      const dist = playerPos.distanceTo(item.pos);
      if (dist <= 2.6) return item;
    }
    return null;
  }

  // ---- Fキーでのギミック実行 ----
  triggerInteractable(item, player, maxHpVal) {
    if (!item) return false;

    if (item.type === 'chest' && !item.opened) {
      item.opened = true;
      item.mesh.scale.set(1, 0.55, 1); // 開いた見た目に変形
      this.spawnHitSpark(item.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 0xffd36a);

      const gold = (120 + item.floor * 45) * (item.isRare ? 3 : 1);
      PLAYER.gold += gold;

      const r = Math.random();
      let rewardName = `${gold}G`;
      if (item.isRare || r < 0.45) {
        const wTypes = ['sword', 'dual', 'bow', 'greatsword', 'spear'];
        const w = rollWeapon(wTypes[Math.floor(Math.random() * wTypes.length)], item.floor + (item.isRare ? 2 : 0));
        if (addToPack(w)) rewardName += ` + ${w.name}`;
      } else if (r < 0.75) {
        const a = rollArmor(randomSlot(), item.floor);
        if (addToPack(a)) rewardName += ` + ${a.label}`;
      } else if (r < 0.90) {
        const art = rollArtifact();
        if (addToPack(art)) rewardName += ` + 遺物【${art.name}】`;
      } else {
        const pot = createPotion('full', 1);
        if (!addToPack(pot)) POTIONS.full++;
        rewardName += ' + 全回復ポーション';
      }

      this.onToast(`🎁 宝箱獲得: ${rewardName}`);
      saveGame();
      return true;
    }

    if (item.type === 'fountain' && !item.used) {
      item.used = true;
      item.waterMesh.material.color.setHex(0x4a5568);
      const heal = Math.round(maxHpVal * 0.5);
      player.hp = Math.min(maxHpVal, player.hp + heal);
      this.spawnHitSpark(item.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), 0x48bb78);
      this.onToast(`💧 回復の泉: HP +${heal} 回復！`);
      return true;
    }

    return false;
  }

  createExitPortal(x, z, locked) {
    this.portalPos.set(x, 0, z);
    this.portalLocked = locked;

    const geo = new THREE.CylinderGeometry(1.3, 1.5, 4.0, 24, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: locked ? 0xff2244 : 0x00ffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6
    });
    this.portalMesh = new THREE.Mesh(geo, mat);
    this.portalMesh.position.set(x, 2.0, z);
    this.scene.add(this.portalMesh);
  }

  unlockExitPortal() {
    this.portalLocked = false;
    if (this.portalMesh) {
      this.portalMesh.material.color.setHex(0x00ffff);
    }
  }

  isBlockedForEntity(x, z, radius) {
    for (const w of this.walls) {
      const hx = w.userData.halfX || HALF;
      const hz = w.userData.halfZ || HALF;
      if (Math.abs(x - w.position.x) < hx + radius && Math.abs(z - w.position.z) < hz + radius) {
        return true;
      }
    }
    return false;
  }

  // ---- 破壊可能ブロック＆重力連鎖崩壊 ----
  addDestructibleBlock(x, y, z, color = 0x4fd1c5, hp = 30) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.2,
      roughness: 0.4
    });
    const mesh = new THREE.Mesh(this.boxGeo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      destructible: true,
      halfX: HALF,
      halfY: HALF,
      halfZ: HALF,
      hp,
      maxHp: hp,
      velocityY: 0,
      isFalling: false,
      sideHeld: false
    };

    this.scene.add(mesh);
    this.dungeonMeshes.push(mesh);
    this.walls.push(mesh);
    this.destructibles.push(mesh);

    const supportY = this.getBoxGroundY(mesh, mesh.position.y - BOX_GRAVITY);
    if (supportY !== null) {
      mesh.position.y = supportY + HALF;
    } else if (this.hasStableSupport(mesh)) {
      mesh.userData.sideHeld = true;
    } else {
      mesh.userData.isFalling = true;
      mesh.userData.velocityY = -BOX_GRAVITY;
    }
    return mesh;
  }

  damageBlock(box, dmg) {
    if (!box.userData.destructible) return false;
    box.userData.hp -= dmg;
    const orig = box.material.emissiveIntensity;
    box.material.emissiveIntensity = 0.95;
    setTimeout(() => { if (box.material) box.material.emissiveIntensity = orig; }, 80);

    this.spawnHitSpark(box.position, box.material.color.getHex());
    if (box.userData.hp <= 0) {
      this.destroyBlock(box);
      return true;
    }
    return false;
  }

  destroyBlock(box) {
    const pos = box.position.clone();
    const col = box.material.color.getHex();
    this.scene.remove(box);
    this.walls = this.walls.filter((w) => w !== box);
    this.destructibles = this.destructibles.filter((d) => d !== box);

    for (let i = 0; i < 8; i++) this.spawnHitSpark(pos, col);
    this.wakeBoxesAfterRemoval(box);
  }

  spawnHitSpark(pos, color = 0x00ffff) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.24, 0.24),
      new THREE.MeshBasicMaterial({ color })
    );
    mesh.position.copy(pos).add(new THREE.Vector3(
      (Math.random() - 0.5) * 1.1,
      (Math.random() - 0.5) * 1.1,
      (Math.random() - 0.5) * 1.1
    ));
    this.scene.add(mesh);
    this.hitEffects.push({
      mesh,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.16, Math.random() * 0.14 + 0.04, (Math.random() - 0.5) * 0.16),
      life: 0.35
    });
  }

  getBoxGroundY(box, nextY) {
    const currentBottom = box.position.y - HALF;
    const nextBottom = nextY - HALF;
    let supportY = null;
    if (currentBottom >= -EPS && nextBottom <= EPS) supportY = 0;

    const bMinX = box.position.x - HALF, bMaxX = box.position.x + HALF;
    const bMinZ = box.position.z - HALF, bMaxZ = box.position.z + HALF;

    for (const other of this.walls) {
      if (other === box) continue;
      const hx = other.userData.halfX || HALF;
      const hy = other.userData.halfY || HALF;
      const hz = other.userData.halfZ || HALF;
      if (bMaxX <= other.position.x - hx || bMinX >= other.position.x + hx) continue;
      if (bMaxZ <= other.position.z - hz || bMinZ >= other.position.z + hz) continue;

      const otherTop = other.position.y + hy;
      if (currentBottom >= otherTop - EPS && nextBottom <= otherTop + EPS) {
        if (supportY === null || otherTop > supportY) supportY = otherTop;
      }
    }
    return supportY;
  }

  hasStableSupport(box, visited = new Set()) {
    if (visited.has(box)) return false;
    visited.add(box);
    if (this.getBoxGroundY(box, box.position.y - BOX_GRAVITY) !== null) return true;

    for (const other of this.walls) {
      if (other === box || other.userData.isFalling) continue;
      const dx = Math.abs(other.position.x - box.position.x);
      const dz = Math.abs(other.position.z - box.position.z);
      const hy = other.userData.halfY || HALF;
      if ((box.position.y + HALF) <= (other.position.y - hy) + EPS || (box.position.y - HALF) >= (other.position.y + hy) - EPS) continue;

      const sideTouch =
        (Math.abs(dx - BOX_SIZE) <= EPS && dz < BOX_SIZE - EPS) ||
        (Math.abs(dz - BOX_SIZE) <= EPS && dx < BOX_SIZE - EPS);
      if (sideTouch && this.hasStableSupport(other, visited)) return true;
    }
    return false;
  }

  wakeBox(box) {
    if (!box.userData.destructible) return;
    const supportY = this.getBoxGroundY(box, box.position.y - BOX_GRAVITY);
    if (supportY !== null) {
      box.position.y = supportY + HALF;
      box.userData.velocityY = 0;
      box.userData.isFalling = false;
      box.userData.sideHeld = false;
      return;
    }
    if (this.hasStableSupport(box)) {
      box.userData.sideHeld = true;
      box.userData.velocityY = 0;
      box.userData.isFalling = false;
      return;
    }
    box.userData.sideHeld = false;
    box.userData.isFalling = true;
    box.userData.velocityY = -BOX_GRAVITY;
  }

  wakeBoxesAfterRemoval(removed) {
    const queue = [removed];
    const checked = new Set();
    while (queue.length > 0) {
      const center = queue.shift();
      if (checked.has(center)) continue;
      checked.add(center);
      for (const box of this.destructibles) {
        if (checked.has(box)) continue;
        if (box.position.distanceTo(center.position) > 8.5) continue;
        const oldY = box.position.y;
        const oldFalling = box.userData.isFalling;
        if (!oldFalling) this.wakeBox(box);
        if (oldY !== box.position.y || oldFalling !== box.userData.isFalling) queue.push(box);
      }
    }
  }

  update(dt, player) {
    if (this.portalMesh) {
      this.portalMesh.rotation.y += dt * 1.8;
    }

    // トゲ罠の周期作動＆プレイヤーダメージ判定
    for (const trap of this.traps) {
      trap.timer = (trap.timer + dt) % 3.2;
      trap.active = trap.timer > 2.1;
      trap.spikes.position.y = trap.active ? 0.55 : -0.45;

      if (trap.active && player) {
        const d = Math.hypot(player.root.position.x - trap.pos.x, player.root.position.z - trap.pos.z);
        if (d < 1.35 && player.root.position.y < 0.8) {
          player.receiveEnemyAttack(trap.dmg, trap.pos);
        }
      }
    }

    for (const box of this.destructibles) {
      if (box.userData.sideHeld && !box.userData.isFalling) {
        if (!this.hasStableSupport(box)) {
          box.userData.sideHeld = false;
          box.userData.isFalling = true;
          box.userData.velocityY = -BOX_GRAVITY;
        } else continue;
      }
      if (box.userData.velocityY === 0 && !box.userData.isFalling) continue;
      if (box.userData.isFalling) box.userData.velocityY -= BOX_GRAVITY;

      const nextY = box.position.y + box.userData.velocityY;
      const groundY = this.getBoxGroundY(box, nextY);
      if (groundY !== null) {
        box.position.y = groundY + HALF;
        box.userData.velocityY = 0;
        box.userData.isFalling = false;
        box.userData.sideHeld = false;
      } else {
        box.position.y = nextY;
        box.userData.isFalling = true;
      }
    }

    this.hitEffects = this.hitEffects.filter((fx) => {
      fx.life -= dt;
      fx.vel.y -= 0.008;
      fx.mesh.position.add(fx.vel);
      fx.mesh.scale.setScalar(Math.max(0.01, fx.life / 0.35));
      if (fx.life <= 0) {
        this.scene.remove(fx.mesh);
        fx.mesh.geometry.dispose();
        fx.mesh.material.dispose();
        return false;
      }
      return true;
    });
  }
}
