import * as THREE from 'three';
import {
  DURABILITY, RANGED_WEAPON_TYPES, isRestrictedLegend, EXS_LIST, EXS_GAUGE_MAX, DEATH
} from './data.js';
import {
  state, EQUIPPED, maxHp, atkTotal, takeDamage, wear, wearArmor,
  hasSynergy, artifactStat, saveGame
} from './save.js';

const PLAYER_HEIGHT = 2.2;
const PLAYER_RADIUS = 0.45;
const BASE_MOVE_SPEED = 0.16;
const GRAVITY = 0.014;
const JUMP_POWER = 0.28;

export class Player {
  constructor(scene, camera, world, enemyManager, callbacks = {}) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.enemyManager = enemyManager;
    this.onToast = callbacks.onToast || (() => {});
    this.onNextFloor = callbacks.onNextFloor || (() => {});
    this.onDeath = callbacks.onDeath || (() => {});
    this.onSlowMo = callbacks.onSlowMo || (() => {});
    this.isUiOpen = callbacks.isUiOpen || (() => false);

    this.hp = maxHp();

    // Legend武器固有ゲージ
    this.souenGauge = 0;     // 無尾（最大120）
    this.apoGauge = 0;       // アポカリプス（最大100）
    this.starGauge = 0;      // アストラル・オーブ（最大100）
    this.chronosGauge = 0;   // クロノス・ボウ（最大100）

    // アストラル・ビット（Qスキル）
    this.astralBits = [];
    this.bitActiveUntil = 0;
    this.bitFireTimer = 0;

    // クロノ・オーラ（Qスキル）＆ エンド・オブ・タイム（Zスキル）
    this.chronoAuraMesh = null;
    this.chronoAuraUntil = 0;
    this.chronoTickTimer = 0;
    this.timeStopUntil = 0;
    this.timeStopHits = new Map(); // enemy -> hitCount

    // ブラックホール（アポカリプスQ）＆ 落下メテオ
    this.blackHoles = [];
    this.skillObjects = [];
    this.exsRegenAcc = 0;

    this.root = new THREE.Group();
    this.root.position.set(0, 0, 6);
    this.scene.add(this.root);

    this.velocityY = 0;
    this.onGround = false;

    this.yaw = 0;
    this.pitch = 0.25;
    this.camDist = 6.8;
    this.shakeTime = 0;
    this.shakeIntensity = 0;

    this.comboStep = 0;
    this.comboResetTimer = 0;
    this.nextAtkTime = 0;
    this.nextSkillTime = 0;
    this.nextQTime = 0;
    this.nextDodgeTime = 0;
    this.dodgeUntil = 0;
    this.invulnUntil = 0;
    this.regenAcc = 0;
    this.dodgeDir = new THREE.Vector3();

