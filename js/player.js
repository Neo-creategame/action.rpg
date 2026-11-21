import * as THREE from 'three';
import {
  DURABILITY, RANGED_WEAPON_TYPES, isRestrictedLegend, EXS_LIST, EXS_GAUGE_MAX, DEATH
} from './data.js';
import {
  state, EQUIPPED, maxHp, atkTotal, takeDamage, wear, wearArmor,
  hasSynergy, artifactStat, rollWeapon, saveGame
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

    // Legend武器固有ゲージ・状態
    this.souenGauge = 0;     // 無尾
    this.apoGauge = 0;       // アポカリプス
    this.starGauge = 0;      // アストラル・オーブ
    this.chronosGauge = 0;   // クロノスボウ
    this.scytheSouls = 0;    // インフェルノ・サイズ魂スタック

    // アストラル・オーブの浮遊ビット群
    this.astralBits = [];
    this.bitActiveUntil = 0;
    this.bitFireTimer = 0;

    // 落下メテオ・光線・魔力柱などの3Dスキル演出オブジェクト
    this.skillObjects = [];

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

    // 右手武器ピボット
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

    // 左手武器メッシュ（双剣装備時のみ表示）
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
  // 1. 通常攻撃（全武器種の固有アクション）
  // ==========================================
  triggerAttack() {
    const now = performance.now();
    const w = state.weapon;
    if (!w || now < this.nextAtkTime || now < this.dodgeUntil) return;

    this.nextAtkTime = now + w.cd;
    this.comboStep = (this.comboStep % 3) + 1;
    this.comboResetTimer = now + 950;

    // インフェルノ・サイズの魂スタックによる攻撃力ボーナス
    const soulMult = (w.type === 'inferno_scythe') ? (1 + this.scytheSouls * 0.03) : 1.0;
    const dmg = Math.round(atkTotal(this.hp) * soulMult);
    const isThird = this.comboStep === 3;

    // 遠距離武器種
    if (RANGED_WEAPON_TYPES.includes(w.type)) {
      this.model.rotation.y = this.yaw;
      if (w.type === 'astral_orb') {
        const angles = hasSynergy('awake_astral') ? [-0.18, 0, 0.18] : [-0.12, 0.12];
        angles.forEach((off) => this.fireProjectile(off, Math.round(dmg * 0.65), 0x10b981, { homing: true, starPerHit: 6 }));
      } else if (w.type === 'chronos_bow') {
        this.fireProjectile(0, dmg, 0x3b82f6, { pierce: true, isChronosArrow: true });
      } else if (w.type === 'spellbook') {
        const colors = [0xff4500, 0x00ffff, 0xffd36a];
        const col = colors[(this.comboStep - 1) % 3];
        this.fireProjectile(0, Math.round(dmg * 1.15), col, { homing: true });
      } else {
        const col = w.type === 'lightning_staff' ? 0xffff00 : w.type === 'eruption_wand' ? 0xff4500 : 0xffd36a;
        this.fireProjectile(0, dmg, col);
      }
      wear(w, DURABILITY.weaponAttack);
      return;
    }

    // 近接武器種
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

    // 双剣は2連ヒット判定
    if (w.type === 'dual') {
      this.spawnSlashArc(reach, color, 0.9);
      this.performMeleeHit(reach, Math.round(dmg * 0.65), color, false, false);
      setTimeout(() => {
        this.spawnSlashArc(reach, 0x00ffff, 1.1);
        this.performMeleeHit(reach, Math.round(dmg * 0.75), 0x00ffff, false, isThird);
      }, 90);
      wear(w, DURABILITY.weaponAttack);
      return;
    }

    // 大剣は広範囲扇形＆ノックバック
    const knockback = (w.type === 'greatsword' || w.type === 'apocalypse') ? 1.4 : 0;
    this.spawnSlashArc(reach, color, w.type === 'greatsword' ? 1.6 : isThird ? 1.4 : 1.0);
    if (isThird || w.type === 'greatsword') this.addCameraShake(0.14, 0.1);

    const res = this.performMeleeHit(reach, Math.round(dmg * (isThird ? 1.25 : 1.0)), color, w.type === 'inferno_scythe', isThird, 0, knockback);
    if (res.hits > 0) {
      if (w.type === 'mubi' && isThird) {
        const add = res.hits * 10 * (hasSynergy('awake_mubi') ? 2 : 1);
        this.souenGauge = Math.min(120, this.souenGauge + add);
      }
      if (w.type === 'apocalypse') {
        const add = Math.round(res.hits * 12 * (hasSynergy('awake_apo') ? 1.5 : 1.0));
        this.apoGauge = Math.min(100, this.apoGauge + add);
      }
    }
    if (w.type === 'inferno_scythe' && res.kills > 0) {
      this.scytheSouls = Math.min(20, this.scytheSouls + res.kills);
      const heal = Math.round(maxHp() * 0.06 * res.kills);
      this.hp = Math.min(maxHp(), this.hp + heal);
      this.onToast(`💀 魂吸収 (${this.scytheSouls}/20) HP +${heal}`);
    }
    wear(w, DURABILITY.weaponAttack);
  }

  // ==========================================
  // 2. 武器スキル [Eキー]（全武器固有スキル）
  // ==========================================
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
      // 後方跳躍＋5WAY刻限矢＋周囲減速
      this.dodgeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
      this.dodgeUntil = now + 200;
      [-0.28, -0.14, 0, 0.14, 0.28].forEach((off) => this.fireProjectile(off, Math.round(dmg * 0.9), 0x93c5fd, { isChronosArrow: true }));
      this.onSlowMo(0.4);
    } else if (w.type === 'astral_orb') {
      // ビット展開（10秒間、周囲を浮遊して自動ホーミング射撃）
      this.spawnAstralBits(hasSynergy('awake_astral') ? 5 : 3, 10);
      this.onToast('✨ アストラル・ビット展開！');
    } else if (w.type === 'spellbook') {
      // 3属性連続魔術バースト
      this.fireProjectile(-0.15, Math.round(dmg * 1.1), 0xff4500, { homing: true });
      this.fireProjectile(0, Math.round(dmg * 1.2), 0x00ffff, { homing: true });
      this.fireProjectile(0.15, Math.round(dmg * 1.1), 0xffd36a, { homing: true });
    } else if (w.type === 'spear' || w.type === 'dragon_chain') {
      // 前方突進貫通
      this.dodgeDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      this.dodgeUntil = now + 240;
      this.spawnSlashArc(6.0, 0xe0ffff, 1.5);
      this.performMeleeHit(6.0, Math.round(dmg * 1.75), 0xe0ffff, false, true, 600);
    } else if (w.type === 'dual') {
      // 4連高速乱舞
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          this.spawnSlashArc(4.2, i % 2 === 0 ? 0x7cf0a0 : 0x00ffff, 1.3);
          this.performMeleeHit(4.2, Math.round(dmg * 0.7), 0x7cf0a0, true, i === 3);
        }, i * 75);
      }
    } else if (w.type === 'mubi') {
      // 蒼焔突進斬り
      this.dodgeDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      this.dodgeUntil = now + 230;
      this.spawnSlashArc(5.5, 0x00ffff, 1.8);
      const res = this.performMeleeHit(5.5, Math.round(dmg * 1.8), 0x00ffff, false, true);
      if (res.hits > 0) this.souenGauge = Math.min(120, this.souenGauge + res.hits * 12 * (hasSynergy('awake_mubi') ? 2 : 1));
    } else if (w.type === 'apocalypse' || w.type === 'eruption_wand') {
      // 隕石落下（メテオストライク）
      this.callMeteors(3, Math.round(dmg * 1.3), w.type === 'apocalypse' ? 0xff1144 : 0xff5500);
      if (w.type === 'apocalypse') this.apoGauge = Math.min(100, this.apoGauge + 20);
    } else {
      // 回転斬り・重撃
      this.swingSwordAnimation(3);
      this.spawnSlashArc(5.5, 0xffd36a, 1.8);
      this.addCameraShake(0.18, 0.14);
      this.performMeleeHit(5.5, Math.round(dmg * 1.65), 0xffd36a, true, true, 0, 1.5);
    }
    wear(w, DURABILITY.weaponSkill);
  }

  // ==========================================
  // 3. 固有技 [Qキー]
  // ==========================================
  triggerQSkill() {
    const now = performance.now();
    const w = state.weapon;
    const dmg = atkTotal(this.hp);

    if (w.type === 'mubi') {
      if (this.souenGauge < 80) return this.onToast('蒼焔ゲージ不足 (80必要)');
      this.souenGauge -= 80;
      this.onToast('🔥 蒼焔乱舞！');
      this.addCameraShake(0.28, 0.18);
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          this.spawnSlashArc(6.8, 0x00ffff, 2.2);
          this.performMeleeHit(6.8, Math.round(dmg * 1.6), 0x00ffff, true, true);
        }, i * 90);
      }
      return;
    }
    if (w.type === 'apocalypse') {
      if (this.apoGauge < 60) return this.onToast('終末ゲージ不足 (60必要)');
      this.apoGauge -= 60;
      this.onToast('🌑 終末の審判（メテオシャワー）！');
      this.callMeteors(6, Math.round(dmg * 1.5), 0xff1144);
      return;
    }

    if (now < this.nextQTime) return;
    this.nextQTime = now + 4000;
    this.onToast('⚡ 衝撃波！');
    this.spawnSlashArc(5.2, 0x4fd1c5, 2.0);
    this.performMeleeHit(5.2, Math.round(dmg * 1.5), 0x4fd1c5, true, true);
  }

  // ==========================================
  // 4. ExS（終結スキル）[Zキー]（無尾・アポカリプス・ExS3種の固有演出）
  // ==========================================
  triggerExS() {
    const w = state.weapon;
    const dmg = atkTotal(this.hp);

    // 無尾専用奥義：「❄️ 霜雪一閃」（空間を切り裂く無数のシアン光線＋凍結スタン）
    if (w.type === 'mubi') {
      if (this.souenGauge < 120) return this.onToast('蒼焔ゲージ不足 (120必要)');
      this.souenGauge = 0;
      this.onToast('❄️ 霜雪一閃！！');
      this.addCameraShake(0.45, 0.28);
      this.onSlowMo(0.45);
      this.spawnFrostFlashLines(18);
      this.performMeleeHit(12.0, Math.round(dmg * 9.5), 0x00ffff, true, true, 3500);
      return;
    }

    // アポカリプス専用奥義：「☄️ アポカリプス・ノヴァ」（超巨大メテオ連打）
    if (w.type === 'apocalypse') {
      if (this.apoGauge < 100) return this.onToast('終末ゲージ不足 (100必要)');
      this.apoGauge = 0;
      this.onToast('☄️ 終焉奥義【アポカリプス・ノヴァ】！！');
      this.addCameraShake(0.55, 0.35);
      this.callMeteors(12, Math.round(dmg * 2.2), 0xff1144);
      return;
    }

    if (state.exsGauge < EXS_GAUGE_MAX) return;
    state.exsGauge = 0;
    const exsId = state.equippedExsId || 'giga_breaker';
    const exsDef = EXS_LIST[exsId] || EXS_LIST.giga_breaker;
    this.onToast(`💥 ${exsDef.name}！！`);

    if (exsId === 'gale_slash') {
      // 【疾風・影閃八重咲き】周囲の敵へ高速ワープしながら8連撃！
      this.executeGaleSlash8(dmg);
    } else if (exsId === 'pandemonium') {
      // 【百鬼夜行・冥界陣】範囲内の敵の足元に呪怨の魔力柱が連続発生！
      this.executePandemonium(dmg);
    } else {
      // 【ギガ・ブレイカー】黄金の超衝撃波＋スタン
      this.addCameraShake(0.4, 0.25);
      this.spawnSlashArc(9.5, 0xffd36a, 2.8);
      this.performMeleeHit(9.5, Math.round(dmg * 10.0), 0xffd36a, true, true, 3000);
    }
  }

  // ---- 無尾「霜雪一閃」の3D光線エフェクト ----
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

  // ---- アポカリプス「メテオ落下」演出＆着弾爆発 ----
  callMeteors(count, dmgPerMeteor, color) {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const baseTarget = this.root.position.clone().addScaledVector(forward, 6.0);

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        // 敵がいれば敵の頭上を狙い、いなければ前方ランダム地点を狙う
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
          color
        });
      }, i * 110);
    }
  }

  // ---- アストラル・オーブ「浮遊ビット」召喚 ----
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

  // ---- ExS「疾風・影閃八重咲き」8連ワープ斬り ----
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
        this.performMeleeHit(4.8, Math.round(dmg * 1.4), 0x7cf0a0, true, true);
      }, i * 95);
    }
  }

  // ---- ExS「百鬼夜行・冥界陣」呪怨の魔力柱連発 ----
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
            this.enemyManager.damageEnemy(e, Math.round(dmg * 1.35), { color: 0xb15cff, isCrit: true, stunMs: 1200 });
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

  // ---- 近接ヒット判定（ヒット数・撃破数・ノックバック対応） ----
  performMeleeHit(reach, dmg, color, isAllAround = false, isCrit = false, stunMs = 0, knockback = 0) {
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
        const killed = this.enemyManager.damageEnemy(enemy, dmg, { color, isCrit, stunMs });
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
            finalDmg = Math.round(p.dmg * (1 + (hasSynergy('awake_chronos') ? 1.5 : 0.6) * ratio));
            this.chronosGauge = Math.min(100, this.chronosGauge + Math.round((8 + 8 * ratio) * (hasSynergy('awake_chronos') ? 1.5 : 1)));
          }
          if (p.starPerHit) this.starGauge = Math.min(100, this.starGauge + p.starPerHit);

          this.enemyManager.damageEnemy(enemy, finalDmg, { color: p.color });
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

    // アストラル・オーブの浮遊ビット追従＆自動レーザー射撃
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
        if (this.bitFireTimer >= 0.65 && this.enemyManager.enemies.length > 0) {
          this.bitFireTimer = 0;
          const dmg = Math.round(atkTotal(this.hp) * 0.45);
          this.fireProjectile(0, dmg, 0x10b981, { homing: true, starPerHit: 4 });
        }
      }
    }

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
              this.enemyManager.damageEnemy(e, obj.dmg, { color: obj.color, isCrit: true });
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
