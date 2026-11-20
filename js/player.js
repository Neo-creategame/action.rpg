import * as THREE from 'three';
import {
  DURABILITY, RANGED_WEAPON_TYPES, isRestrictedLegend, EXS_LIST, EXS_GAUGE_MAX
} from './data.js';
import {
  state, EQUIPPED, maxHp, atkTotal, wear, hasSynergy, artifactStat, rollWeapon, saveGame
} from './save.js';

const PLAYER_HEIGHT = 2.2;
const PLAYER_RADIUS = 0.45;
const BASE_MOVE_SPEED = 0.16;
const GRAVITY = 0.014;
const JUMP_POWER = 0.28;

export class Player {
  constructor(scene, camera, world, onToast) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.onToast = onToast || (() => {});

    this.hp = maxHp();

    // Legend武器固有ゲージ
    this.souenGauge = 0;   // 無尾 (0〜120)
    this.apoGauge = 0;     // アポカリプス (0〜100)
    this.starGauge = 0;    // アストラル・オーブ (0〜100)
    this.chronosGauge = 0; // クロノス・ボウ (0〜100)

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

    // アクション・クールダウン
    this.comboStep = 0;
    this.comboResetTimer = 0;
    this.nextAtkTime = 0;
    this.nextSkillTime = 0;
    this.nextQTime = 0;
    this.nextDodgeTime = 0;
    this.dodgeUntil = 0;
    this.dodgeDir = new THREE.Vector3();

    this.slashEffects = [];
    this.projectiles = []; // 3D遠距離弾（矢・魔法弾・ホーミング弾）