    this.slashEffects = [];
    this.projectiles = [];

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
      emissiveIntensity: 0.45
    });
    this.bladeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.16), this.bladeMat);
    this.bladeMesh.position.set(0, 0.65, -0.2);
    this.bladeMesh.rotation.x = -0.35;
    this.swordPivot.add(this.bladeMesh);

    this.offhandMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.15, 0.14), this.bladeMat);
    this.offhandMesh.position.set(-0.5, 1.1, -0.3);
    this.offhandMesh.rotation.x = -0.45;
    this.offhandMesh.visible = false;
    this.model.add(this.offhandMesh);
  }

  syncWeaponVisual() {
    const w = state.weapon;
    if (!w || !this.bladeMesh) return;
    const colorMap = {
      mubi: 0x00ffff, apocalypse: 0xff1144, astral_orb: 0x10b981, chronos_bow: 0x3b82f6,
      inferno_scythe: 0xff5500, greatsword: 0xffa07a, spear: 0xe0ffff, bow: 0xffd36a,
      dual: 0x7cf0a0, spellbook: 0xb15cff, demon_sword: 0xb15cff, eruption_wand: 0xff4500,
      dragon_chain: 0xffd36a, lightning_staff: 0x00ffff
    };
    this.bladeMat.emissive.setHex(colorMap[w.type] || 0x63b3ed);

    const isLong = ['greatsword', 'spear', 'apocalypse', 'inferno_scythe', 'dragon_chain'].includes(w.type);
    const isWide = ['greatsword', 'apocalypse', 'inferno_scythe'].includes(w.type);
    this.bladeMesh.scale.set(isWide ? 1.8 : 1.0, isLong ? 1.45 : 1.0, isWide ? 1.5 : 1.0);
    this.offhandMesh.visible = (w.type === 'dual');
  }

  bindInputs() {
    window.addEventListener('keydown', (e) => {
      if (this.isUiOpen()) return;
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
      if (e.code === 'KeyF') this.tryInteract();
    });

    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    window.addEventListener('mousemove', (e) => {
      if (!this.isUiOpen() && document.pointerLockElement === document.body) {
        this.yaw -= e.movementX * 0.0025;
        this.pitch += e.movementY * 0.0022;
        this.pitch = Math.max(-0.35, Math.min(1.15, this.pitch));
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (this.isUiOpen() || document.pointerLockElement !== document.body) return;
      if (e.button === 0) this.triggerAttack();
      if (e.button === 2) this.triggerDodge();
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  tryInteract() {
    const nearby = this.world.getNearbyInteractable(this.root.position);
    if (nearby) {
      this.world.triggerInteractable(nearby, this, maxHp());
      return;
    }

    const dist = Math.hypot(
      this.root.position.x - this.world.portalPos.x,
      this.root.position.z - this.world.portalPos.z
    );
    if (dist > 2.8) return;
    if (this.world.portalLocked) {
      this.onToast('🔒 ボスを倒すまで封印されている！');
      return;
    }
    this.onNextFloor();
  }

  receiveEnemyAttack(rawAtk, attackerPos) {
    const now = performance.now();
    if (now < this.invulnUntil) return;

    if (now < this.dodgeUntil) {
      this.invulnUntil = now + 950;
      state.exsGauge = Math.min(EXS_GAUGE_MAX, state.exsGauge + 20);
      this.onToast('⚡ 極限回避！ExSゲージ +20%');
      this.onSlowMo(0.35);
      this.addCameraShake(0.15, 0.1);
      return;
    }

    let dmg = takeDamage(rawAtk);
    const cut = artifactStat('dmgCut') + (hasSynergy('immortal_king') ? 10 : 0) + (hasSynergy('absolute_aegis') ? 15 : 0);
    if (cut > 0) dmg = Math.max(1, Math.round(dmg * (1 - Math.min(0.8, cut / 100))));
    if (state.weapon?.type === 'inferno_scythe' && this.enemyManager.activeBoss?.hellfireGauge >= 50) {
      dmg = Math.max(1, Math.round(dmg * 0.85));
    }

    this.hp = Math.max(0, this.hp - dmg);
    this.invulnUntil = now + (hasSynergy('colossus_heart') ? 950 : 650);
    wearArmor(1);
    this.addCameraShake(0.22, 0.18);
    this.onToast(`💥 被弾 -${dmg} HP`);

    if (attackerPos) {
      const kb = this.root.position.clone().sub(attackerPos).setY(0).normalize().multiplyScalar(0.6);
      if (!this.isCollidingHorizontal(this.root.position.x + kb.x, this.root.position.z + kb.z, this.root.position.y)) {
        this.root.position.add(kb);
      }
    }

    if (this.hp <= 0) {
      this.hp = Math.max(1, Math.round(maxHp() * DEATH.respawnHpPct));
      this.onDeath();
    }
  }

  swapWeapon() {
    if (isRestrictedLegend(state.weapon)) return this.onToast(`「${state.weapon.name}」装備中は切り替え不可`);
    if (!EQUIPPED.sub_weapon || isRestrictedLegend(EQUIPPED.sub_weapon)) return this.onToast('サブ武器が未装備です');
    const temp = state.weapon;
    state.weapon = EQUIPPED.sub_weapon;
    EQUIPPED.sub_weapon = temp;
    this.syncWeaponVisual();
    this.onToast(`⇄ スイッチ: ${state.weapon.name}`);
    saveGame();
  }

  // ==========================================
  // 1. 通常攻撃（仕様準拠）
  // ==========================================
  triggerAttack() {
    const now = performance.now();
    const w = state.weapon;
    if (!w || now < this.nextAtkTime || now < this.dodgeUntil) return;

    // 時間停止中は攻撃速度2倍（CD半減）
    const cdMult = now < this.timeStopUntil ? 0.5 : 1.0;
    this.nextAtkTime = now + Math.round(w.cd * cdMult);
    this.comboStep = (this.comboStep % 3) + 1;
    this.comboResetTimer = now + 950;

    const dmg = atkTotal(this.hp);
    const isThird = this.comboStep === 3;

    // --- 遠距離武器 ---
    if (RANGED_WEAPON_TYPES.includes(w.type)) {
      this.model.rotation.y = this.yaw;
      if (w.type === 'astral_orb') {
        // 通常攻撃: 軽くホーミングする光弾2WAY（モチーフで3WAY化、各60%ダメージ / 1ヒットにつき星力+6）
        const angles = hasSynergy('awake_astral') ? [-0.18, 0, 0.18] : [-0.11, 0.11];
        angles.forEach((off) => this.fireProjectile(off, Math.round(dmg * 0.6), 0x10b981, {
          homing: true, starPerHit: 6, attackCategory: 'ranged'
        }));
      } else if (w.type === 'chronos_bow') {
        // 通常攻撃: 貫通する次元の矢（距離が遠いほど最大1.6倍／モチーフ2.5倍、命中時刻限+8〜16）
        this.fireProjectile(0, dmg, 0x3b82f6, {
          pierce: true, isChronosArrow: true, attackCategory: 'ranged'
        });
      } else if (w.type === 'spellbook') {
        const colors = [0xff4500, 0x00ffff, 0xffd36a];
        this.fireProjectile(0, Math.round(dmg * 1.15), colors[(this.comboStep - 1) % 3], {
          homing: true, attackCategory: 'ranged'
        });
      } else {
        const col = w.type === 'lightning_staff' ? 0xffff00 : w.type === 'eruption_wand' ? 0xff4500 : 0xffd36a;
        this.fireProjectile(0, dmg, col, { attackCategory: 'ranged' });
      }
      wear(w, DURABILITY.weaponAttack);
      return;
    }

    // --- 近接武器 ---
    const reach = (w.range || 3.2) + (isThird ? 0.65 : 0);
    const colMap = {
      mubi: isThird ? 0x00ffff : 0x38bdf8,
      apocalypse: 0xff1144,
      greatsword: 0xffa07a,
      spear: 0xe0ffff,
      dual: 0x7cf0a0,
      inferno_scythe: 0xff5500,
      demon_sword: 0xb15cff,
      dragon_chain: 0xffd36a
    };
    const color = colMap[w.type] || (isThird ? 0x00ffff : 0x63b3ed);

    this.swingSwordAnimation(this.comboStep);

    // アポカリプス通常攻撃：斬撃＋60%貫通衝撃波（命中時に終末+12）
    if (w.type === 'apocalypse') {
      this.spawnSlashArc(reach, 0xff1144, 1.3);
      const res = this.performMeleeHit(reach, dmg, 0xff1144, false, isThird, 0, 1.0, 'melee');
      this.fireProjectile(0, Math.round(dmg * 0.6), 0xff1144, { pierce: true, maxDist: 14, attackCategory: 'melee' });
      if (res.hits > 0) {
        const add = Math.round(res.hits * 12 * (hasSynergy('awake_apo') ? 1.5 : 1.0));
        this.apoGauge = Math.min(100, this.apoGauge + add);
      }
      wear(w, DURABILITY.weaponAttack);
      return;
    }

    // インフェルノ・サイズ通常攻撃：3段コンボ（1〜2段85%、3段120%＋ボス業火+15%）
    if (w.type === 'inferno_scythe') {
      const mult = isThird ? 1.2 : 0.85;
      this.spawnSlashArc(reach, 0xff5500, isThird ? 1.5 : 1.1);
      const res = this.performMeleeHit(reach, Math.round(dmg * mult), 0xff5500, true, isThird, 0, 0, 'melee');
      if (isThird && res.hits > 0 && this.enemyManager.activeBoss) {
        this.enemyManager.addBossHellfire(15);
      }
      wear(w, DURABILITY.weaponAttack);
      return;
    }

    // 双剣：2連ヒット
    if (w.type === 'dual') {
      this.spawnSlashArc(reach, color, 0.9);
      this.performMeleeHit(reach, Math.round(dmg * 0.65), color, false, false, 0, 0, 'melee');
      setTimeout(() => {
        this.spawnSlashArc(reach, 0x00ffff, 1.1);
        this.performMeleeHit(reach, Math.round(dmg * 0.75), 0x00ffff, false, isThird, 0, 0, 'melee');
      }, 90);
      wear(w, DURABILITY.weaponAttack);
      return;
    }

    const knockback = w.type === 'greatsword' ? 1.4 : 0;
    this.spawnSlashArc(reach, color, w.type === 'greatsword' ? 1.6 : isThird ? 1.4 : 1.0);
    if (isThird || w.type === 'greatsword') this.addCameraShake(0.14, 0.1);

    const res = this.performMeleeHit(reach, Math.round(dmg * (isThird ? 1.25 : 1.0)), color, false, isThird, 0, knockback, 'melee');
    if (res.hits > 0 && w.type === 'mubi' && isThird) {
      const add = res.hits * 10 * (hasSynergy('awake_mubi') ? 2 : 1);
      this.souenGauge = Math.min(120, this.souenGauge + add);
    }
    wear(w, DURABILITY.weaponAttack);
  }

  // ==========================================
  // 2. Eスキル（仕様準拠・45Fエレメンタリスト反撃連携）
  // ==========================================
  triggerSkill() {
    const now = performance.now();
    const w = state.weapon;
    if (!w || now < this.nextSkillTime || now < this.dodgeUntil) return;

    const cdCut = Math.min(0.65, (artifactStat('cdPct') + artifactStat('motif_chronos') + (hasSynergy('chronos_overdrive') ? 15 : 0)) / 100);
    this.nextSkillTime = now + Math.round(w.skill.cd * (1 - cdCut));

    // 45F【魔力反応】エレメンタリストが居ればEスキル使用に反応して反撃！
    this.enemyManager.onPlayerSkillUsed(this.root.position);

    const dmg = atkTotal(this.hp);
    this.model.rotation.y = this.yaw;

    if (w.type === 'mubi') {
      // 【蒼焔連突】突進攻撃・最大8ヒット（1ヒットにつき蒼焔+3）
      this.dodgeDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      this.dodgeUntil = now + 260;
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          this.spawnSlashArc(4.8, 0x00ffff, 1.5);
          const res = this.performMeleeHit(4.8, Math.round(dmg * 0.55), 0x00ffff, false, i === 3, 0, 0, 'skill');
          if (res.hits > 0) {
            const add = res.hits * 3 * (hasSynergy('awake_mubi') ? 2 : 1);
            this.souenGauge = Math.min(120, this.souenGauge + add);
          }
        }, i * 55);
      }
    } else if (w.type === 'apocalypse') {
      // 【メテオ・フォール】指定地点周辺に5発の隕石（140%ダメージ＋0.8秒スタン / 1ヒットにつき終末+8）
      this.callMeteors(5, Math.round(dmg * 1.4), 0xff1144, 800, 8);
    } else if (w.type === 'astral_orb') {
      // 【アストラル・パルス】周囲150px(6.0m)に140%衝撃波＋敵弾消去＋ノックバック（命中1体につき星力+15）
      this.spawnSlashArc(6.2, 0x10b981, 2.2);
      const clearedOrbs = this.enemyManager.clearProjectilesInRadius(this.root.position, 7.5);
      if (clearedOrbs > 0) this.onToast(`✨ 敵弾 ${clearedOrbs}発 消去！`);
      const res = this.performMeleeHit(6.2, Math.round(dmg * 1.4), 0x10b981, true, true, 0, 2.0, 'skill');
      if (res.hits > 0) this.starGauge = Math.min(100, this.starGauge + res.hits * 15);
    } else if (w.type === 'chronos_bow') {
      // 【バックステップ・アロー】無敵状態で後方ステップ＋前方5方向へ90%扇状射撃
      this.invulnUntil = Math.max(this.invulnUntil, now + 350);
      this.dodgeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
      this.dodgeUntil = now + 220;
      [-0.28, -0.14, 0, 0.14, 0.28].forEach((off) => {
        this.fireProjectile(off, Math.round(dmg * 0.9), 0x93c5fd, { isChronosArrow: true, attackCategory: 'skill' });
      });
    } else if (w.type === 'inferno_scythe') {
      // 【ソウル・ハーベスト】220%広範囲斬撃＋最大HP15%回復＋ボス業火+25%
      this.spawnSlashArc(6.0, 0xff5500, 2.0);
      this.addCameraShake(0.2, 0.15);
      this.performMeleeHit(6.0, Math.round(dmg * 2.2), 0xff5500, true, true, 0, 0, 'skill');
      const heal = Math.round(maxHp() * 0.15);
      this.hp = Math.min(maxHp(), this.hp + heal);
      this.onToast(`🔥 ソウル・ハーベスト！HP +${heal}`);
      if (this.enemyManager.activeBoss) this.enemyManager.addBossHellfire(25);
    } else if (w.type === 'bow') {
      [-0.22, 0, 0.22].forEach((off) => this.fireProjectile(off, dmg, 0xffd36a, { attackCategory: 'skill' }));
    } else if (w.type === 'spellbook') {
      this.fireProjectile(-0.15, Math.round(dmg * 1.1), 0xff4500, { homing: true, attackCategory: 'skill' });
      this.fireProjectile(0, Math.round(dmg * 1.2), 0x00ffff, { homing: true, attackCategory: 'skill' });
      this.fireProjectile(0.15, Math.round(dmg * 1.1), 0xffd36a, { homing: true, attackCategory: 'skill' });
    } else if (w.type === 'spear' || w.type === 'dragon_chain') {
      this.dodgeDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      this.dodgeUntil = now + 240;
      this.spawnSlashArc(6.0, 0xe0ffff, 1.5);
      this.performMeleeHit(6.0, Math.round(dmg * 1.75), 0xe0ffff, false, true, 600, 0, 'skill');
    } else if (w.type === 'dual') {
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          this.spawnSlashArc(4.2, i % 2 === 0 ? 0x7cf0a0 : 0x00ffff, 1.3);
          this.performMeleeHit(4.2, Math.round(dmg * 0.7), 0x7cf0a0, true, i === 3, 0, 0, 'skill');
        }, i * 75);
      }
    } else if (w.type === 'eruption_wand') {
      this.callMeteors(3, Math.round(dmg * 1.3), 0xff5500, 500, 0);
    } else {
      this.swingSwordAnimation(3);
      this.spawnSlashArc(5.5, 0xffd36a, 1.8);
      this.addCameraShake(0.18, 0.14);
      this.performMeleeHit(5.5, Math.round(dmg * 1.65), 0xffd36a, true, true, 0, 1.5, 'skill');
    }
    wear(w, DURABILITY.weaponSkill);
  }

  // ==========================================
  // 3. Qスキル（Legend武器固有Qスキル完全再現）
  // ==========================================
  triggerQSkill() {
    const now = performance.now();
    const w = state.weapon;
    const dmg = atkTotal(this.hp);

    if (w.type === 'mubi') {
      // 【蒼焔乱舞】蒼焔80消費。周囲に200%ダメージ×10連撃
      if (this.souenGauge < 80) return this.onToast('蒼焔ゲージ不足 (80必要)');
      this.souenGauge -= 80;
      this.onToast('🔥 蒼焔乱舞（10連撃）！');
      this.addCameraShake(0.35, 0.2);
      for (let i = 0; i < 10; i++) {
        setTimeout(() => {
          this.spawnSlashArc(6.2, i % 2 === 0 ? 0x00ffff : 0x38bdf8, 2.0);
          this.performMeleeHit(6.2, Math.round(dmg * 2.0), 0x00ffff, true, i === 9, 0, 0, 'skill');
        }, i * 55);
      }
      return;
    }

    if (w.type === 'apocalypse') {
      // 【終末の審判・ブラックホール】終末60消費。周囲の敵を引き寄せ＋300%×8連撃
      if (this.apoGauge < 60) return this.onToast('終末ゲージ不足 (60必要)');
      this.apoGauge -= 60;
      this.onToast('🌑 終末の審判・ブラックホール！');
      this.spawnBlackHole(dmg);
      return;
    }

    if (w.type === 'astral_orb') {
      // 【ビット・サモン】星力50消費。6秒間周囲を公転するビット2基展開（0.8秒毎45%レーザー、命中時星力-5）
      if (this.starGauge < 50) return this.onToast('星力ゲージ不足 (50必要)');
      this.starGauge -= 50;
      this.spawnAstralBits(2, 6);
      this.onToast('✨ ビット・サモン展開（6秒間）！');
      return;
    }

    if (w.type === 'chronos_bow') {
      // 【クロノ・オーラ】刻限50消費。4秒間周囲に時空結界展開（連射UP＋範囲スロー＆0.5秒毎50%ダメ）
      if (this.chronosGauge < 50) return this.onToast('刻限ゲージ不足 (50必要)');
      this.chronosGauge -= 50;
      this.activateChronoAura(4);
      this.onToast('⏳ クロノ・オーラ展開（4秒間）！');
      return;
    }

    if (w.type === 'inferno_scythe') {
      // 【ヘルファイア・クラッシュ】ボス業火50%以上で発動。業火全消費し吸引起爆（100%時は現在HP50%消費で最大3600%）
      const boss = this.enemyManager.activeBoss;
      if (!boss || boss.hellfireGauge < 50) {
        return this.onToast('ボスの業火ゲージが50%以上必要です');
      }
      const hf = boss.hellfireGauge;
      boss.hellfireGauge = 0;

      let mult = 24.0 * (hf / 100);
      if (hf >= 100) {
        const hpCost = Math.floor(this.hp * 0.5);
        this.hp = Math.max(1, this.hp - hpCost);
        mult = 36.0;
        this.onToast('💥 業火100%起爆！ヘルファイア・クラッシュ (3600%)！');
      } else {
        this.onToast(`🔥 ヘルファイア・クラッシュ (${Math.round(mult * 100)}%)！`);
      }

      // 周囲の雑魚をボス周辺へ吸引＆起爆＋2秒スタン
      for (const e of [...this.enemyManager.enemies]) {
        if (!e.isBoss && e.root.position.distanceTo(boss.root.position) <= 10.0) {
          e.root.position.copy(boss.root.position).add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
        }
        if (e.root.position.distanceTo(boss.root.position) <= 8.5) {
          this.enemyManager.damageEnemy(e, Math.round(dmg * mult), {
            color: 0xff4500, isCrit: true, stunMs: 2000, attackCategory: 'skill'
          });
        }
      }
      this.addCameraShake(0.4, 0.25);
      this.spawnSlashArc(8.5, 0xff4500, 2.8);
      return;
    }

    if (now < this.nextQTime) return;
    this.nextQTime = now + 4000;
    this.onToast('⚡ 衝撃波！');
    this.spawnSlashArc(5.2, 0x4fd1c5, 2.0);
    this.performMeleeHit(5.2, Math.round(dmg * 1.5), 0x4fd1c5, true, true, 0, 0, 'skill');
  }

  // ==========================================
  // 4. Zスキル（Legend専用奥義 & 汎用ExS完全再現）
  // ==========================================
  triggerExS() {
    const w = state.weapon;
    const dmg = atkTotal(this.hp);

    if (w.type === 'mubi') {
      // 【蒼焔・絶対凍結陣】蒼焔120消費。周囲に300%×8連撃＋3秒凍結（解除時30%破砕追撃）
      if (this.souenGauge < 120) return this.onToast('蒼焔ゲージ不足 (120必要)');
      this.souenGauge = 0;
      this.onToast('❄️ 蒼焔・絶対凍結陣（8連撃＋凍結）！！');
      this.addCameraShake(0.45, 0.28);
      this.onSlowMo(0.4);
      this.spawnFrostFlashLines(20);

      for (let i = 0; i < 8; i++) {
        setTimeout(() => {
          this.spawnSlashArc(8.0, 0x00ffff, 2.5);
          this.performMeleeHit(8.0, Math.round(dmg * 3.0), 0x00ffff, true, true, i === 7 ? 3000 : 0, 0, 'skill');
        }, i * 65);
      }
      // 3秒後の凍結解除時に30%破砕追撃
      setTimeout(() => {
        this.onToast('💎 氷結破砕追撃！');
        this.performMeleeHit(9.0, Math.round(dmg * 0.3 * 8), 0xffffff, true, true, 0, 0, 'skill');
      }, 3000);
      return;
    }

    if (w.type === 'apocalypse') {
      // 【アポカリプス・ノヴァ】終末100消費。3500%ダメージ＋4秒スタン＋ボスバリア破壊＋最大HP30%回復
      if (this.apoGauge < 100) return this.onToast('終末ゲージ不足 (100必要)');
      this.apoGauge = 0;
      this.onToast('☄️ アポカリプス・ノヴァ（3500%＋バリア破壊）！！');
      this.addCameraShake(0.6, 0.38);
      this.spawnSlashArc(12.0, 0xff1144, 3.5);
      this.callMeteors(8, Math.round(dmg * 1.5), 0xff1144, 1000, 0);

      // ボスの無敵バリアを即座に破壊！
      if (this.enemyManager.activeBoss && this.enemyManager.activeBoss.hasBarrier) {
        this.enemyManager.breakBossBarrier('☄️ アポカリプス・ノヴァがボスの無敵バリアを粉砕！');
      }

      this.performMeleeHit(12.0, Math.round(dmg * 35.0), 0xff1144, true, true, 4000, 0, 'skill');
      const heal = Math.round(maxHp() * 0.30);
      this.hp = Math.min(maxHp(), this.hp + heal);
      return;
    }

    if (w.type === 'astral_orb') {
      // 【アストラル・カノン】星力100消費。直線850px・幅96pxの極太ビームで2800%ダメージ＋2.5秒スタン
      if (this.starGauge < 100) return this.onToast('星力ゲージ不足 (100必要)');
      this.starGauge = 0;
      this.onToast('🌟 アストラル・カノン（2800%極太ビーム）！！');
      this.fireAstralCannon(Math.round(dmg * 28.0));
      return;
    }

    if (w.type === 'chronos_bow') {
      // 【エンド・オブ・タイム】刻限100消費。4秒間時間停止（解除時に「1800%＋命中数×300%」炸裂）
      if (this.chronosGauge < 100) return this.onToast('刻限ゲージ不足 (100必要)');
      this.chronosGauge = 0;
      this.activateEndOfTime(4, dmg);
      return;
    }

    if (w.type === 'inferno_scythe') {
      // 【メギドフレイム】汎用ExSゲージ100消費。周囲に2500%ダメージ＋2.5秒スタン＋ボス業火+75%
      if (state.exsGauge < EXS_GAUGE_MAX) return;
      state.exsGauge = 0;
      this.onToast('🔥 メギドフレイム（2500%＋業火+75%）！！');
      this.addCameraShake(0.5, 0.3);
      this.spawnSlashArc(11.0, 0xff4500, 3.2);
      this.performMeleeHit(11.0, Math.round(dmg * 25.0), 0xff4500, true, true, 2500, 0, 'skill');
      if (this.enemyManager.activeBoss) this.enemyManager.addBossHellfire(75);
      return;
    }

    // 汎用ExS（ギガ・ブレイカー / 疾風・影閃八重咲き / 百鬼夜行・冥界陣）
    if (state.exsGauge < EXS_GAUGE_MAX) return;
    state.exsGauge = 0;
    const exsId = state.equippedExsId || 'giga_breaker';
    const exsDef = EXS_LIST[exsId] || EXS_LIST.giga_breaker;
    this.onToast(`💥 ${exsDef.name}！！`);

    if (exsId === 'shadow_flash') {
      this.executeGaleSlash8(dmg);
    } else if (exsId === 'hell_legion') {
      this.executePandemonium(dmg);
    } else {
      this.addCameraShake(0.4, 0.25);
      this.spawnSlashArc(9.5, 0xffd36a, 2.8);
      this.performMeleeHit(9.5, Math.round(dmg * 15.0), 0xffd36a, true, true, 3000, 0, 'skill');
    }

    if (exsId === 'gale_slash') {
      this.executeGaleSlash8(dmg);
    } else if (exsId === 'pandemonium') {
      this.executePandemonium(dmg);
    } else {
      this.addCameraShake(0.4, 0.25);
      this.spawnSlashArc(9.5, 0xffd36a, 2.8);
      this.performMeleeHit(9.5, Math.round(dmg * 10.0), 0xffd36a, true, true, 3000, 0, 'skill');
    }
  }

  // ---- アポカリプスQ：ブラックホール生成 ----
  spawnBlackHole(dmg) {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const center = this.root.position.clone().addScaledVector(forward, 5.5);

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x1a0022, wireframe: true })
    );
    sphere.position.set(center.x, 1.5, center.z);
    this.scene.add(sphere);

    this.blackHoles.push({
      mesh: sphere,
      pos: center,
      ticksLeft: 8,
      tickTimer: 0,
      dmgPerTick: Math.round(dmg * 3.0)
    });
  }

  // ---- アストラルZ：極太直線ビーム（アストラル・カノン） ----
  fireAstralCannon(totalDmg) {
    this.addCameraShake(0.45, 0.28);
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    const length = 34;

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, length, 16),
      new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.9 })
    );
    beam.position.copy(this.root.position).add(new THREE.Vector3(0, 1.3, 0)).addScaledVector(forward, length / 2);
    beam.rotation.z = Math.PI / 2;
    beam.rotation.y = this.yaw + Math.PI / 2;
    this.scene.add(beam);
    this.slashEffects.push({ mesh: beam, life: 0.55, maxLife: 0.55 });

    // 直線上の敵すべてに2800%＋2.5秒スタン
    const start = this.root.position;
    for (const e of [...this.enemyManager.enemies]) {
      const toE = e.root.position.clone().sub(start).setY(0);
      const proj = toE.dot(forward);
      if (proj < 0 || proj > length) continue;
      const perp = Math.hypot(toE.x - forward.x * proj, toE.z - forward.z * proj);
      if (perp <= 2.4 + 0.8 * e.scale) {
        this.enemyManager.damageEnemy(e, totalDmg, {
          color: 0x10b981, isCrit: true, stunMs: 2500, attackCategory: 'skill'
        });
      }
    }
  }

  // ---- クロノスQ：時空結界（クロノ・オーラ） ----
  activateChronoAura(sec) {
    if (this.chronoAuraMesh) this.scene.remove(this.chronoAuraMesh);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 6.8, 32),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, side: THREE.DoubleSide, transparent: true, opacity: 0.35 })
    );
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    this.chronoAuraMesh = ring;
    this.chronoAuraUntil = performance.now() + sec * 1000;
    this.chronoTickTimer = 0;
  }

  // ---- クロノスZ：時間停止（エンド・オブ・タイム） ----
  activateEndOfTime(sec, baseDmg) {
    const now = performance.now();
    this.timeStopUntil = now + sec * 1000;
    this.timeStopHits.clear();
    this.onToast('⏱️ エンド・オブ・タイム（4秒間時間停止）！！');
    this.addCameraShake(0.3, 0.2);

    // 周囲14m以内の敵を4秒間完全停止
    for (const e of this.enemyManager.enemies) {
      if (e.root.position.distanceTo(this.root.position) <= 14.0) {
        e.stunUntil = Math.max(e.stunUntil, this.timeStopUntil);
        this.timeStopHits.set(e, 0);
      }
    }

    // 4秒後の時間停止解除時に炸裂ダメージ！
    setTimeout(() => {
      this.onToast('💥 時空崩壊・炸裂ダメージ！！');
      this.addCameraShake(0.5, 0.3);
      for (const [e, hitCnt] of this.timeStopHits.entries()) {
        if (e && e.hp > 0) {
          const mult = 18.0 + hitCnt * 3.0;
          this.enemyManager.damageEnemy(e, Math.round(baseDmg * mult), {
            color: 0x3b82f6, isCrit: true, attackCategory: 'skill'
          });
        }
      }
      this.timeStopHits.clear();
    }, sec * 1000);
  }

  spawnFrostFlashLines(count) {
    const center = this.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BoxGeometry(0.08, 0.08, 16);
      const mat = new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0x00ffff : 0xffffff, transparent: true, opacity: 0.95 });
      const line = new THREE.Mesh(geo, mat);
      line.position.copy(center).add(new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 10
      ));
      line.rotation.set((Math.random() - 0.5) * 1.2, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 1.2);
      this.scene.add(line);
      this.slashEffects.push({ mesh: line, life: 0.45, maxLife: 0.45 });
    }
  }

  callMeteors(count, dmgPerMeteor, color, stunMs = 800, apoGainPerHit = 0) {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const baseTarget = this.root.position.clone().addScaledVector(forward, 6.0);

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        let targetPos = baseTarget.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10));
        if (this.enemyManager.enemies.length > 0) {
          const e = this.enemyManager.enemies[i % this.enemyManager.enemies.length];
          targetPos = e.root.position.clone();
        }

        const meteor = new THREE.Mesh(
          new THREE.DodecahedronGeometry(1.1, 0),
          new THREE.MeshBasicMaterial({ color })
        );
        meteor.position.set(targetPos.x + 3, 18, targetPos.z + 3);
        this.scene.add(meteor);

        this.skillObjects.push({
          type: 'meteor',
          mesh: meteor,
          target: targetPos,
          vel: targetPos.clone().sub(meteor.position).normalize().multiplyScalar(0.85),
          dmg: dmgPerMeteor,
          color,
          stunMs,
          apoGainPerHit
        });
      }, i * 100);
    }
  }

  spawnAstralBits(count, durationSec) {
    this.clearAstralBits();
    this.bitActiveUntil = performance.now() + durationSec * 1000;
    for (let i = 0; i < count; i++) {
      const bit = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.26, 0),
        new THREE.MeshBasicMaterial({ color: 0x10b981 })
      );
      this.scene.add(bit);
      this.astralBits.push({ mesh: bit, angleOffset: (Math.PI * 2 * i) / count });
    }
  }

  clearAstralBits() {
    for (const b of this.astralBits) this.scene.remove(b.mesh);
    this.astralBits = [];
  }

  executeGaleSlash8(dmg) {
    this.invulnUntil = performance.now() + 1200;
    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        const enemies = this.enemyManager.enemies;
        if (enemies.length > 0) {
          const target = enemies[i % enemies.length];
          const ang = (Math.PI * 2 * i) / 8;
          const nx = target.root.position.x + Math.cos(ang) * 1.8;
          const nz = target.root.position.z + Math.sin(ang) * 1.8;
          if (!this.isCollidingHorizontal(nx, nz, this.root.position.y)) {
            this.root.position.set(nx, this.root.position.y, nz);
          }
          this.model.rotation.y = Math.atan2(-(target.root.position.x - nx), -(target.root.position.z - nz));
        }
        this.spawnAfterimage();
        this.spawnSlashArc(4.8, 0x7cf0a0, 1.5);
        this.addCameraShake(0.1, 0.08);
        this.performMeleeHit(4.8, Math.round(dmg * 1.4), 0x7cf0a0, true, true, 0, 0, 'skill');
      }, i * 95);
    }
  }

  executePandemonium(dmg) {
    this.addCameraShake(0.4, 0.25);
    for (let i = 0; i < 10; i++) {
      setTimeout(() => {
        let pos = this.root.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12));
        if (this.enemyManager.enemies.length > 0) {
          const e = this.enemyManager.enemies[i % this.enemyManager.enemies.length];
          pos = e.root.position.clone();
        }

        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(1.1, 1.1, 7.0, 12),
          new THREE.MeshBasicMaterial({ color: 0xb15cff, transparent: true, opacity: 0.85 })
        );
        pillar.position.set(pos.x, 3.5, pos.z);
        this.scene.add(pillar);
        this.slashEffects.push({ mesh: pillar, life: 0.4, maxLife: 0.4 });

        for (const e of [...this.enemyManager.enemies]) {
          if (e.root.position.distanceTo(pos) <= 2.8) {
            this.enemyManager.damageEnemy(e, Math.round(dmg * 1.35), {
              color: 0xb15cff, isCrit: true, stunMs: 1200, attackCategory: 'skill'
            });
          }
        }
      }, i * 85);
    }
  }

  triggerDodge() {
    const now = performance.now();
    if (now < this.nextDodgeTime || now < this.dodgeUntil) return;
    this.dodgeUntil = now + 240;
    this.nextDodgeTime = now + 850;

    const moveDir = this.getInputMoveDirection();
    if (moveDir.lengthSq() > 0) {
      this.dodgeDir.copy(moveDir).normalize();
      this.model.rotation.y = Math.atan2(-this.dodgeDir.x, -this.dodgeDir.z);
    } else {
      const ang = this.model.rotation.y;
      this.dodgeDir.set(-Math.sin(ang), 0, -Math.cos(ang)).normalize();
    }
    for (let i = 0; i < 3; i++) setTimeout(() => this.spawnAfterimage(), i * 45);
  }

  performMeleeHit(reach, dmg, color, isAllAround = false, isCrit = false, stunMs = 0, knockback = 0, attackCategory = 'melee') {
    const forward = new THREE.Vector3(-Math.sin(this.model.rotation.y), 0, -Math.cos(this.model.rotation.y));
    const origin = this.root.position.clone().add(new THREE.Vector3(0, 1.0, 0));

    let hits = 0;
    let kills = 0;

    for (const enemy of [...this.enemyManager.enemies]) {
      const toEnemy = enemy.root.position.clone().sub(origin);
      const horizDist = Math.hypot(toEnemy.x, toEnemy.z);
      if (horizDist > reach + 0.8 * enemy.scale) continue;

      const dirNorm = new THREE.Vector3(toEnemy.x, 0, toEnemy.z).normalize();
      if (isAllAround || forward.dot(dirNorm) > 0.2 || horizDist < 2.0) {
        if (this.timeStopHits.has(enemy)) {
          this.timeStopHits.set(enemy, this.timeStopHits.get(enemy) + 1);
        }
        const killed = this.enemyManager.damageEnemy(enemy, dmg, {
          color, isCrit, stunMs, attackCategory, playerPos: this.root.position, playerRef: this
        });
        hits++;
        if (killed) kills++;
        else if (knockback > 0 && !enemy.isBoss) {
          const nx = enemy.root.position.x + dirNorm.x * knockback;
          const nz = enemy.root.position.z + dirNorm.z * knockback;
          if (!this.world.isBlockedForEntity(nx, nz, 0.5 * enemy.scale)) {
            enemy.root.position.set(nx, 0, nz);
          }
        }
      }
    }

    for (const box of [...this.world.destructibles]) {
      const toBox = box.position.clone().sub(origin);
      const horizDist = Math.hypot(toBox.x, toBox.z);
      if (horizDist > reach + 1.0 || Math.abs(toBox.y) > 2.4) continue;

      const dirNorm = new THREE.Vector3(toBox.x, 0, toBox.z).normalize();
      if (isAllAround || forward.dot(dirNorm) > 0.2 || horizDist < 1.8) {
        this.world.damageBlock(box, dmg);
        hits++;
      }
    }

    if (hits > 0) {
      const exsMult = hasSynergy('chronos_overdrive') ? 1.25 : 1.0;
      state.exsGauge = Math.min(EXS_GAUGE_MAX, state.exsGauge + Math.round(hits * 8 * exsMult));
    }
    return { hits, kills };
  }

  fireProjectile(angleOffset, dmg, color = 0xffd36a, opts = {}) {
    const w = state.weapon;
    const ang = this.yaw + angleOffset;
    const pitchFactor = Math.max(-0.3, Math.min(0.5, -this.pitch + 0.15));

    const dir = new THREE.Vector3(
      -Math.sin(ang) * Math.cos(pitchFactor),
      Math.sin(pitchFactor),
      -Math.cos(ang) * Math.cos(pitchFactor)
    ).normalize();

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshBasicMaterial({ color })
    );
    mesh.position.copy(this.root.position).add(new THREE.Vector3(0, 1.3, 0)).addScaledVector(dir, 0.8);
    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      vel: dir.multiplyScalar(w.projSpeed || 0.85),
      startPos: mesh.position.clone(),
      maxDist: w.range || 28,
      dmg,
      color,
      hitSet: new Set(),
      attackCategory: opts.attackCategory || 'ranged',
      ...opts
    });
  }

  updateProjectiles() {
    this.projectiles = this.projectiles.filter((p) => {
      if (p.homing && this.enemyManager.enemies.length > 0) {
        let nearest = null;
        let minD = 999;
        for (const e of this.enemyManager.enemies) {
          const d = e.root.position.distanceTo(p.mesh.position);
          if (d < minD) { minD = d; nearest = e; }
        }
        if (nearest) {
          const targetPos = nearest.root.position.clone().add(new THREE.Vector3(0, 1.0, 0));
          const toTarget = targetPos.sub(p.mesh.position).normalize();
          const spd = p.vel.length();
          p.vel.lerp(toTarget.multiplyScalar(spd), 0.14).normalize().multiplyScalar(spd);
        }
      }

      p.mesh.position.add(p.vel);
      const traveled = p.mesh.position.distanceTo(p.startPos);

      let hitTarget = false;
      for (const enemy of [...this.enemyManager.enemies]) {
        if (p.hitSet.has(enemy)) continue;
        const hitR = 0.85 * enemy.scale;
        if (Math.hypot(p.mesh.position.x - enemy.root.position.x, p.mesh.position.z - enemy.root.position.z) < hitR &&
            p.mesh.position.y >= 0 && p.mesh.position.y <= 2.3 * enemy.scale) {
          p.hitSet.add(enemy);
          let finalDmg = p.dmg;

          if (p.isChronosArrow) {
            const ratio = Math.min(1, traveled / 25);
            const maxBonus = hasSynergy('awake_chronos') ? 1.5 : 0.6;
            finalDmg = Math.round(p.dmg * (1 + maxBonus * ratio));
            const gain = Math.round((8 + 8 * ratio) * (hasSynergy('awake_chronos') ? 1.5 : 1));
            this.chronosGauge = Math.min(100, this.chronosGauge + gain);
          }
          if (p.starPerHit) {
            this.starGauge = Math.min(100, this.starGauge + p.starPerHit);
          }
          if (p.isBitLaser && !hasSynergy('awake_astral')) {
            this.starGauge = Math.max(0, this.starGauge - 5);
          }
          if (this.timeStopHits.has(enemy)) {
            this.timeStopHits.set(enemy, this.timeStopHits.get(enemy) + 1);
          }

          this.enemyManager.damageEnemy(enemy, finalDmg, {
            color: p.color, attackCategory: p.attackCategory, playerPos: this.root.position, playerRef: this
          });
          state.exsGauge = Math.min(EXS_GAUGE_MAX, state.exsGauge + 6);
          if (!p.pierce) { hitTarget = true; break; }
        }
      }

      if (!hitTarget) {
        for (const wall of this.world.walls) {
          if (p.hitSet.has(wall)) continue;
          const hx = wall.userData.halfX || 1.0;
          const hy = wall.userData.halfY || 1.0;
          const hz = wall.userData.halfZ || 1.0;
          if (Math.abs(p.mesh.position.x - wall.position.x) < hx + 0.15 &&
              Math.abs(p.mesh.position.y - wall.position.y) < hy + 0.15 &&
              Math.abs(p.mesh.position.z - wall.position.z) < hz + 0.15) {
            p.hitSet.add(wall);
            if (wall.userData.destructible) {
              this.world.damageBlock(wall, p.dmg);
              if (!p.pierce) { hitTarget = true; break; }
            } else {
              hitTarget = true;
              break;
            }
          }
        }
      }

      const expired = hitTarget || traveled >= p.maxDist || p.mesh.position.y <= 0;
      if (expired) {
        this.world.spawnHitSpark(p.mesh.position, p.color);
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      }
      return !expired;
    });
  }

  swingSwordAnimation(step) {
    const startRot = step === 2 ? -1.4 : 1.4;
    const endRot = -startRot;
    this.swordPivot.rotation.y = startRot;
    this.swordPivot.rotation.x = 0.8;
    let t = 0;
    const anim = () => {
      t += 0.16;
      if (t >= 1) { this.swordPivot.rotation.set(0, 0, 0); return; }
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
    if (this.isUiOpen()) return new THREE.Vector3();
    let f = 0, r = 0;
    if (this.keys['KeyW']) f += 1;
    if (this.keys['KeyS']) f -= 1;
    if (this.keys['KeyD']) r += 1;
    if (this.keys['KeyA']) r -= 1;
    const dir = new THREE.Vector3();
    if (f === 0 && r === 0) return dir;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    dir.addScaledVector(forward, f).addScaledVector(right, r);
    return dir.normalize();
  }

  isCollidingHorizontal(x, z, pY) {
    const feet = pY + 0.05;
    const head = pY + PLAYER_HEIGHT;
    for (const wall of this.world.walls) {
      const hx = wall.userData.halfX || 1.0;
      const hy = wall.userData.halfY || 1.0;
      const hz = wall.userData.halfZ || 1.0;
      if (x > wall.position.x - hx - PLAYER_RADIUS && x < wall.position.x + hx + PLAYER_RADIUS &&
          z > wall.position.z - hz - PLAYER_RADIUS && z < wall.position.z + hz + PLAYER_RADIUS) {
        if (feet < wall.position.y + hy && head > wall.position.y - hy) return true;
      }
    }
    return false;
  }

  update(dt) {
    const now = performance.now();
    if (now > this.comboResetTimer) this.comboStep = 0;
    const mHp = maxHp();
    if (this.hp > mHp) this.hp = mHp;

    // インフェルノ・サイズ装備中、HP50%以下でExSゲージ自動増加
    if (state.weapon?.type === 'inferno_scythe' && this.hp <= mHp * 0.5) {
      this.exsRegenAcc += dt;
      if (this.exsRegenAcc >= 0.5) {
        this.exsRegenAcc -= 0.5;
        state.exsGauge = Math.min(EXS_GAUGE_MAX, state.exsGauge + 4);
      }
    }

    // 遺物リジェネ回復
    const regen = artifactStat('regen') + (hasSynergy('immortal_king') ? Math.ceil(mHp * 0.01) : 0);
    if (regen > 0 && this.hp < mHp) {
      this.regenAcc += dt;
      if (this.regenAcc >= 1.0) {
        this.regenAcc -= 1.0;
        const mult = (hasSynergy('absolute_aegis') && this.hp <= mHp * 0.5) ? 2 : 1;
        this.hp = Math.min(mHp, this.hp + regen * mult);
      }
    }

    // アストラル・ビット公転＆0.8秒毎45%レーザー発射
    if (this.astralBits.length > 0) {
      if (now > this.bitActiveUntil) {
        this.clearAstralBits();
      } else {
        const t = now * 0.004;
        this.astralBits.forEach((b) => {
          const ang = t + b.angleOffset;
          b.mesh.position.set(
            this.root.position.x + Math.cos(ang) * 1.45,
            this.root.position.y + 1.5 + Math.sin(t * 2 + b.angleOffset) * 0.15,
            this.root.position.z + Math.sin(ang) * 1.45
          );
          b.mesh.rotation.y += dt * 3;
        });

        this.bitFireTimer += dt;
        if (this.bitFireTimer >= 0.8 && this.enemyManager.enemies.length > 0) {
          this.bitFireTimer = 0;
          const dmg = Math.round(atkTotal(this.hp) * 0.45);
          this.fireProjectile(0, dmg, 0x10b981, { homing: true, isBitLaser: true, attackCategory: 'skill' });
        }
      }
    }

    // クロノ・オーラ（時空結界）更新
    if (this.chronoAuraMesh) {
      if (now > this.chronoAuraUntil) {
        this.scene.remove(this.chronoAuraMesh);
        this.chronoAuraMesh = null;
      } else {
        this.chronoAuraMesh.position.set(this.root.position.x, this.root.position.y + 0.08, this.root.position.z);
        this.chronoAuraMesh.rotation.z += dt * 1.5;
        this.chronoTickTimer += dt;
        if (this.chronoTickTimer >= 0.5) {
          this.chronoTickTimer = 0;
          const dmg = Math.round(atkTotal(this.hp) * 0.5);
          for (const e of [...this.enemyManager.enemies]) {
            if (e.root.position.distanceTo(this.root.position) <= 6.8) {
              e.slowUntil = now + 700;
              this.enemyManager.damageEnemy(e, dmg, { color: 0x3b82f6, attackCategory: 'skill' });
            }
          }
        }
      }
    }

    // ブラックホール（アポカリプスQ）吸引＆8連撃
    this.blackHoles = this.blackHoles.filter((bh) => {
      bh.mesh.rotation.y += dt * 6;
      bh.mesh.rotation.x += dt * 4;
      bh.tickTimer += dt;

      // 周囲の敵をブラックホール中心へ引き寄せる
      for (const e of this.enemyManager.enemies) {
        if (!e.isBoss && e.root.position.distanceTo(bh.pos) <= 9.5) {
          const pull = bh.pos.clone().sub(e.root.position).setY(0).normalize().multiplyScalar(0.12);
          e.root.position.add(pull);
        }
      }

      if (bh.tickTimer >= 0.25) {
        bh.tickTimer = 0;
        bh.ticksLeft--;
        for (const e of [...this.enemyManager.enemies]) {
          if (e.root.position.distanceTo(bh.pos) <= 7.0) {
            this.enemyManager.damageEnemy(e, bh.dmgPerTick, {
              color: 0xb15cff, isCrit: bh.ticksLeft === 0, attackCategory: 'skill'
            });
          }
        }
      }

      if (bh.ticksLeft <= 0) {
        this.scene.remove(bh.mesh);
        return false;
      }
      return true;
    });

    // 落下メテオ更新
    this.skillObjects = this.skillObjects.filter((obj) => {
      if (obj.type === 'meteor') {
        obj.mesh.position.add(obj.vel);
        obj.mesh.rotation.x += 0.2;
        obj.mesh.rotation.y += 0.2;
        if (obj.mesh.position.y <= 0.5) {
          this.addCameraShake(0.22, 0.16);
          this.spawnSlashArc(4.2, obj.color, 1.5);
          for (const e of [...this.enemyManager.enemies]) {
            if (e.root.position.distanceTo(obj.target) <= 4.2) {
              this.enemyManager.damageEnemy(e, obj.dmg, {
                color: obj.color, isCrit: true, stunMs: obj.stunMs, attackCategory: 'skill'
              });
              if (obj.apoGainPerHit > 0) {
                const add = Math.round(obj.apoGainPerHit * (hasSynergy('awake_apo') ? 1.5 : 1.0));
                this.apoGauge = Math.min(100, this.apoGauge + add);
              }
            }
          }
          for (const box of [...this.world.destructibles]) {
            if (box.position.distanceTo(obj.target) <= 4.2) {
              this.world.damageBlock(box, obj.dmg);
            }
          }
          this.scene.remove(obj.mesh);
          return false;
        }
      }
      return true;
    });

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
      const hx = wall.userData.halfX || 1.0;
      const hy = wall.userData.halfY || 1.0;
      const hz = wall.userData.halfZ || 1.0;
      if (this.root.position.x > wall.position.x - hx - PLAYER_RADIUS && this.root.position.x < wall.position.x + hx + PLAYER_RADIUS &&
          this.root.position.z > wall.position.z - hz - PLAYER_RADIUS && this.root.position.z < wall.position.z + hz + PLAYER_RADIUS) {
        const top = wall.position.y + hy;
        const bottom = wall.position.y - hy;
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
