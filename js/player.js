import * as THREE from 'three';

const PLAYER_HEIGHT = 2.2;
const PLAYER_RADIUS = 0.45;
const MOVE_SPEED = 0.16;
const GRAVITY = 0.014;
const JUMP_POWER = 0.28;

export class Player {
  constructor(scene, camera, world) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;

    // ステータス（フェーズ2でsave.js/data.jsと統合）
    this.hp = 100;
    this.maxHp = 100;
    this.exsGauge = 0;

    // 位置・物理
    this.root = new THREE.Group();
    this.root.position.set(0, 0, 6);
    this.scene.add(this.root);

    this.velocityY = 0;
    this.onGround = false;

    // TPSカメラ回転角
    this.yaw = 0;
    this.pitch = 0.25;
    this.camDist = 6.5;
    this.shakeTime = 0;
    this.shakeIntensity = 0;

    // アクション状態・クールダウン
    this.comboStep = 0;
    this.comboResetTimer = 0;
    this.nextAtkTime = 0;
    this.nextSkillTime = 0;
    this.nextDodgeTime = 0;
    this.dodgeUntil = 0;
    this.dodgeDir = new THREE.Vector3();
    this.slashEffects = [];

    this.keys = {};
    this.buildCharacterModel();
    this.bindInputs();
  }

  // 仮のプレイヤー3Dモデル（体・バイザー・剣）
  buildCharacterModel() {
    this.model = new THREE.Group();
    this.root.add(this.model);

    // 胴体
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.38, 0.9, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.4 })
    );
    body.position.y = 0.85;
    body.castShadow = true;
    this.model.add(body);

    // 頭部
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3 })
    );
    head.position.y = 1.75;
    head.castShadow = true;
    this.model.add(head);

    // 正面がわかるバイザー（シアン発光）
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.12, 0.2),
      new THREE.MeshBasicMaterial({ color: 0x00ffff })
    );
    visor.position.set(0, 1.78, -0.26);
    this.model.add(visor);

    // 右手・剣のピボット
    this.swordPivot = new THREE.Group();
    this.swordPivot.position.set(0.5, 1.1, -0.1);
    this.model.add(this.swordPivot);

    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.4, 0.16),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x00ffff,
        emissiveIntensity: 0.4
      })
    );
    blade.position.set(0, 0.65, -0.2);
    blade.rotation.x = -0.35;
    this.swordPivot.add(blade);
  }

  bindInputs() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;

      if (e.code === 'Space' && this.onGround) {
        this.velocityY = JUMP_POWER;
        this.onGround = false;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.triggerDodge();
      }
      if (e.code === 'KeyE') {
        this.triggerSkill();
      }
      if (e.code === 'KeyZ') {
        this.triggerExS();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === document.body) {
        this.yaw -= e.movementX * 0.0025;
        this.pitch += e.movementY * 0.0022;
        this.pitch = Math.max(-0.35, Math.min(1.15, this.pitch));
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== document.body) return;
      if (e.button === 0) this.triggerAttack();
      if (e.button === 2) this.triggerDodge();
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- アクション処理 ----
  triggerAttack() {
    const now = performance.now();
    if (now < this.nextAtkTime || now < this.dodgeUntil) return;

    this.nextAtkTime = now + 280;
    this.comboStep = (this.comboStep % 3) + 1;
    this.comboResetTimer = now + 900;

    const isThird = this.comboStep === 3;
    const reach = isThird ? 3.8 : 3.0;
    const color = isThird ? 0x00ffff : 0x63b3ed;

    // 剣の振りモーション
    this.swingSwordAnimation(this.comboStep);
    this.spawnSlashArc(reach, color, isThird ? 1.4 : 1.0);
    if (isThird) this.addCameraShake(0.12, 0.08);

    // 攻撃判定（破壊可能ブロック＆将来の敵）
    this.performMeleeHit(reach, isThird ? 20 : 10, color);
  }

  triggerSkill() {
    const now = performance.now();
    if (now < this.nextSkillTime || now < this.dodgeUntil) return;

    this.nextSkillTime = now + 3000;
    this.swingSwordAnimation(3);
    this.spawnSlashArc(4.6, 0xffd36a, 1.8);
    this.addCameraShake(0.18, 0.14);
    this.performMeleeHit(4.6, 40, 0xffd36a);
  }

  triggerDodge() {
    const now = performance.now();
    if (now < this.nextDodgeTime || now < this.dodgeUntil) return;

    this.dodgeUntil = now + 200;
    this.nextDodgeTime = now + 850;

    // 入力方向またはキャラの向いている方向へ高速ダッシュ
    const moveDir = this.getInputMoveDirection();
    if (moveDir.lengthSq() > 0) {
      this.dodgeDir.copy(moveDir).normalize();
      this.model.rotation.y = Math.atan2(-this.dodgeDir.x, -this.dodgeDir.z);
    } else {
      const ang = this.model.rotation.y;
      this.dodgeDir.set(-Math.sin(ang), 0, -Math.cos(ang)).normalize();
    }

    // 残像エフェクト
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.spawnAfterimage(), i * 45);
    }
  }

  triggerExS() {
    if (this.exsGauge < 100) return;
    this.exsGauge = 0;
    this.addCameraShake(0.35, 0.25);
    this.spawnSlashArc(7.0, 0x00ffff, 2.5);
    this.performMeleeHit(7.0, 100, 0x00ffff);
  }

  performMeleeHit(reach, dmg, color) {
    const forward = new THREE.Vector3(
      -Math.sin(this.model.rotation.y),
      0,
      -Math.cos(this.model.rotation.y)
    );
    const origin = this.root.position.clone().add(new THREE.Vector3(0, 1.0, 0));

    let hitSomething = false;
    // 破壊可能ブロックへのヒット判定
    const targets = [...this.world.destructibles];
    for (const box of targets) {
      const toBox = box.position.clone().sub(origin);
      const horizDist = Math.hypot(toBox.x, toBox.z);
      if (horizDist > reach + 1.0 || Math.abs(toBox.y) > 2.2) continue;

      const dirNorm = new THREE.Vector3(toBox.x, 0, toBox.z).normalize();
      if (forward.dot(dirNorm) > 0.25 || horizDist < 1.8) {
        this.world.damageBlock(box, dmg);
        hitSomething = true;
      }
    }

    if (hitSomething) {
      this.exsGauge = Math.min(100, this.exsGauge + 12);
    }
  }

  // ---- ビジュアル演出 ----
  swingSwordAnimation(step) {
    const startRot = step === 2 ? -1.4 : 1.4;
    const endRot = -startRot;
    this.swordPivot.rotation.y = startRot;
    this.swordPivot.rotation.x = 0.8;

    let t = 0;
    const anim = () => {
      t += 0.16;
      if (t >= 1) {
        this.swordPivot.rotation.set(0, 0, 0);
        return;
      }
      this.swordPivot.rotation.y = THREE.MathUtils.lerp(startRot, endRot, t);
      requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
  }

  spawnSlashArc(radius, color, scaleY = 1.0) {
    const geo = new THREE.RingGeometry(radius * 0.45, radius, 24, 1, -Math.PI * 0.35, Math.PI * 0.7);
    const mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(this.root.position).add(new THREE.Vector3(0, 1.1, 0));
    mesh.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.35;
    mesh.rotation.z = this.model.rotation.y + Math.PI / 2;
    mesh.scale.set(1, scaleY, 1);
    this.scene.add(mesh);

    this.slashEffects.push({ mesh, life: 0.18, maxLife: 0.18 });
  }

  spawnAfterimage() {
    const ghost = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.38, 0.9, 4, 8),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.45 })
    );
    ghost.position.copy(this.root.position).add(new THREE.Vector3(0, 0.85, 0));
    this.scene.add(ghost);
    this.slashEffects.push({ mesh: ghost, life: 0.22, maxLife: 0.22 });
  }

  addCameraShake(duration, intensity) {
    this.shakeTime = duration;
    this.shakeIntensity = intensity;
  }

  // ---- 移動・衝突判定 ----
  getInputMoveDirection() {
    let forwardInput = 0;
    let rightInput = 0;
    if (this.keys['KeyW']) forwardInput += 1;
    if (this.keys['KeyS']) forwardInput -= 1;
    if (this.keys['KeyD']) rightInput += 1;
    if (this.keys['KeyA']) rightInput -= 1;

    const dir = new THREE.Vector3();
    if (forwardInput === 0 && rightInput === 0) return dir;

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    dir.addScaledVector(forward, forwardInput);
    dir.addScaledVector(right, rightInput);
    return dir.normalize();
  }

  isCollidingHorizontal(x, z, pY) {
    const feet = pY + 0.05;
    const head = pY + PLAYER_HEIGHT;

    for (const wall of this.world.walls) {
      const minX = wall.position.x - 1.0 - PLAYER_RADIUS;
      const maxX = wall.position.x + 1.0 + PLAYER_RADIUS;
      const minZ = wall.position.z - 1.0 - PLAYER_RADIUS;
      const maxZ = wall.position.z + 1.0 + PLAYER_RADIUS;
      const minY = wall.position.y - 1.0;
      const maxY = wall.position.y + 1.0;

      if (x > minX && x < maxX && z > minZ && z < maxZ) {
        if (feet < maxY && head > minY) return true;
      }
    }
    return false;
  }

  update(dt) {
    const now = performance.now();
    if (now > this.comboResetTimer) this.comboStep = 0;

    const prevY = this.root.position.y;

    // 1. 水平移動（回避中 or 通常移動）
    let moveVec = new THREE.Vector3();
    if (now < this.dodgeUntil) {
      moveVec.copy(this.dodgeDir).multiplyScalar(0.42);
    } else {
      const dir = this.getInputMoveDirection();
      if (dir.lengthSq() > 0) {
        moveVec.copy(dir).multiplyScalar(MOVE_SPEED);
        // キャラクターの向きを移動方向へ滑らかに回転
        const targetAng = Math.atan2(-dir.x, -dir.z);
        const diff = Math.atan2(Math.sin(targetAng - this.model.rotation.y), Math.cos(targetAng - this.model.rotation.y));
        this.model.rotation.y += diff * 0.25;
      }
    }

    const nextX = this.root.position.x + moveVec.x;
    const nextZ = this.root.position.z + moveVec.z;
    if (!this.isCollidingHorizontal(nextX, this.root.position.z, this.root.position.y)) {
      this.root.position.x = nextX;
    }
    if (!this.isCollidingHorizontal(this.root.position.x, nextZ, this.root.position.y)) {
      this.root.position.z = nextZ;
    }

    // 2. 垂直移動（重力・天井・着地）
    this.velocityY -= GRAVITY;
    this.root.position.y += this.velocityY;

    let groundY = 0;
    let landed = false;

    for (const wall of this.world.walls) {
      const minX = wall.position.x - 1.0 - PLAYER_RADIUS;
      const maxX = wall.position.x + 1.0 + PLAYER_RADIUS;
      const minZ = wall.position.z - 1.0 - PLAYER_RADIUS;
      const maxZ = wall.position.z + 1.0 + PLAYER_RADIUS;

      if (this.root.position.x > minX && this.root.position.x < maxX &&
          this.root.position.z > minZ && this.root.position.z < maxZ) {
        const top = wall.position.y + 1.0;
        const bottom = wall.position.y - 1.0;

        // 天井衝突
        if (prevY + PLAYER_HEIGHT <= bottom && this.root.position.y + PLAYER_HEIGHT >= bottom && this.velocityY > 0) {
          this.root.position.y = bottom - PLAYER_HEIGHT;
          this.velocityY = 0;
        }
        // 着地判定
        if (this.velocityY <= 0 && this.root.position.y >= top - 0.3 && this.root.position.y <= top + 0.2 && prevY >= top - 0.1) {
          groundY = Math.max(groundY, top);
          landed = true;
        }
      }
    }

    if (landed) {
      this.root.position.y = groundY;
      this.velocityY = 0;
      this.onGround = true;
    } else if (this.root.position.y <= 0) {
      this.root.position.y = 0;
      this.velocityY = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // 3. 三人称（TPS）カメラ追従と壁めり込み防止
    this.updateCamera(dt);

    // 4. 斬撃・残像エフェクト更新
    this.slashEffects = this.slashEffects.filter(fx => {
      fx.life -= dt;
      fx.mesh.material.opacity = Math.max(0, (fx.life / fx.maxLife) * 0.85);
      if (fx.life <= 0) {
        this.scene.remove(fx.mesh);
        fx.mesh.geometry.dispose();
        fx.mesh.material.dispose();
        return false;
      }
      return true;
    });
  }

  updateCamera(dt) {
    const focus = this.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch) * this.camDist,
      Math.sin(this.pitch) * this.camDist,
      Math.cos(this.yaw) * Math.cos(this.pitch) * this.camDist
    );

    const desiredPos = focus.clone().add(offset);
    if (desiredPos.y < 0.6) desiredPos.y = 0.6;

    // カメラシェイク適用
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      desiredPos.x += (Math.random() - 0.5) * this.shakeIntensity;
      desiredPos.y += (Math.random() - 0.5) * this.shakeIntensity;
      desiredPos.z += (Math.random() - 0.5) * this.shakeIntensity;
    }

    this.camera.position.lerp(desiredPos, 0.35);
    this.camera.lookAt(focus);
  }
}
