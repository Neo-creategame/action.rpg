import * as THREE from 'three';
import {
  rollWeapon, rollArmor, randomSlot, rollArtifact, addToPack, saveGame
} from './save.js';

const TILE_SIZE = 4.5;
const WALL_HEIGHT = 4.5;
const BOX_SIZE = 1.6;
const HALF = BOX_SIZE / 2;

export class World {
  constructor(scene, onToast) {
    this.scene = scene;
    this.onToast = onToast || (() => {});

    this.walls = [];
    this.destructibles = [];
    this.sparks = [];
    this.dungeonMeshes = [];
    this.interactables = [];
    this.traps = [];

    this.portalMesh = null;
    this.portalRing = null;
    this.portalPos = new THREE.Vector3();
    this.portalLocked = false;

    this.wallTex = this.createGridTexture('#1a202c', '#2d3748');
    this.floorTex = this.createGridTexture('#12161f', '#1e2636');
    this.boxTex = this.createGridTexture('#2c5282', '#63b3ed');
    this.goldTex = this.createGridTexture('#744210', '#ffd36a');
  }

  createGridTexture(bg, line) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = line;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 124, 124);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  clearDungeon() {
    for (const m of this.dungeonMeshes) this.scene.remove(m);
    this.dungeonMeshes = [];

    for (const w of this.walls) {
      if (!w.userData.isInstancedProxy) this.scene.remove(w);
    }
    this.walls = [];
    this.destructibles = [];
    this.interactables = [];
    this.traps = [];

    if (this.portalMesh) {
      this.scene.remove(this.portalMesh);
      this.portalMesh = null;
    }
    if (this.portalRing) {
      this.scene.remove(this.portalRing);
      this.portalRing = null;
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

    // 41×41 グリッド迷宮生成
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
      bossRoomCorners: null
    };
  }

  // ---- ボス階（X.5F）：開始部屋（8×8タイル）＋ボス部屋（22×20タイル）の2部屋固定生成 ----
  buildBossArena(floor) {
    const W = 26;
    const H = 34;
    const grid = Array.from({ length: H }, () => Array(W).fill(1));

    // 1. ボス部屋（北側：幅22タイル × 奥行き20タイル、x: 2..23, y: 2..21）
    for (let y = 2; y < 22; y++) {
      for (let x = 2; x < 24; x++) {
        grid[y][x] = 0;
      }
    }

    // 2. 連絡通路（x: 11..14, y: 22..23）
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

    // 開始部屋の中央にプレイヤー配置＆回復の泉
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

    // ボス部屋奥に封印された階段ポータル
    this.createExitPortal(toWorldX(12.5), toWorldZ(4), true);

    return {
      playerStart: new THREE.Vector3(startX, 0, startZ),
      spawnPoints: [],
      bossPoint: { x: toWorldX(12.5), z: toWorldZ(11) },
      bossRoomCorners
    };
  }

  buildInstancedDungeonWalls(positions, trimColor = 0x242c3d) {
    if (positions.length === 0) return;

    const wallGeo = new THREE.BoxGeometry(TILE_SIZE, WALL_HEIGHT, TILE_SIZE);
    const wallMat = new THREE.MeshStandardMaterial({ map: this.wallTex, roughness: 0.75 });
    const inst = new THREE.InstancedMesh(wallGeo, wallMat, positions.length);
    inst.castShadow = true;
    inst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const halfTile = TILE_SIZE / 2;

    positions.forEach((p, idx) => {
      dummy.position.set(p.x, WALL_HEIGHT / 2, p.z);
      dummy.updateMatrix();
      inst.setMatrixAt(idx, dummy.matrix);

      this.walls.push({
        position: new THREE.Vector3(p.x, WALL_HEIGHT / 2, p.z),
        userData: {
          isInstancedProxy: true,
          halfX: halfTile,
          halfY: WALL_HEIGHT / 2,
          halfZ: halfTile,
          destructible: false
        }
      });
    });

    inst.instanceMatrix.needsUpdate = true;
    this.scene.add(inst);
    this.dungeonMeshes.push(inst);

    const trimMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.25, 1),
      new THREE.MeshBasicMaterial({ color: trimColor })
    );
    trimMesh.visible = false;
    this.scene.add(trimMesh);
    this.dungeonMeshes.push(trimMesh);
  }

  buildElevatedPlatform(cx, cz, width, height, depth) {
    const platMat = new THREE.MeshStandardMaterial({ map: this.boxTex, roughness: 0.6 });
    const plat = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), platMat);
    plat.position.set(cx, height / 2, cz);
    plat.castShadow = true;
    plat.receiveShadow = true;
    plat.userData = { halfX: width / 2, halfY: height / 2, halfZ: depth / 2, destructible: false };
    this.scene.add(plat);
    this.walls.push(plat);

    const steps = 4;
    const stepH = height / steps;
    const stepD = 1.1;
    for (let i = 0; i < steps; i++) {
      const h = stepH * (i + 1);
      const step = new THREE.Mesh(new THREE.BoxGeometry(2.4, h, stepD), platMat);
      step.position.set(cx, h / 2, cz + depth / 2 + stepD * (steps - i - 0.5));
      step.castShadow = true;
      step.receiveShadow = true;
      step.userData = { halfX: 1.2, halfY: h / 2, halfZ: stepD / 2, destructible: false };
      this.scene.add(step);
      this.walls.push(step);
    }
  }

  spawnChest(x, y, z, isGrand, floor) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.75, 0.9),
      new THREE.MeshStandardMaterial({
        map: isGrand ? this.goldTex : this.boxTex,
        color: isGrand ? 0xffd36a : 0x8b5a2b,
        roughness: 0.4
      })
    );
    base.position.y = 0.38;
    base.castShadow = true;
    group.add(base);

    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(1.36, 0.25, 0.96),
      new THREE.MeshBasicMaterial({ color: isGrand ? 0xffe066 : 0x63b3ed })
    );
    lid.position.y = 0.82;
    group.add(lid);

    this.scene.add(group);
    this.dungeonMeshes.push(group);

    this.interactables.push({
      type: 'chest',
      mesh: group,
      lid,
      pos: new THREE.Vector3(x, y, z),
      opened: false,
      isGrand,
      floor
    });
  }

  spawnFountain(x, z) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const basin = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.5, 0.6, 16),
      new THREE.MeshStandardMaterial({ color: 0x2d3748, roughness: 0.6 })
    );
    basin.position.y = 0.3;
    group.add(basin);

    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 0.65, 16),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.75 })
    );
    water.position.y = 0.32;
    group.add(water);

    this.scene.add(group);
    this.dungeonMeshes.push(group);

    this.interactables.push({
      type: 'fountain',
      mesh: group,
      water,
      pos: new THREE.Vector3(x, 0, z),
      used: false
    });
  }

  spawnSpikeTrap(x, z, dmg) {
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.12, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x742a2a, emissive: 0xff1133, emissiveIntensity: 0.25 })
    );
    pad.position.set(x, 0.06, z);
    this.scene.add(pad);
    this.dungeonMeshes.push(pad);

    this.traps.push({
      pos: new THREE.Vector3(x, 0, z),
      radius: 1.4,
      dmg,
      cooldown: 0
    });
  }

  getNearbyInteractable(playerPos) {
    for (const item of this.interactables) {
      if (item.type === 'chest' && item.opened) continue;
      if (item.type === 'fountain' && item.used) continue;
      if (playerPos.distanceTo(item.pos) <= 2.6) {
        return item;
      }
    }
    return null;
  }

  triggerInteractable(item, player, maxHpVal) {
    if (item.type === 'chest' && !item.opened) {
      item.opened = true;
      item.lid.rotation.x = -0.7;
      item.lid.position.y = 1.05;
      this.spawnHitSpark(item.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), 0xffd36a);

      const r = Math.random();
      let loot = null;
      if (item.isGrand) {
        loot = r < 0.5 ? rollArtifact() : rollWeapon(['greatsword', 'spear', 'dual', 'spellbook', 'bow'][Math.floor(Math.random() * 5)], item.floor + 2);
      } else {
        loot = r < 0.45 ? rollWeapon(['sword', 'dual', 'bow'][Math.floor(Math.random() * 3)], item.floor) : rollArmor(randomSlot(), item.floor);
      }
      if (loot && addToPack(loot)) {
        this.onToast(`🎁 宝箱から【${loot.name || loot.label}】を入手！`);
        saveGame();
      } else {
        this.onToast('🎁 宝箱を開けた！（バッグ満杯）');
      }
    } else if (item.type === 'fountain' && !item.used) {
      item.used = true;
      item.water.material.color.setHex(0x4a5568);
      const heal = Math.round(maxHpVal * 0.5);
      player.hp = Math.min(maxHpVal, player.hp + heal);
      this.spawnHitSpark(item.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), 0x00ffff);
      this.onToast(`💧 回復の泉！HP +${heal} 回復`);
    }
  }

  createExitPortal(x, z, locked = false) {
    this.portalPos.set(x, 0, z);
    this.portalLocked = locked;

    const color = locked ? 0xff1144 : 0x00ffff;
    this.portalMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 0.25, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 })
    );
    this.portalMesh.position.set(x, 0.14, z);
    this.scene.add(this.portalMesh);

    this.portalRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.1, 10, 32),
      new THREE.MeshBasicMaterial({ color: locked ? 0xff4500 : 0x63b3ed })
    );
    this.portalRing.rotation.x = Math.PI / 2;
    this.portalRing.position.set(x, 1.3, z);
    this.scene.add(this.portalRing);
  }

  unlockExitPortal() {
    if (!this.portalLocked || !this.portalMesh) return;
    this.portalLocked = false;
    this.portalMesh.material.color.setHex(0x00ffff);
    this.portalRing.material.color.setHex(0x63b3ed);
    this.onToast('✨ 封印解除！奥のポータル（Fキー）から次の階へ進めます！');
  }

  addDestructibleBlock(x, y, z, color, hp) {
    const mat = new THREE.MeshStandardMaterial({
      map: color === 0xffd36a ? this.goldTex : this.boxTex,
      color,
      roughness: 0.4,
      emissive: color,
      emissiveIntensity: 0.18
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      halfX: HALF,
      halfY: HALF,
      halfZ: HALF,
      destructible: true,
      hp,
      maxHp: hp,
      color
    };
    this.scene.add(mesh);
    this.walls.push(mesh);
    this.destructibles.push(mesh);
  }

  damageBlock(block, dmg) {
    if (!block.userData.destructible) return;
    block.userData.hp -= dmg;
    this.spawnHitSpark(block.position, block.userData.color);
    block.material.emissiveIntensity = 0.85;
    setTimeout(() => {
      if (block.material) block.material.emissiveIntensity = 0.18;
    }, 80);

    if (block.userData.hp <= 0) {
      this.destroyBlock(block);
    }
  }

  destroyBlock(block) {
    const pos = block.position.clone();
    const color = block.userData.color;
    for (let i = 0; i < 14; i++) {
      this.spawnHitSpark(pos, color);
    }
    this.scene.remove(block);
    this.walls = this.walls.filter((w) => w !== block);
    this.destructibles = this.destructibles.filter((d) => d !== block);
  }

  spawnHitSpark(pos, color = 0x00ffff) {
    const geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);

    this.sparks.push({
      mesh,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 0.25,
        Math.random() * 0.2 + 0.08,
        (Math.random() - 0.5) * 0.25
      ),
      life: 0.42
    });
  }

  isBlockedForEntity(x, z, radius = 0.5) {
    for (const wall of this.walls) {
      const hx = wall.userData.halfX || HALF;
      const hy = wall.userData.halfY || HALF;
      const hz = wall.userData.halfZ || HALF;
      if (wall.position.y - hy > 1.8) continue;
      if (x > wall.position.x - hx - radius && x < wall.position.x + hx + radius &&
          z > wall.position.z - hz - radius && z < wall.position.z + hz + radius) {
        return true;
      }
    }
    return false;
  }

  update(dt, player = null) {
    if (this.portalRing) {
      this.portalRing.rotation.z += dt * 1.8;
      this.portalRing.position.y = 1.25 + Math.sin(performance.now() * 0.004) * 0.2;
    }

    if (player) {
      for (const trap of this.traps) {
        if (trap.cooldown > 0) {
          trap.cooldown -= dt;
          continue;
        }
        if (player.root.position.y < 0.4 && player.root.position.distanceTo(trap.pos) <= trap.radius) {
          trap.cooldown = 1.2;
          player.receiveEnemyAttack(trap.dmg, trap.pos);
        }
      }
    }

    this.sparks = this.sparks.filter((s) => {
      s.vel.y -= 0.012;
      s.mesh.position.add(s.vel);
      s.mesh.rotation.x += 0.15;
      s.mesh.rotation.y += 0.15;
      s.life -= dt;
      s.mesh.scale.setScalar(Math.max(0.01, s.life * 2.2));
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        return false;
      }
      return true;
    });
  }
}