    this.keys = {};
    this.buildCharacterModel();
    this.syncWeaponVisual();
    this.bindInputs();
  }

  buildCharacterModel() {
    this.model = new THREE.Group();
    this.root.add(this.model);

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.38, 0.9, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.4 })
    );
    body.position.y = 0.85;
    body.castShadow = true;
    this.model.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3 })
    );
    head.position.y = 1.75;
    head.castShadow = true;
    this.model.add(head);

    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.12, 0.2),
      new THREE.MeshBasicMaterial({ color: 0x00ffff })
    );
    visor.position.set(0, 1.78, -0.26);
    this.model.add(visor);

    this.swordPivot = new THREE.Group();
    this.swordPivot.position.set(0.5, 1.1, -0.1);
    this.model.add(this.swordPivot);

    this.bladeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x00ffff,
      emissiveIntensity: 0.4
    });
    this.bladeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.16), this.bladeMat);
    this.bladeMesh.position.set(0, 0.65, -0.2);
    this.bladeMesh.rotation.x = -0.35;
    this.swordPivot.add(this.bladeMesh);
  }

  // 装備中の武器に合わせて見た目の色・長さを変える
  syncWeaponVisual() {
    const w = state.weapon;
    if (!w || !this.bladeMesh) return;

    const colorMap = {
      mubi: 0x00ffff,
      apocalypse: 0xff1144,
      astral_orb: 0x10b981,
      chronos_bow: 0x3b82f6,
      inferno_scythe: 0xff5500,
      greatsword: 0xffa07a,
      spear: 0xe0ffff,
      bow: 0xffd36a
    };
    const col = colorMap[w.type] || 0x63b3ed;
    this.bladeMat.emissive.setHex(col);

    const isLong = ['greatsword', 'spear', 'apocalypse', 'inferno_scythe'].includes(w.type);
    this.bladeMesh.scale.y = isLong ? 1.35 : 1.0;
  }

  bindInputs() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;

      if (e.code === 'Space' && this.onGround) {
        this.velocityY = JUMP_POWER;
        this.onGround = false;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.triggerDodge();
      if (e.code === 'KeyE') this.triggerSkill();
      if (e.code === 'KeyQ') this.triggerQSkill();
      if (e.code === 'KeyZ') this.triggerExS();
      if (e.code === 'KeyX') this.swapWeapon();

      // フェーズ2動作確認用：武器切り替えショートカット（1〜6キー）
      const debugMap = {
        Digit1: 'sword',
        Digit2: 'bow',
        Digit3: 'mubi',
        Digit4: 'apocalypse',
        Digit5: 'astral_orb',
        Digit6: 'chronos_bow'
      };
      if (debugMap[e.code]) {
        state.weapon = rollWeapon(debugMap[e.code], 10);
        this.syncWeaponVisual();
        this.onToast(`武器変更: ${state.weapon.name} (ATK ${state.weapon.atk})`);
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

  // ---- メイン・サブ武器交代（スイッチ） ----
  swapWeapon() {
    if (isRestrictedLegend(state.weapon)) {
      return this.onToast(`「${state.weapon.name}」装備中は切り替え不可`);
    }
    if (!EQUIPPED.sub_weapon || isRestrictedLegend(EQUIPPED.sub_weapon)) {
      return this.onToast('サブ武器が未装備です');
    }
    const temp = state.weapon;
    state.weapon = EQUIPPED.sub_weapon;
    EQUIPPED.sub_weapon = temp;
    this.syncWeaponVisual();
    this.onToast(`⇄ スイッチ: ${state.weapon.name}`);
    saveGame();
  }

  // ---- 通常攻撃（近接＆3D遠距離対応） ----
  triggerAttack() {
    const now = performance.now();
    const w = state.weapon;
    if (!w || now < this.nextAtkTime || now < this.dodgeUntil) return;

    this.nextAtkTime = now + w.cd;
    this.comboStep = (this.comboStep % 3) + 1;
    this.comboResetTimer = now + 950;

    const dmg = atkTotal(this.hp);
    const isThird = this.comboStep === 3;

    // 1. 遠距離武器（弓・杖・アストラル・クロノス）
    if (RANGED_WEAPON_TYPES.includes(w.type)) {
      // カメラの向きへキャラを合わせる
      this.model.rotation.y = this.yaw;

      if (w.type === 'astral_orb') {
        const angles = hasSynergy('awake_astral') ? [-0.18, 0, 0.18] : [-0.12, 0.12];
        angles.forEach((off) => {
          this.fireProjectile(off, Math.round(dmg * 0.6), 0x10b981, { homing: true, starPerHit: 6 });
        });
      } else if (w.type === 'chronos_bow') {
        this.fireProjectile(0, dmg, 0x3b82f6, { pierce: true, isChronosArrow: true });
      } else {
        const col = w.type === 'lightning_staff' ? 0xffff00 : w.type === 'eruption_wand' ? 0xff4500 : 0xffd36a;
        this.fireProjectile(0, dmg, col);
      }
      wear(w, DURABILITY.weaponAttack);
      return;
    }

    // 2. 近接武器（片手剣・双剣・大剣・槍・無尾・アポカリプス等）
    const reach = (w.range || 3.2) + (isThird ? 0.6 : 0);
    const colMap = {
      mubi: isThird ? 0x00ffff : 0x38bdf8,
      apocalypse: 0xff1144,
      greatsword: 0xffa07a,
      spear: 0xe0ffff
    };
    const color = colMap[w.type] || (isThird ? 0x00ffff : 0x63b3ed);

    this.swingSwordAnimation(this.comboStep);
    this.spawnSlashArc(reach, color, isThird ? 1.4 : 1.0);
    if (isThird || w.type === 'greatsword') this.addCameraShake(0.12, 0.08);

    const hitCount = this.performMeleeHit(reach, Math.round(dmg * (isThird ? 1.25 : 1.0)), color);
    if (hitCount > 0) {
      if (w.type === 'mubi' && isThird) {
        const add = hitCount * 10 * (hasSynergy('awake_mubi') ? 2 : 1);
        this.souenGauge = Math.min(120, this.souenGauge + add);
        this.onToast(`蒼焔 +${add}`);
      }
      if (w.type === 'apocalypse') {
        const add = Math.round(hitCount * 12 * (hasSynergy('awake_apo') ? 1.5 : 1.0));
        this.apoGauge = Math.min(100, this.apoGauge + add);
        this.onToast(`終末 +${add}`);
      }
    }
    wear(w, DURABILITY.weaponAttack);
  }

  // ---- Eスキル（武器スキル） ----
  triggerSkill() {
    const now = performance.now();
    const w = state.weapon;
    if (!w || now < this.nextSkillTime || now < this.dodgeUntil) return;

    const cdCut = Math.min(0.65, (artifactStat('cdPct') + artifactStat('motif_chronos') + (hasSynergy('chronos_overdrive') ? 15 : 0)) / 100);
    this.nextSkillTime = now + Math.round(w.skill.cd * (1 - cdCut));

    const dmg = atkTotal(this.hp);
    this.model.rotation.y = this.yaw;

    if (w.type === 'bow') {
      [-0.22, 0, 0.22].forEach((off) => this.fireProjectile(off, dmg, 0xffd36a));
    } else if (w.type === 'chronos_bow') {
      // バックステップ＋5方向射撃
      this.dodgeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
      this.dodgeUntil = now + 180;
      [-0.28, -0.14, 0, 0.14, 0.28].forEach((off) => {
        this.fireProjectile(off, Math.round(dmg * 0.9), 0x93c5fd, { isChronosArrow: true });
      });
      this.onToast('⏳ バックステップ・アロー！');
    } else if (w.type === 'astral_orb') {
      this.spawnSlashArc(6.5, 0x10b981, 2.2);
      const hits = this.performMeleeHit(6.5, Math.round(dmg * 1.4), 0x10b981, true);
      if (hits > 0) {
        this.starGauge = Math.min(100, this.starGauge + hits * 15);
        this.onToast(`星力 +${hits * 15}`);
      }
    } else if (w.type === 'mubi') {
      // 蒼焔連突：前方ダッシュ斬り
      this.dodgeDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      this.dodgeUntil = now + 220;
      this.spawnSlashArc(5.0, 0x00ffff, 1.8);
      const hits = this.performMeleeHit(5.0, Math.round(dmg * 1.8), 0x00ffff);
      if (hits > 0) {
        const add = hits * 12 * (hasSynergy('awake_mubi') ? 2 : 1);
        this.souenGauge = Math.min(120, this.souenGauge + add);
        this.onToast(`蒼焔 +${add}`);
      }
    } else {
      // 汎用ソードスキル（回転斬り・重撃一閃・メテオ等）
      this.swingSwordAnimation(3);
      this.spawnSlashArc(5.2, 0xffd36a, 1.8);
      this.addCameraShake(0.18, 0.14);
      const hits = this.performMeleeHit(5.2, Math.round(dmg * 1.6), 0xffd36a, true);
      if (w.type === 'apocalypse' && hits > 0) {
        this.apoGauge = Math.min(100, this.apoGauge + hits * 15);
      }
    }

    wear(w, DURABILITY.weaponSkill);
  }

  // ---- Qスキル（Legend固有ゲージ技 / 汎用衝撃波） ----
  triggerQSkill() {
    const now = performance.now();
    const w = state.weapon;
    const dmg = atkTotal(this.hp);

    if (w.type === 'mubi') {
      if (this.souenGauge < 80) return this.onToast('蒼焔ゲージ不足 (80必要)');
      this.souenGauge -= 80;
      this.onToast('🔥 蒼焔乱舞！');
      this.addCameraShake(0.25, 0.16);
      this.spawnSlashArc(6.0, 0x00ffff, 2.2);
      this.performMeleeHit(6.0, Math.round(dmg * 4.0), 0x00ffff, true);
      return;
    }
    if (w.type === 'apocalypse') {
      if (this.apoGauge < 60) return this.onToast('終末ゲージ不足 (60必要)');
      this.apoGauge -= 60;
      this.onToast('🌑 終末の審判！');
      this.addCameraShake(0.3, 0.2);
      this.spawnSlashArc(7.0, 0xff1144, 2.5);
      this.performMeleeHit(7.0, Math.round(dmg * 5.0), 0xff1144, true);
      return;
    }

    if (now < this.nextQTime) return;
    this.nextQTime = now + 4000;
    this.onToast('⚡ 衝撃波！');
    this.spawnSlashArc(4.8, 0x4fd1c5, 2.0);
    this.performMeleeHit(4.8, Math.round(dmg * 1.5), 0x4fd1c5, true);
  }

  // ---- Zスキル（ExS / 究極奥義） ----
  triggerExS() {
    const w = state.weapon;
    const dmg = atkTotal(this.hp);

    if (w.type === 'mubi') {
      if (this.souenGauge < 120) return this.onToast('蒼焔ゲージ不足 (120必要)');
      this.souenGauge = 0;
      this.onToast('❄️ 蒼焔・絶対凍結陣！');
      this.addCameraShake(0.4, 0.25);
      this.spawnSlashArc(8.5, 0x00ffff, 3.0);
      this.performMeleeHit(8.5, Math.round(dmg * 8.0), 0x00ffff, true);
      return;
    }
    if (w.type === 'apocalypse') {
      if (this.apoGauge < 100) return this.onToast('終末ゲージ不足 (100必要)');
      this.apoGauge = 0;
      this.onToast('☄️ 終焉奥義【アポカリプス・ノヴァ】！');
      this.addCameraShake(0.5, 0.3);
      this.spawnSlashArc(9.5, 0xff1144, 3.2);
      this.performMeleeHit(9.5, Math.round(dmg * 12.0), 0xff1144, true);
      return;
    }

    if (state.exsGauge < EXS_GAUGE_MAX) return;
    state.exsGauge = 0;
    const exsDef = EXS_LIST[state.equippedExsId] || EXS_LIST.giga_breaker;
    this.onToast(`💥 ${exsDef.name}！`);
    this.addCameraShake(0.35, 0.25);
    this.spawnSlashArc(7.5, exsDef.color, 2.6);
    this.performMeleeHit(7.5, Math.round(dmg * 10.0), exsDef.color, true);
  }

  triggerDodge() {
    const now = performance.now();
    if (now < this.nextDodgeTime || now < this.dodgeUntil) return;

    this.dodgeUntil = now + 200;
    this.nextDodgeTime = now + 850;

    const moveDir = this.getInputMoveDirection();
    if (moveDir.lengthSq() > 0) {
      this.dodgeDir.copy(moveDir).normalize();
      this.model.rotation.y = Math.atan2(-this.dodgeDir.x, -this.dodgeDir.z);
    } else {
      const ang = this.model.rotation.y;
      this.dodgeDir.set(-Math.sin(ang), 0, -Math.cos(ang)).normalize();
    }

    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.spawnAfterimage(), i * 45);
    }
  }

  // ---- 3D遠距離弾の発射・更新 ----
  fireProjectile(angleOffset, dmg, color = 0xffd36a, opts = {}) {
    const w = state.weapon;
    const ang = this.yaw + angleOffset;
    const pitchFactor = Math.max(-0.3, Math.min(0.5, -this.pitch + 0.15));

    const dir = new THREE.Vector3(
      -Math.sin(ang) * Math.cos(pitchFactor),
      Math.sin(pitchFactor),
      -Math.cos(ang) * Math.cos(pitchFactor)
    ).normalize();

    const geo = new THREE.SphereGeometry(0.18, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(this.root.position).add(new THREE.Vector3(0, 1.3, 0)).addScaledVector(dir, 0.8);
    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      vel: dir.multiplyScalar(w.projSpeed || 0.85),
      startPos: mesh.position.clone(),
      maxDist: w.range || 26,
      dmg,
      color,
      hitSet: new Set(),
      ...opts
    });
  }

  updateProjectiles() {
    this.projectiles = this.projectiles.filter((p) => {
      // ホーミング誘導（ターゲットがある場合は誘導）
      if (p.homing && this.world.destructibles.length > 0) {
        const target = this.world.destructibles[0];
        const toTarget = target.position.clone().sub(p.mesh.position).normalize();
        const spd = p.vel.length();
        p.vel.lerp(toTarget.multiplyScalar(spd), 0.08).normalize().multiplyScalar(spd);
      }

      p.mesh.position.add(p.vel);
      const traveled = p.mesh.position.distanceTo(p.startPos);

      // 壁・破壊可能ブロックへの衝突判定
      let hitWall = false;
      for (const wall of this.world.walls) {
        if (p.hitSet.has(wall)) continue;
        if (Math.abs(p.mesh.position.x - wall.position.x) < 1.1 &&
            Math.abs(p.mesh.position.y - wall.position.y) < 1.1 &&
            Math.abs(p.mesh.position.z - wall.position.z) < 1.1) {
          p.hitSet.add(wall);
          if (wall.userData.destructible) {
            let finalDmg = p.dmg;
            if (p.isChronosArrow) {
              const ratio = Math.min(1, traveled / 25);
              finalDmg = Math.round(p.dmg * (1 + (hasSynergy('awake_chronos') ? 1.5 : 0.6) * ratio));
              this.chronosGauge = Math.min(100, this.chronosGauge + Math.round((8 + 8 * ratio) * (hasSynergy('awake_chronos') ? 1.5 : 1)));
            }
            if (p.starPerHit) {
              this.starGauge = Math.min(100, this.starGauge + p.starPerHit);
            }
            this.world.damageBlock(wall, finalDmg);
            state.exsGauge = Math.min(EXS_GAUGE_MAX, state.exsGauge + 6);
          }
          if (!p.pierce) {
            hitWall = true;
            break;
          }
        }
      }

      const expired = hitWall || traveled >= p.maxDist || p.mesh.position.y <= 0;
      if (expired) {
        this.world.spawnHitSpark(p.mesh.position, p.color);
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      }
      return !expired;
    });
  }

  performMeleeHit(reach, dmg, color, isAllAround = false) {
    const forward = new THREE.Vector3(-Math.sin(this.model.rotation.y), 0, -Math.cos(this.model.rotation.y));
    const origin = this.root.position.clone().add(new THREE.Vector3(0, 1.0, 0));

    let hitCount = 0;
    const targets = [...this.world.destructibles];
    for (const box of targets) {
      const toBox = box.position.clone().sub(origin);
      const horizDist = Math.hypot(toBox.x, toBox.z);
      if (horizDist > reach + 1.0 || Math.abs(toBox.y) > 2.4) continue;

      const dirNorm = new THREE.Vector3(toBox.x, 0, toBox.z).normalize();
      if (isAllAround || forward.dot(dirNorm) > 0.2 || horizDist < 1.8) {
        this.world.damageBlock(box, dmg);
        hitCount++;
      }
    }

    if (hitCount > 0) {
      const exsMult = hasSynergy('chronos_overdrive') ? 1.25 : 1.0;
      state.exsGauge = Math.min(EXS_GAUGE_MAX, state.exsGauge + Math.round(hitCount * 8 * exsMult));
    }
    return hitCount;
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
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
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
    this.hp = Math.min(this.hp, maxHp());

    const prevY = this.root.position.y;
    const speedMult = state.weapon ? (state.weapon.speedMult || 1.0) : 1.0;

    let moveVec = new THREE.Vector3();
    if (now < this.dodgeUntil) {
      moveVec.copy(this.dodgeDir).multiplyScalar(0.42);
    } else {
      const dir = this.getInputMoveDirection();
      if (dir.lengthSq() > 0) {
        moveVec.copy(dir).multiplyScalar(BASE_MOVE_SPEED * speedMult);
        const targetAng = Math.atan2(-dir.x, -dir.z);
        const diff = Math.atan2(Math.sin(targetAng - this.model.rotation.y), Math.cos(targetAng - this.model.rotation.y));
        this.model.rotation.y += diff * 0.25;
      }
    }

    const nextX = this.root.position.x + moveVec.x;
    const nextZ = this.root.position.z + moveVec.z;
    if (!this.isCollidingHorizontal(nextX, this.root.position.z, this.root.position.y)) this.root.position.x = nextX;
    if (!this.isCollidingHorizontal(this.root.position.x, nextZ, this.root.position.y)) this.root.position.z = nextZ;

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

        if (prevY + PLAYER_HEIGHT <= bottom && this.root.position.y + PLAYER_HEIGHT >= bottom && this.velocityY > 0) {
          this.root.position.y = bottom - PLAYER_HEIGHT;
          this.velocityY = 0;
        }
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

    this.updateProjectiles();
    this.updateCamera(dt);

    this.slashEffects = this.slashEffects.filter((fx) => {
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
