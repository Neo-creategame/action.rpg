import * as THREE from 'three';

const TILE_SIZE = 3.0; // ダンジョン1マスの大きさ（3.0m）
const BOX_SIZE = 2.0;  // 破壊可能ギミックブロックの大きさ
const HALF = BOX_SIZE / 2;
const BOX_GRAVITY = 0.012;
const EPS = 0.001;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.walls = [];         // すべての壁・ブロック（当たり判定対象）
    this.destructibles = []; // 破壊可能ブロック（重力計算対象）
    this.dungeonMeshes = []; // 階層切り替え時に破棄するメッシュ群
    this.hitEffects = [];

    this.portalMesh = null;
    this.portalPos = new THREE.Vector3();
    this.portalLocked = false;

    this.boxGeo = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);
    this.tileWallGeo = new THREE.BoxGeometry(TILE_SIZE, 4.5, TILE_SIZE);

    this.setupLights();
    this.createFloorTextures();
  }

  setupLights() {
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(35, 60, 35);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 160;
    const d = 55;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    this.scene.add(dirLight);

    const ambient = new THREE.AmbientLight(0x88aaff, 0.55);
    this.scene.add(ambient);
  }

  createFloorTextures() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1b202c';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, 256, 256);

    this.floorTex = new THREE.CanvasTexture(canvas);
    this.floorTex.wrapS = THREE.RepeatWrapping;
    this.floorTex.wrapT = THREE.RepeatWrapping;
    this.floorTex.repeat.set(32, 32);
  }

  clearDungeon() {
    for (const m of this.dungeonMeshes) {
      this.scene.remove(m);
    }
    this.dungeonMeshes = [];
    this.walls = [];
    this.destructibles = [];
    if (this.portalMesh) {
      this.scene.remove(this.portalMesh);
      this.portalMesh = null;
    }
  }

  // ---- 3Dダンジョン階層生成（index(1).htmlの部屋＆通路アルゴリズムを3D化） ----
  buildFloor(floor) {
    this.clearDungeon();
    const isBossFloor = floor % 5 === 0;

    // 広い床面
    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 140),
      new THREE.MeshStandardMaterial({ map: this.floorTex, roughness: 0.85 })
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);
    this.dungeonMeshes.push(floorMesh);

    const wallMat = new THREE.MeshStandardMaterial({
      color: isBossFloor ? 0x3b1e36 : 0x2a3244,
      roughness: 0.75
    });

    if (isBossFloor) {
      // ボス階層：巨大な円形・正方形アリーナ＋破壊可能魔力結晶柱
      const R = 10; // マス半径（30m四方）
      for (let gx = -R; gx <= R; gx++) {
        for (let gz = -R; gz <= R; gz++) {
          if (Math.abs(gx) === R || Math.abs(gz) === R) {
            this.addDungeonWall(gx * TILE_SIZE, gz * TILE_SIZE, wallMat);
          }
        }
      }

      // 破壊可能な魔力結晶柱（4隅に配置）
      const pillarCoords = [[-12, -12], [12, -12], [-12, 12], [12, 12]];
      for (const [px, pz] of pillarCoords) {
        for (let h = 0; h < 3; h++) {
          this.addDestructibleBlock(px, HALF + h * BOX_SIZE, pz, 0xb15cff, 45);
        }
      }

      this.createExitPortal(0, -21, true); // ボス撃破までロック
      return {
        playerStart: new THREE.Vector3(0, 0, 18),
        spawnPoints: [],
        bossPoint: { x: 0, z: -12 }
      };
    }

    // 通常ダンジョン階層（グリッド迷路生成）
    const W = 23;
    const H = 19;
    const grid = Array.from({ length: H }, () => Array(W).fill(1));
    const rooms = [];
    const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

    for (let t = 0; t < 35 && rooms.length < 6; t++) {
      const rw = randInt(4, 6);
      const rh = randInt(4, 6);
      const rx = randInt(1, W - rw - 2);
      const ry = randInt(1, H - rh - 2);
      if (rooms.some((r) => !(rx + rw + 1 < r.x || r.x + r.w + 1 < rx || ry + rh + 1 < r.y || r.y + r.h + 1 < ry))) continue;
      rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: Math.floor(rx + rw / 2), cy: Math.floor(ry + rh / 2) });
      for (let yy = ry; yy < ry + rh; yy++) {
        for (let xx = rx; xx < rx + rw; xx++) grid[yy][xx] = 0;
      }
    }

    // 部屋同士を通路で繋ぐ
    for (let i = 1; i < rooms.length; i++) {
      let x = rooms[i - 1].cx;
      let y = rooms[i - 1].cy;
      const tx = rooms[i].cx;
      const ty = rooms[i].cy;
      while (x !== tx) { grid[y][x] = 0; x += x < tx ? 1 : -1; }
      while (y !== ty) { grid[y][x] = 0; y += y < ty ? 1 : -1; }
    }

    const toWorldX = (gx) => (gx - Math.floor(W / 2)) * TILE_SIZE;
    const toWorldZ = (gy) => (gy - Math.floor(H / 2)) * TILE_SIZE;

    // 3D壁ブロック配置
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        if (grid[gy][gx] === 1) {
          this.addDungeonWall(toWorldX(gx), toWorldZ(gy), wallMat);
        }
      }
    }

    const startRoom = rooms[0];
    const endRoom = rooms[rooms.length - 1];
    this.createExitPortal(toWorldX(endRoom.cx), toWorldZ(endRoom.cy), false);

    // 各部屋に敵スポーン座標と破壊可能ブロック（障害物・落石ギミック）を配置
    const spawnPoints = [];
    for (let i = 1; i < rooms.length; i++) {
      const r = rooms[i];
      const count = 1 + Math.floor(Math.random() * 2);
      for (let c = 0; c < count; c++) {
        const sx = toWorldX(r.x + 1 + Math.floor(Math.random() * Math.max(1, r.w - 2)));
        const sz = toWorldZ(r.y + 1 + Math.floor(Math.random() * Math.max(1, r.h - 2)));
        spawnPoints.push({ x: sx, z: sz });
      }
      // 部屋に破壊可能クリスタルを配置
      if (Math.random() < 0.7) {
        const bx = toWorldX(r.cx) + 1.5;
        const bz = toWorldZ(r.cy) + 1.5;
        this.addDestructibleBlock(bx, HALF, bz, 0x4fd1c5, 25);
        this.addDestructibleBlock(bx, HALF + BOX_SIZE, bz, 0xffd36a, 25);
      }
    }

    return {
      playerStart: new THREE.Vector3(toWorldX(startRoom.cx), 0, toWorldZ(startRoom.cy)),
      spawnPoints,
      bossPoint: null
    };
  }

  addDungeonWall(x, z, material) {
    const mesh = new THREE.Mesh(this.tileWallGeo, material);
    mesh.position.set(x, 2.25, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      destructible: false,
      halfX: TILE_SIZE / 2,
      halfY: 2.25,
      halfZ: TILE_SIZE / 2
    };
    this.scene.add(mesh);
    this.dungeonMeshes.push(mesh);
    this.walls.push(mesh);
  }

  // 次階層への光の階段ポータル
  createExitPortal(x, z, locked) {
    this.portalPos.set(x, 0, z);
    this.portalLocked = locked;

    const geo = new THREE.CylinderGeometry(1.1, 1.3, 3.2, 20, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: locked ? 0xff2244 : 0x00ffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55
    });
    this.portalMesh = new THREE.Mesh(geo, mat);
    this.portalMesh.position.set(x, 1.6, z);
    this.scene.add(this.portalMesh);
  }

  unlockExitPortal() {
    this.portalLocked = false;
    if (this.portalMesh) {
      this.portalMesh.material.color.setHex(0x00ffff);
    }
  }

  // エンティティ（敵・弾）用の簡易壁判定
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

  // ---- 破壊可能ブロック＆重力連鎖崩壊システム ----
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

  update(dt) {
    if (this.portalMesh) {
      this.portalMesh.rotation.y += dt * 1.8;
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
