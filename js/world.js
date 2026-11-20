import * as THREE from 'three';

const BOX_SIZE = 2.0;
const HALF = BOX_SIZE / 2;
const BOX_GRAVITY = 0.012;
const EPS = 0.001;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.walls = [];        // すべての壁・ブロック（当たり判定対象）
    this.destructibles = []; // 破壊可能ブロック（重力計算対象）
    this.hitEffects = [];    // 斬撃・破壊パーティクル

    this.boxGeo = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);

    this.setupLights();
    this.buildArena();
    this.spawnTestGimmicks();
  }

  setupLights() {
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(25, 45, 25);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 120;
    const d = 40;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    this.scene.add(dirLight);

    const ambient = new THREE.AmbientLight(0x88aaff, 0.45);
    this.scene.add(ambient);
  }

  buildArena() {
    // グリッド模様の床（SAO/ZZZの訓練場・ダンジョン風）
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1b202c';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, 512, 512);
    ctx.strokeStyle = '#232938';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(256, 0); ctx.lineTo(256, 512);
    ctx.moveTo(0, 256); ctx.lineTo(512, 256);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(20, 20);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 外周の壊せない壁（アリーナ境界）
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x333b4d, roughness: 0.7 });
    const range = 36;
    for (let i = -range; i <= range; i += BOX_SIZE) {
      for (let h = 0; h < 3; h++) {
        const y = HALF + h * BOX_SIZE;
        this.addStaticBlock(i, y, -range, wallMat);
        this.addStaticBlock(i, y, range, wallMat);
        if (i > -range && i < range) {
          this.addStaticBlock(-range, y, i, wallMat);
          this.addStaticBlock(range, y, i, wallMat);
        }
      }
    }
  }

  addStaticBlock(x, y, z, material) {
    const mesh = new THREE.Mesh(this.boxGeo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.destructible = false;
    this.scene.add(mesh);
    this.walls.push(mesh);
    return mesh;
  }

  // 破壊可能ブロックを追加（後の結晶ギミック・落石ギミック用）
  addDestructibleBlock(x, y, z, color = 0x4fd1c5, hp = 30) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.18,
      roughness: 0.4
    });
    const mesh = new THREE.Mesh(this.boxGeo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      destructible: true,
      hp,
      maxHp: hp,
      velocityY: 0,
      isFalling: false,
      sideHeld: false
    };

    this.scene.add(mesh);
    this.walls.push(mesh);
    this.destructibles.push(mesh);

    // 初期の安定判定
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

  // テスト用の破壊可能ピラー＆アーチを配置
  spawnTestGimmicks() {
    // 積み上がった柱（下を壊すと上が落ちてくる確認用）
    for (let h = 0; h < 4; h++) {
      this.addDestructibleBlock(0, HALF + h * BOX_SIZE, -10, 0x4fd1c5, 20);
      this.addDestructibleBlock(6, HALF + h * BOX_SIZE, -10, 0x4fd1c5, 20);
    }
    // 橋渡しブロック（柱を支えにする）
    this.addDestructibleBlock(2, HALF + 3 * BOX_SIZE, -10, 0xb15cff, 20);
    this.addDestructibleBlock(4, HALF + 3 * BOX_SIZE, -10, 0xb15cff, 20);

    // 飛び石用の段差
    this.addDestructibleBlock(-8, HALF, -6, 0xffd36a, 40);
    this.addDestructibleBlock(-10, HALF, -6, 0xffd36a, 40);
    this.addDestructibleBlock(-10, HALF + BOX_SIZE, -6, 0xffd36a, 40);
  }

  // 破壊可能ブロックにダメージを与える
  damageBlock(box, dmg) {
    if (!box.userData.destructible) return false;
    box.userData.hp -= dmg;

    // ヒットフラッシュ
    const origEmissive = box.material.emissiveIntensity;
    box.material.emissiveIntensity = 0.9;
    setTimeout(() => {
      if (box.material) box.material.emissiveIntensity = origEmissive;
    }, 80);

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
    this.walls = this.walls.filter(w => w !== box);
    this.destructibles = this.destructibles.filter(d => d !== box);

    // 破片パーティクル演出
    for (let i = 0; i < 8; i++) {
      this.spawnHitSpark(pos, col);
    }

    // 支えを失った周囲の破壊可能ブロックを連鎖落下させる
    this.wakeBoxesAfterRemoval(box);
  }

  spawnHitSpark(pos, color = 0x00ffff) {
    const geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos).add(new THREE.Vector3(
      (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 1.2
    ));
    this.scene.add(mesh);

    this.hitEffects.push({
      mesh,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 0.16,
        Math.random() * 0.14 + 0.04,
        (Math.random() - 0.5) * 0.16
      ),
      life: 0.35
    });
  }

  // ---- 完成品.htmlから移植した重力・連鎖崩壊システム ----
  getBoxGroundY(box, nextY) {
    const currentBottom = box.position.y - HALF;
    const nextBottom = nextY - HALF;
    let supportY = null;

    if (currentBottom >= -EPS && nextBottom <= EPS) {
      supportY = 0;
    }

    const bMinX = box.position.x - HALF, bMaxX = box.position.x + HALF;
    const bMinZ = box.position.z - HALF, bMaxZ = box.position.z + HALF;

    for (const other of this.walls) {
      if (other === box) continue;
      const overlapX = bMaxX > other.position.x - HALF && bMinX < other.position.x + HALF;
      const overlapZ = bMaxZ > other.position.z - HALF && bMinZ < other.position.z + HALF;
      if (!overlapX || !overlapZ) continue;

      const otherTop = other.position.y + HALF;
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

      const verticalOverlap =
        (box.position.y + HALF) > (other.position.y - HALF) + EPS &&
        (box.position.y - HALF) < (other.position.y + HALF) - EPS;
      if (!verticalOverlap) continue;

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
    const radius = 8.01;

    while (queue.length > 0) {
      const center = queue.shift();
      if (checked.has(center)) continue;
      checked.add(center);

      for (const box of this.destructibles) {
        if (checked.has(box)) continue;
        if (Math.abs(box.position.x - center.position.x) > radius) continue;
        if (Math.abs(box.position.z - center.position.z) > radius) continue;
        if (Math.abs(box.position.y - center.position.y) > radius) continue;

        const wasFalling = box.userData.isFalling;
        const oldY = box.position.y;
        const oldSide = box.userData.sideHeld;

        if (!wasFalling) this.wakeBox(box);

        if (oldY !== box.position.y || oldSide !== box.userData.sideHeld || wasFalling !== box.userData.isFalling) {
          queue.push(box);
        }
      }
    }
  }

  update(dt) {
    // 破壊可能ブロックの重力更新
    for (const box of this.destructibles) {
      if (box.userData.sideHeld && !box.userData.isFalling) {
        if (!this.hasStableSupport(box)) {
          box.userData.sideHeld = false;
          box.userData.isFalling = true;
          box.userData.velocityY = -BOX_GRAVITY;
        } else {
          continue;
        }
      }
      if (box.userData.velocityY === 0 && !box.userData.isFalling) continue;

      if (box.userData.isFalling) {
        box.userData.velocityY -= BOX_GRAVITY;
      }

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

    // ヒットパーティクル更新
    this.hitEffects = this.hitEffects.filter(fx => {
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
