import * as THREE from 'three';
import {
  DURABILITY, RANGED_WEAPON_TYPES, isRestrictedLegend, EXS_LIST, EXS_GAUGE_MAX, DEATH, TRIGGER_LIST
} from './data.js';
import {
  state, EQUIPPED, maxHp, atkTotal, takeDamage, wear, wearArmor,
  hasSynergy, artifactStat, saveGame, SPELLBOOK_SLOTS, TRIGGER_SLOTS,
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

    // ワールドトリガー用状態管理
    this.trionRegenAcc = 0;
    this.trionShieldUntil = 0;
    this.trionShieldReduce = 0;
    this.radarUntil = 0;
    this.radarAtkMult = 1.0;
    this.shieldBubbleMesh = null;

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
    this.nextSbTimes = [0, 0, 0];
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
  isTriggerMode() {
    return state.weapon?.type === 'trigger_holder';
  }

  getTriggerPowerMult(id) {
    const lv = (state.ownedTriggers && state.ownedTriggers[id]) || 1;
    const radarBonus = performance.now() < this.radarUntil ? this.radarAtkMult : 1.0;
    return (1 + (lv - 1) * 0.20) * radarBonus;
  }

  consumeTrion(costVal) {
    const cost = Math.max(1, Math.round(costVal));
    if (this.hp <= cost) {
      this.onToast(`⚠️ トリオン不足（必要: ${cost} / 残り: ${Math.ceil(this.hp)}）`);
      return false;
    }
    this.hp -= cost;
    return true;
  }
  // side: 'right'（右側：アステロイド） / 'left'（左側：バイパー・ハウンド・メテオラ等）
  // ① 3×3×3（27分割）トリオンキューブ展開演出（0.05秒）後に各小キューブ座標を渡して発射
  chargeAndFireTrionCube(color, side, onFire) {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
    const sideSign = side === 'right' ? 1 : -1;

    const centerPos = this.root.position.clone()
      .add(new THREE.Vector3(0, 1.55, 0))
      .addScaledVector(forward, 0.75)
      .addScaledVector(right, 0.68 * sideSign);

    const group = new THREE.Group();
    group.position.copy(centerPos);
    group.rotation.y = this.yaw;

    // 3×3×3 の27個に分割された小キューブを生成
    const subGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
    const subMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const edgeGeo = new THREE.EdgesGeometry(subGeo);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });

    const subPositions = [];
    const gap = 0.14;
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const cell = new THREE.Mesh(subGeo, subMat);
          cell.position.set(x * gap, y * gap, z * gap);
          cell.add(new THREE.LineSegments(edgeGeo, edgeMat));
          group.add(cell);

          // 発射時に小弾が飛び出すワールド座標を記録
          const worldCellPos = centerPos.clone()
            .addScaledVector(right, x * gap)
            .add(new THREE.Vector3(0, y * gap, 0))
            .addScaledVector(forward, z * gap);
          subPositions.push(worldCellPos);
        }
      }
    }
    this.scene.add(group);

    // 0.05秒後にキューブが弾けて各小弾位置から射出
    setTimeout(() => {
      this.scene.remove(group);
      subGeo.dispose();
      subMat.dispose();
      edgeGeo.dispose();
      edgeMat.dispose();
      if (this.hp > 0) onFire(centerPos.clone(), subPositions);
    }, 500);
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
      if (e.code === 'Digit1') this.triggerSpellbookSlot(0);
      if (e.code === 'Digit2') this.triggerSpellbookSlot(1);
      if (e.code === 'Digit3') this.triggerSpellbookSlot(2);
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
      if (e.button === 2) {
        if (this.isTriggerMode()) this.triggerQSkill();
        else this.triggerDodge();
      }
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
    if (this.isTriggerMode()) {
      this.executeTriggerNormal(dmg, isThird);
      return;
    }

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
    if (this.isTriggerMode()) {
      this.executeTriggerSlot('skillE', 'nextSkillTime');
      return;
    }

    const cdCut = Math.min(0.65, (artifactStat('cdPct') + artifactStat('motif_chronos') + (hasSynergy('chronos_overdrive') ? 15 : 0)) / 100);
    this.nextSkillTime = now + Math.round(w.skill.cd * (1 - cdCut));

    this.enemyManager.onPlayerSkillUsed(this.root.position);
    this.executeWeaponSkillByType(w.type, 1.0);
    wear(w, DURABILITY.weaponSkill);
  }

  // ★追加：スペルブックの1・2・3キー発動（威力50%・CD2倍）
  triggerSpellbookSlot(slotIdx) {
    if (this.isTriggerMode()) {
      const optKeys = ['opt1', 'opt2', 'opt3'];
      this.executeTriggerSlot(optKeys[slotIdx], null, slotIdx);
      return;
    }
    const w = state.weapon;
    if (!w || w.type !== 'spellbook') return;
    const slotData = SPELLBOOK_SLOTS[slotIdx];
    if (!slotData) return this.onToast(`スロット${slotIdx + 1}に魔術が未登録です`);

    const now = performance.now();
    if (now < this.nextSbTimes[slotIdx] || now < this.dodgeUntil) return;

    const cdCut = Math.min(0.65, (artifactStat('cdPct') + artifactStat('motif_chronos') + (hasSynergy('chronos_overdrive') ? 15 : 0)) / 100);
    this.nextSbTimes[slotIdx] = now + Math.round(slotData.cd * (1 - cdCut));

    this.enemyManager.onPlayerSkillUsed(this.root.position);
    this.onToast(`📖 魔術発動【${slotData.skillName}】！`);
    this.executeWeaponSkillByType(slotData.weaponType, 0.5);
    wear(w, 1);
  }

  executeWeaponSkillByType(weaponType, powerMult = 1.0) {
    const now = performance.now();
    const dmg = Math.round(atkTotal(this.hp) * powerMult);
    this.model.rotation.y = this.yaw;

    if (weaponType === 'mubi') {
      this.dodgeDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      this.dodgeUntil = now + 260;
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          this.spawnSlashArc(4.8, 0x00ffff, 1.5);
          const res = this.performMeleeHit(4.8, Math.round(dmg * 0.55), 0x00ffff, false, i === 3, 0, 0, 'skill');
          if (res.hits > 0 && state.weapon?.type === 'mubi') {
            const add = res.hits * 3 * (hasSynergy('awake_mubi') ? 2 : 1);
            this.souenGauge = Math.min(120, this.souenGauge + add);
          }
        }, i * 55);
      }
    } else if (weaponType === 'apocalypse') {
      this.callMeteors(5, Math.round(dmg * 1.4), 0xff1144, 800, state.weapon?.type === 'apocalypse' ? 8 : 0);
    } else if (weaponType === 'astral_orb') {
      this.spawnSlashArc(6.2, 0x10b981, 2.2);
      const clearedOrbs = this.enemyManager.clearProjectilesInRadius(this.root.position, 7.5);
      if (clearedOrbs > 0) this.onToast(`✨ 敵弾 ${clearedOrbs}発 消去！`);
      const res = this.performMeleeHit(6.2, Math.round(dmg * 1.4), 0x10b981, true, true, 0, 2.0, 'skill');
      if (res.hits > 0 && state.weapon?.type === 'astral_orb') this.starGauge = Math.min(100, this.starGauge + res.hits * 15);
    } else if (weaponType === 'chronos_bow') {
      this.invulnUntil = Math.max(this.invulnUntil, now + 350);
      this.dodgeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
      this.dodgeUntil = now + 220;
      [-0.28, -0.14, 0, 0.14, 0.28].forEach((off) => {
        this.fireProjectile(off, Math.round(dmg * 0.9), 0x93c5fd, { isChronosArrow: state.weapon?.type === 'chronos_bow', attackCategory: 'skill' });
      });
    } else if (weaponType === 'inferno_scythe') {
      this.spawnSlashArc(6.0, 0xff5500, 2.0);
      this.addCameraShake(0.2, 0.15);
      this.performMeleeHit(6.0, Math.round(dmg * 2.2), 0xff5500, true, true, 0, 0, 'skill');
      const heal = Math.round(maxHp() * 0.15);
      this.hp = Math.min(maxHp(), this.hp + heal);
      if (this.enemyManager.activeBoss) this.enemyManager.addBossHellfire(25);
    } else if (weaponType === 'bow') {
      [-0.22, 0, 0.22].forEach((off) => this.fireProjectile(off, dmg, 0xffd36a, { attackCategory: 'skill' }));
    } else if (weaponType === 'spellbook') {
      this.fireProjectile(-0.15, Math.round(dmg * 1.1), 0xff4500, { homing: true, attackCategory: 'skill' });
      this.fireProjectile(0, Math.round(dmg * 1.2), 0x00ffff, { homing: true, attackCategory: 'skill' });
      this.fireProjectile(0.15, Math.round(dmg * 1.1), 0xffd36a, { homing: true, attackCategory: 'skill' });
    } else if (weaponType === 'spear' || weaponType === 'dragon_chain') {
      this.dodgeDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      this.dodgeUntil = now + 240;
      this.spawnSlashArc(6.0, 0xe0ffff, 1.5);
      this.performMeleeHit(6.0, Math.round(dmg * 1.75), 0xe0ffff, false, true, 600, 0, 'skill');
    } else if (weaponType === 'dual') {
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          this.spawnSlashArc(4.2, i % 2 === 0 ? 0x7cf0a0 : 0x00ffff, 1.3);
          this.performMeleeHit(4.2, Math.round(dmg * 0.7), 0x7cf0a0, true, i === 3, 0, 0, 'skill');
        }, i * 75);
      }
    } else if (weaponType === 'eruption_wand') {
      this.callMeteors(3, Math.round(dmg * 1.3), 0xff5500, 500, 0);
    } else if (weaponType === 'lightning_staff') {
      [-0.3, -0.1, 0.1, 0.3].forEach((off) => this.fireProjectile(off, Math.round(dmg * 0.85), 0xffff00, { attackCategory: 'skill' }));
    } else {
      this.swingSwordAnimation(3);
      this.spawnSlashArc(5.5, 0xffd36a, 1.8);
      this.addCameraShake(0.18, 0.14);
      this.performMeleeHit(5.5, Math.round(dmg * 1.65), 0xffd36a, true, true, 0, 1.5, 'skill');
    }
  }

  // ==========================================
  // 3. Qスキル（Legend武器固有Qスキル完全再現）
  // ==========================================
  triggerQSkill() {
    const now = performance.now();
    const w = state.weapon;
    const dmg = atkTotal(this.hp);
    if (this.isTriggerMode()) {
      this.executeTriggerSlot('skillQ', 'nextQTime');
      return;
    }

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
    if (this.isTriggerMode()) {
      this.executeTriggerExS(dmg);
      return;
    }

    if (w.type === 'mubi') {
      // 【蒼焔・絶対凍結陣】蒼焔120消費。周囲に300%×8連撃＋3秒凍結（解除時30%破砕追撃）
      if (this.souenGauge < 120) return this.onToast('蒼焔ゲージ不足 (120必要)');
      this.souenGauge = 0;
      this.onToast('❄️ 蒼焔・絶対凍結陣！！');
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
      this.onToast('☄️ アポカリプス・ノヴァ！！');
      this.addCameraShake(0.6, 0.38);
      this.spawnSlashArc(17.0, 0xff1144, 3.5);
      this.callMeteors(8, Math.round(dmg * 1.5), 0xff1144, 1000, 0);

      // ボスの無敵バリアを即座に破壊！
      if (this.enemyManager.activeBoss && this.enemyManager.activeBoss.hasBarrier) {
        this.enemyManager.breakBossBarrier('☄️ アポカリプス・ノヴァがボスの無敵バリアを粉砕！');
      }

      this.performMeleeHit(17.0, Math.round(dmg * 35.0), 0xff1144, true, true, 4000, 0, 'skill');
      const heal = Math.round(maxHp() * 0.30);
      this.hp = Math.min(maxHp(), this.hp + heal);
      return;
    }

    if (w.type === 'astral_orb') {
      // 【アストラル・カノン】星力100消費。直線850px・幅96pxの極太ビームで2800%ダメージ＋2.5秒スタン
      if (this.starGauge < 100) return this.onToast('星力ゲージ不足 (100必要)');
      this.starGauge = 0;
      this.onToast('🌟 アストラル・カノン！！');
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
      this.onToast('🔥 メギドフレイム！！');
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
  // ---- トリガーホルダー：通常攻撃（弧月 / アステロイド / レイガスト） ----
  executeTriggerNormal(baseDmg, isThird) {
    const id = TRIGGER_SLOTS.normal || 'kogetsu';
    const tr = TRIGGER_LIST[id];
    if (!tr || !this.consumeTrion(tr.cost)) return;

    const lv = (state.ownedTriggers && state.ownedTriggers[id]) || 1;
    const dmg = Math.round(baseDmg * this.getTriggerPowerMult(id));
    this.nextAtkTime = performance.now() + tr.cd;
    this.model.rotation.y = this.yaw;

    // アステロイド：分割された小キューブの各位置から小弾が束になって一直線に飛ぶ
    if (id === 'asteroid') {
      const shots = 3 + Math.min(2, Math.floor((lv - 1) / 3));
      this.chargeAndFireTrionCube(0x00ffff, 'right', (cubePos, subPositions) => {
        for (let idx = 0; idx < shots; idx++) {
          setTimeout(() => {
            this.model.rotation.y = this.yaw;
            const origin = subPositions[idx % subPositions.length] || cubePos;
            this.fireProjectile(0, Math.round(dmg * 0.48), 0x00ffff, {
              originPos: origin,
              projRadius: 0.14,
              speedOverride: 1.35,
              maxDist: 34,
              attackCategory: 'ranged'
            });
          }, idx * 35);
        }
      });
    } else if (id === 'raygust') {
      // レイガスト（ブレード）：広範囲薙ぎ払い＋正面の敵弾消去
      this.swingSwordAnimation(this.comboStep);
      this.spawnSlashArc(5.0, 0x38bdf8, 1.5);
      this.enemyManager.clearProjectilesInRadius(this.root.position, 4.5);
      this.performMeleeHit(5.0, Math.round(dmg * 1.15), 0x38bdf8, false, isThird, 0, 1.2, 'melee');
    } else {
      // 弧月：素早い3段斬撃
      this.swingSwordAnimation(this.comboStep);
      const reach = isThird ? 4.8 : 4.0;
      this.spawnSlashArc(reach, 0x48bb78, isThird ? 1.4 : 1.0);
      this.performMeleeHit(reach, Math.round(dmg * (isThird ? 1.3 : 1.0)), 0x48bb78, false, isThird, 0, 0, 'melee');
    }
  }

  // ---- トリガーホルダー：スキル枠（E / Q / 1 / 2 / 3）発動 ----
  executeTriggerSlot(slotKey, timerProp, sbIdx = -1, freeCast = false) {
    const id = TRIGGER_SLOTS[slotKey];
    if (!id) {
      if (!freeCast) this.onToast('スロットにトリガーが未セットです');
      return;
    }
    const tr = TRIGGER_LIST[id];
    if (!tr) return;

    const now = performance.now();
    if (!freeCast) {
      const nextTime = sbIdx >= 0 ? this.nextSbTimes[sbIdx] : this[timerProp];
      if (now < nextTime) return;
      if (!this.consumeTrion(tr.cost)) return;

      const cdCut = Math.min(0.65, (artifactStat('cdPct') + artifactStat('motif_chronos') + (hasSynergy('chronos_overdrive') ? 15 : 0)) / 100);
      const lv = (state.ownedTriggers && state.ownedTriggers[id]) || 1;
      const lvCdMult = Math.max(0.65, 1 - (lv - 1) * 0.04);
      const cdVal = Math.round(tr.cd * (1 - cdCut) * lvCdMult);

      if (sbIdx >= 0) this.nextSbTimes[sbIdx] = now + cdVal;
      else this[timerProp] = now + cdVal;
    }

    this.enemyManager.onPlayerSkillUsed(this.root.position);
    this.runTriggerEffect(id);
  }

  // ---- 各トリガースキルの具体的3D挙動 ----
  runTriggerEffect(id) {
    const now = performance.now();
    const lv = (state.ownedTriggers && state.ownedTriggers[id]) || 1;
    const mult = this.getTriggerPowerMult(id);
    const dmg = Math.round(atkTotal(this.hp) * mult);
    this.model.rotation.y = this.yaw;

    // バイパー・ハウンド・メテオラも同様に subPositions から射出
    if (id === 'viper') {
      const count = Math.min(9, 4 + Math.floor(lv / 2));
      this.chargeAndFireTrionCube(0x00ffff, 'left', (cubePos, subPositions) => {
        for (let i = 0; i < count; i++) {
          const spread = (i - (count - 1) / 2) * 0.14;
          const origin = subPositions[(i * 3) % subPositions.length] || cubePos;
          this.fireProjectile(spread, Math.round(dmg * 0.58), 0x00ffff, {
            originPos: origin,
            projRadius: 0.15,
            isViperArc: true,
            arcUpTime: 0.20 + (i % 3) * 0.04,
            homing: true,
            homingStrength: 0.30,
            maxDist: 36,
            attackCategory: 'skill'
          });
        }
      });
    } else if (id === 'hound') {
      const count = Math.min(10, 5 + Math.floor(lv / 2));
      this.chargeAndFireTrionCube(0x63b3ed, 'left', (cubePos, subPositions) => {
        for (let i = 0; i < count; i++) {
          const off = (i - (count - 1) / 2) * 0.13;
          const origin = subPositions[(i * 3) % subPositions.length] || cubePos;
          this.fireProjectile(off, Math.round(dmg * 0.52), 0x63b3ed, {
            originPos: origin,
            projRadius: 0.15,
            homing: true,
            homingStrength: 0.28,
            maxDist: 36,
            attackCategory: 'skill'
          });
        }
      });
    } else if (id === 'meteora') {
      this.chargeAndFireTrionCube(0xff4500, 'left', (cubePos) => {
        this.fireProjectile(0, Math.round(dmg * 1.45), 0xff4500, {
          originPos: cubePos,
          projRadius: 0.24,
          isMeteora: true,
          blastRadius: 4.5 + Math.min(3.0, (lv - 1) * 0.3),
          maxDist: 30,
          attackCategory: 'skill'
        });
      });
    } else if (id === 'senku') {
      // 旋空弧月：超長距離貫通斬撃波＋近接薙ぎ払い
      this.swingSwordAnimation(3);
      this.spawnSlashArc(7.5, 0x48bb78, 2.2);
      this.addCameraShake(0.18, 0.14);
      this.performMeleeHit(7.5, Math.round(dmg * 1.6), 0x48bb78, false, true, 0, 1.5, 'skill');
      this.fireProjectile(0, Math.round(dmg * 1.35), 0x48bb78, {
        pierce: true, maxDist: 22, attackCategory: 'skill'
      });
    } else if (id === 'grasshopper') {
      // グラスホッパー：緑の反発パッド生成＋入力方向（無入力時は上空）へ高速跳躍
      const pad = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 1.6, 24),
        new THREE.MeshBasicMaterial({ color: 0x48bb78, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(this.root.position.x, this.root.position.y + 0.1, this.root.position.z);
      this.scene.add(pad);
      this.slashEffects.push({ mesh: pad, life: 0.45, maxLife: 0.45 });

      const moveDir = this.getInputMoveDirection();
      this.invulnUntil = Math.max(this.invulnUntil, now + 350);
      if (moveDir.lengthSq() > 0) {
        this.dodgeDir.copy(moveDir).normalize();
        this.dodgeUntil = now + 260;
        this.velocityY = Math.max(this.velocityY, 0.22);
      } else {
        this.velocityY = 0.44 + Math.min(0.15, lv * 0.02);
        this.onGround = false;
      }
    } else if (id === 'escudo') {
      // エスクード：前方に破壊可能な盾壁を3枚せり上げる
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
      const baseCenter = this.root.position.clone().addScaledVector(forward, 3.2);
      const wallHp = Math.round(maxHp() * (0.45 + lv * 0.15));

      [-1.7, 0, 1.7].forEach((offset) => {
        const pos = baseCenter.clone().addScaledVector(right, offset);
        if (!this.world.isBlockedForEntity(pos.x, pos.z, 0.6)) {
          this.world.addDestructibleBlock(pos.x, 0.8, pos.z, 0x00ffff, wallHp);
          this.world.addDestructibleBlock(pos.x, 2.4, pos.z, 0x00ffff, wallHp);
        }
      });
      this.onToast('🛡️ エスクード展開！');
    } else if (id === 'shield') {
      // シールド：3秒間トリオン障壁展開（LvUPで軽減率UP：55%〜最大85%）
      this.trionShieldUntil = now + 3000 + Math.min(2000, (lv - 1) * 250);
      this.trionShieldReduce = Math.min(0.85, 0.55 + (lv - 1) * 0.05);
      if (!this.shieldBubbleMesh) {
        this.shieldBubbleMesh = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.35, 1),
          new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.45 })
        );
        this.shieldBubbleMesh.position.y = 1.1;
        this.root.add(this.shieldBubbleMesh);
      }
      this.shieldBubbleMesh.visible = true;
      this.onToast(`🔷 シールド展開（被ダメ${Math.round(this.trionShieldReduce * 100)}%軽減）`);
    } else if (id === 'teleporter') {
      // テレポーター：障害物をすり抜けて瞬間移動
      const moveDir = this.getInputMoveDirection();
      const dir = moveDir.lengthSq() > 0
        ? moveDir
        : new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      const dist = 7.5 + Math.min(5.0, (lv - 1) * 0.8);

      for (let i = 0; i < 3; i++) this.spawnAfterimage();
      this.invulnUntil = Math.max(this.invulnUntil, now + 350);

      for (let step = dist; step >= 1.0; step -= 0.5) {
        const tx = this.root.position.x + dir.x * step;
        const tz = this.root.position.z + dir.z * step;
        if (!this.isCollidingHorizontal(tx, tz, this.root.position.y)) {
          this.root.position.set(tx, this.root.position.y, tz);
          break;
        }
      }
      this.spawnSlashArc(2.5, 0x00ffff, 1.2);
    } else if (id === 'radar') {
      // レーダー：8秒間マップ全探知＆攻撃力バフ
      this.radarUntil = now + 8000 + (lv - 1) * 1000;
      this.radarAtkMult = 1.15 + Math.min(0.35, (lv - 1) * 0.04);
      this.onToast(`📡 レーダー起動（全探知＋攻撃力+${Math.round((this.radarAtkMult - 1) * 100)}%）`);
    }
  }

  // ---- トリガーホルダー：Zキー（EXS：アイビス / フルアタック） ----
  executeTriggerExS(baseDmg) {
    if (state.exsGauge < EXS_GAUGE_MAX) return;
    const id = TRIGGER_SLOTS.exs || 'ibis';
    const tr = TRIGGER_LIST[id];
    if (!tr || !this.consumeTrion(tr.cost)) return;

    state.exsGauge = 0;
    const mult = this.getTriggerPowerMult(id);
    const dmg = Math.round(baseDmg * mult);
    this.model.rotation.y = this.yaw;

    if (id === 'full_attack') {
      // フルアタック：E / Q / 1 / 2 / 3 にセット中の全スキルトリガーを同時一斉発動！
      this.onToast('💥 フルアタック（全トリガー一斉起動）！！');
      this.addCameraShake(0.45, 0.28);
      const allKeys = ['skillE', 'skillQ', 'opt1', 'opt2', 'opt3'];
      let launched = 0;
      allKeys.forEach((k) => {
        if (TRIGGER_SLOTS[k]) {
          this.executeTriggerSlot(k, null, -1, true);
          launched++;
        }
      });
      if (launched === 0) {
        // 1つもセットされていない場合のフォールバック一斉射撃
        this.runTriggerEffect('hound');
        this.runTriggerEffect('meteora');
      }
    } else {
      // アイビス：超威力・壁＆敵貫通の狙撃砲撃＋着弾大爆発
      this.onToast('🎯 アイビス狙撃砲撃！！');
      this.fireAstralCannon(Math.round(dmg * 26.0));
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      const blastCenter = this.root.position.clone().addScaledVector(forward, 14);
      for (const e of [...this.enemyManager.enemies]) {
        if (e.root.position.distanceTo(blastCenter) <= 7.5) {
          this.enemyManager.damageEnemy(e, Math.round(dmg * 8.0), {
            color: 0x00ffff, isCrit: true, stunMs: 2500, attackCategory: 'skill'
          });
        }
      }
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
    const length = 50;

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, length, 16),
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
      if (perp <= 3.0 + 0.8 * e.scale) {
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
      const bitGroup = new THREE.Group();

      // 中央の結晶コア（エメラルド発光）
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.24, 0),
        new THREE.MeshBasicMaterial({ color: 0x34d399 })
      );
      bitGroup.add(core);

      // 外周の魔法陣リング（シアン発光）
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.03, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.85 })
      );
      ring.rotation.x = Math.PI / 2;
      bitGroup.add(ring);

      // 内側の斜めリング（ホワイトシアン）
      const innerRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.32, 0.02, 8, 20),
        new THREE.MeshBasicMaterial({ color: 0xa7f3d0, transparent: true, opacity: 0.7 })
      );
      innerRing.rotation.y = Math.PI / 3;
      bitGroup.add(innerRing);

      this.scene.add(bitGroup);
      this.astralBits.push({
        mesh: bitGroup,
        core,
        ring,
        innerRing,
        angleOffset: (Math.PI * 2 * i) / count
      });
    }
  }

  clearAstralBits() {
    for (const b of this.astralBits) {
      this.scene.remove(b.mesh);
      b.mesh.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
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

    const radius = opts.projRadius || 0.22;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 8, 8),
      new THREE.MeshBasicMaterial({ color })
    );
    if (opts.originPos) {
      mesh.position.copy(opts.originPos);
    } else {
      mesh.position.copy(this.root.position).add(new THREE.Vector3(0, 1.3, 0)).addScaledVector(dir, 0.8);
    }
    this.scene.add(mesh);

    const spd = opts.speedOverride || w.projSpeed || 0.85;
    const initVel = dir.multiplyScalar(spd);
    if (opts.isViperArc) {
      initVel.y += 0.45;
    }

    const defaultRange = this.isTriggerMode() ? 32 : (w.range || 28);
    this.projectiles.push({
      mesh,
      vel: initVel,
      startPos: mesh.position.clone(),
      maxDist: opts.maxDist || defaultRange,
      dmg,
      color,
      hitSet: new Set(),
      attackCategory: opts.attackCategory || 'ranged',
      ...opts
    });

    //const spd = opts.speedOverride || w.projSpeed || 0.85;
    //const initVel = dir.multiplyScalar(spd);
    if (opts.isViperArc) {
      initVel.y += 0.45; // 斜め上方向へ打ち上げ
    }

    this.projectiles.push({
      mesh,
      vel: initVel,
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
      if (p.isViperArc && p.arcUpTime > 0) {
        // 打ち上げフェーズ：上空へ弧を描いて上昇
        p.arcUpTime -= 0.016;
        p.vel.y -= 0.015;
      } else if (p.homing && this.enemyManager.enemies.length > 0) {
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
        p.vel.lerp(toTarget.multiplyScalar(spd), p.homingStrength || 0.14).normalize().multiplyScalar(spd);
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
        if (p.isMeteora) {
          const r = p.blastRadius || 4.5;
          this.addCameraShake(0.25, 0.18);
          for (const e of [...this.enemyManager.enemies]) {
            if (e.root.position.distanceTo(p.mesh.position) <= r) {
              this.enemyManager.damageEnemy(e, Math.round(p.dmg * 0.85), {
                color: 0xff4500, isCrit: true, stunMs: 800, attackCategory: 'skill'
              });
            }
          }
          for (const box of [...this.world.destructibles]) {
            if (box.position.distanceTo(p.mesh.position) <= r) {
              this.world.damageBlock(box, p.dmg);
            }
          }
        }
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
    // トリガーホルダー装備時：毎秒最大HPの0.5%自然回復（トリオン供給）
    if (this.isTriggerMode() && this.hp < mHp) {
      this.trionRegenAcc += dt;
      if (this.trionRegenAcc >= 1.0) {
        this.trionRegenAcc -= 1.0;
        const trionHeal = Math.max(1, Math.round(mHp * 0.005));
        this.hp = Math.min(mHp, this.hp + trionHeal);
      }
    }

    // シールドトリガー視覚効果の更新
    if (this.shieldBubbleMesh) {
      if (now < this.trionShieldUntil) {
        this.shieldBubbleMesh.visible = true;
        this.shieldBubbleMesh.rotation.y += dt * 2.5;
      } else {
        this.shieldBubbleMesh.visible = false;
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
            this.root.position.x + Math.cos(ang) * 1.55,
            this.root.position.y + 1.55 + Math.sin(t * 2.5 + b.angleOffset) * 0.16,
            this.root.position.z + Math.sin(ang) * 1.55
          );
          // コアと2重リングをそれぞれ異なる軸で回転
          b.core.rotation.y += dt * 4.5;
          b.ring.rotation.z -= dt * 3.0;
          b.innerRing.rotation.x += dt * 3.8;
          b.innerRing.rotation.y += dt * 2.5;
        });

        this.bitFireTimer += dt;
        if (this.bitFireTimer >= 0.8 && this.enemyManager.enemies.length > 0) {
          this.bitFireTimer = 0;

          // 射程22m以内の最も近い敵をターゲットにする
          let nearest = null;
          let minD = 22.0;
          for (const e of this.enemyManager.enemies) {
            const d = e.root.position.distanceTo(this.root.position);
            if (d < minD) { minD = d; nearest = e; }
          }

          if (nearest) {
            const dmg = Math.round(atkTotal(this.hp) * 0.45);
            const targetPos = nearest.root.position.clone().add(new THREE.Vector3(0, 1.0 * nearest.scale, 0));

            // 展開中の各ビットからターゲットへ細い瞬間レーザーを描画
            this.astralBits.forEach((b) => {
              const startPos = b.mesh.position.clone();
              const diff = targetPos.clone().sub(startPos);
              const dist = diff.length();
              if (dist > 0.05) {
                const mid = startPos.clone().addScaledVector(diff, 0.5);
                const beamGeo = new THREE.CylinderGeometry(0.05, 0.05, dist, 8);
                const beamMat = new THREE.MeshBasicMaterial({
                  color: 0x00ffff,
                  transparent: true,
                  opacity: 0.95
                });
                const beam = new THREE.Mesh(beamGeo, beamMat);
                beam.position.copy(mid);
                beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), diff.normalize());
                this.scene.add(beam);
                this.slashEffects.push({ mesh: beam, life: 0.16, maxLife: 0.16 });
              }
            });

            // ダメージ＆星力消費・ExSゲージ加算
            if (!hasSynergy('awake_astral')) {
              this.starGauge = Math.max(0, this.starGauge - 5);
            }
            if (this.timeStopHits.has(nearest)) {
              this.timeStopHits.set(nearest, this.timeStopHits.get(nearest) + 1);
            }
            this.enemyManager.damageEnemy(nearest, dmg, {
              color: 0x10b981,
              attackCategory: 'skill',
              playerPos: this.root.position,
              playerRef: this
            });
            state.exsGauge = Math.min(EXS_GAUGE_MAX, state.exsGauge + 6);
            this.world.spawnHitSpark(targetPos, 0x00ffff);
          }
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
