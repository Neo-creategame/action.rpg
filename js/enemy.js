import * as THREE from 'three';
import { EXP_PER_KILL, expNeed, goldFor, DROP_RATE, EXS_GAUGE_MAX } from './data.js';
import {
  state, SAVE, PLAYER, bossDmgMult, wear,
  rollWeapon, rollArmor, randomSlot, rollArtifact, addToPack, saveGame,hasSynergy, artifactStat, maxHp
} from './save.js';

function getBossDefinition(floor) {
  if (floor === 25) {
    return {
      type: 'golem_guard',
      name: '25.5F【射撃耐性】ゴーレム・ガーディアン',
      color: 0x718096, scale: 2.5, hpMult: 1.5, atkMult: 1.4, dropWep: 'demon_sword'
    };
  }
  if (floor === 35) {
    return {
      type: 'ninja',
      name: '35.5F【反撃の刃】影の暗殺者 ニンジャ',
      color: 0x2d3748, scale: 2.0, hpMult: 1.4, atkMult: 1.65, dropWep: 'dragon_chain'
    };
  }
  if (floor === 45) {
    return {
      type: 'elementalist',
      name: '45.5F【魔力反応】魔導王 エレメンタリスト',
      color: 0x805ad5, scale: 2.3, hpMult: 1.6, atkMult: 1.6, dropWep: 'eruption_wand'
    };
  }
  if (floor === 55) {
    return {
      type: 'anti_range',
      name: '55.5F【結界の守護者】アンチ・レンジゴーレム',
      color: 0x3182ce, scale: 2.5, hpMult: 1.75, atkMult: 1.7, dropWep: 'lightning_staff'
    };
  }
  if (floor === 60) {
    return {
      type: 'red_dragon',
      name: '60.5F【暴君】真紅の皇帝 レッドドラゴン',
      color: 0xe53e3e, scale: 2.9, hpMult: 2.2, atkMult: 2.0, dropWep: 'dragon_chain'
    };
  }
  if (floor === 15) {
    return {
      type: 'thunder_dragon',
      name: '15.5F【雷帝】天空の雷帝竜',
      color: 0xffd36a, scale: 2.6, hpMult: 2.5, atkMult: 1.8, dropWep: 'dragon_chain'
    };
  }
  if (floor === 10) {
    return {
      type: 'ifrit',
      name: '10.5F【炎巨神】滅びの炎巨神',
      color: 0xff4500, scale: 2.3, hpMult: 1.4, atkMult: 1.3, dropWep: 'eruption_wand'
    };
  }
  if (floor === 5) {
    return {
      type: 'demon',
      name: '5.5F【魔王】深淵の魔王',
      color: 0xb15cff, scale: 2.0, hpMult: 1.15, atkMult: 1.1, dropWep: 'demon_sword'
    };
  }

  const isMajor = (floor >= 15 && floor % 10 === 0);
  const title = floor >= 300 ? `${floor}.5F【適応の装甲】深淵神` : isMajor ? `${floor}.5F【大ボス】覇王` : `${floor}.5F 階層守護者`;
  const drops = ['demon_sword', 'eruption_wand', 'dragon_chain', 'lightning_staff'];
  return {
    type: isMajor ? 'major_boss' : 'standard_boss',
    name: title,
    color: isMajor ? 0xff1144 : 0xd53f8c,
    scale: isMajor ? 2.7 : 2.1,
    hpMult: (isMajor ? 2.5 : 1.0) + floor * 0.02,
    atkMult: (isMajor ? 1.8 : 1.0) + floor * 0.015,
    dropWep: drops[Math.floor(Math.random() * drops.length)]
  };
}
const RARE_MONSTERS = [
  { name: '⚠️【暴虐の巨人】タイタン',     color: 0xff8c00, scale: 1.65, hpMult: 3.2, atkMult: 1.6, speed: 0.065, range: 3.0, ranged: false, buffType: 'hp' },
  { name: '⚠️【疾風の暗殺者】シャドウ',   color: 0x00ffff, scale: 1.15, hpMult: 2.2, atkMult: 1.8, speed: 0.145, range: 2.4, ranged: false, buffType: 'atk' },
  { name: '⚠️【深淵の魔導士】ウォーロック', color: 0xb15cff, scale: 1.30, hpMult: 2.5, atkMult: 1.7, speed: 0.080, range: 3.2, ranged: true,  buffType: 'atk' },
  { name: '⚠️【黄金の守護者】ガーディアン', color: 0xffd36a, scale: 1.50, hpMult: 3.5, atkMult: 1.4, speed: 0.070, range: 2.8, ranged: false, buffType: 'hp' }
];

export class EnemyManager {
  constructor(scene, camera, world, onToast, onDamagePopup) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.onToast = onToast || (() => {});
    this.onDamagePopup = onDamagePopup || (() => {});

    this.enemies = [];
    this.enemyProjectiles = [];
    this.hazardZones = [];
    this.activeBoss = null;
    this.bossRoomCorners = [
      { x: -18, z: -18 }, { x: 18, z: -18 },
      { x: -18, z: 18 },  { x: 18, z: 18 }
    ];
  }

  clearAll() {
    for (const e of this.enemies) this.scene.remove(e.root);
    this.enemies = [];
    this.activeBoss = null;
    this.clearAllProjectilesAndHazards();
  }

  // ボス撃破時に残存する弾幕・予兆ゾーンを全消去
  clearAllProjectilesAndHazards() {
    for (const p of this.enemyProjectiles) this.scene.remove(p.mesh);
    this.enemyProjectiles = [];

    for (const h of this.hazardZones) this.scene.remove(h.mesh);
    this.hazardZones = [];
  }

  spawnForFloor(floor, spawnPoints, bossPoint, isBossFloor = false, bossRoomCorners = null) {
    this.clearAll();
    if (bossRoomCorners) this.bossRoomCorners = bossRoomCorners;

    const mobTypes = [
      { name: 'コボルト兵',       color: 0xe53e3e, scale: 1.0,  hp: 140, atk: 12, speed: 0.085, range: 2.2 },
      { name: 'シャドウウルフ',   color: 0x805ad5, scale: 0.9,  hp: 110, atk: 15, speed: 0.130, range: 2.0 },
      { name: 'ゴーレム衛兵',     color: 0xdd6b20, scale: 1.35, hp: 250, atk: 20, speed: 0.055, range: 2.6 }
    ];
    if (floor >= 6) mobTypes.push({ name: 'ダークナイト', color: 0x4a5568, scale: 1.15, hp: 220, atk: 24, speed: 0.095, range: 2.5 });
    if (floor >= 11) mobTypes.push({ name: 'カオスワイバーン', color: 0xd53f8c, scale: 1.25, hp: 280, atk: 28, speed: 0.115, range: 3.0, ranged: true });

    const scaleMult = 1 + (floor - 1) * 0.22;

    if (!isBossFloor) {
      let rareSpawned = false;
      spawnPoints.forEach((pt) => {
        // 1フロアにつき最大1体、8%の確率で異名持ちレアモンスターが乱入
        const isRare = !rareSpawned && Math.random() < 0.08;
        if (isRare) {
          rareSpawned = true;
          const rDef = RARE_MONSTERS[Math.floor(Math.random() * RARE_MONSTERS.length)];
          const hp = Math.round(220 * scaleMult * rDef.hpMult);
          const atk = Math.round(18 * (1 + (floor - 1) * 0.16) * rDef.atkMult);
          this.onToast(`⚠️ 警告！異名持ち ${rDef.name} が乱入！`);

          this.createEnemy({
            name: rDef.name,
            x: pt.x,
            z: pt.z,
            color: rDef.color,
            scale: rDef.scale,
            hp,
            maxHp: hp,
            atk,
            speed: rDef.speed,
            atkRange: rDef.range,
            isBoss: false,
            isRare: true,
            rareBuffType: rDef.buffType,
            ranged: rDef.ranged,
            floor
          });
          return;
        }

        const base = mobTypes[Math.floor(Math.random() * mobTypes.length)];
        const hp = Math.round(base.hp * scaleMult);
        const atk = Math.round(base.atk * (1 + (floor - 1) * 0.16));

        this.createEnemy({
          name: base.name,
          x: pt.x,
          z: pt.z,
          color: base.color,
          scale: base.scale,
          hp,
          maxHp: hp,
          atk,
          speed: base.speed,
          atkRange: base.range,
          isBoss: false,
          isRare: false,
          ranged: !!base.ranged,
          floor
        });
      });
      return;
    }

    // ボス階（X.5F）生成
    if (bossPoint) {
      const def = getBossDefinition(floor);
      const is50xBoss = (floor === 15 || (floor >= 20 && floor % 10 === 0));
      const baseBossHp = is50xBoss ? 3800 : 1250;
      const bossHp = Math.round(baseBossHp * scaleMult * def.hpMult);
      const bossAtk = Math.round((is50xBoss ? 34 : 20) * (1 + (floor - 1) * 0.14) * def.atkMult);

      const weakTypes = ['melee', 'ranged', 'skill'];

      const boss = this.createEnemy({
        name: def.name,
        bossType: def.type,
        x: bossPoint.x,
        z: bossPoint.z,
        color: def.color,
        scale: def.scale,
        hp: bossHp,
        maxHp: bossHp,
        atk: bossAtk,
        speed: 0.088,
        atkRange: 4.0,
        isBoss: true,
        isRare: false,
        dropWep: def.dropWep,
        floor,
        enraged: false,
        lastPattern: null,
        pendingPattern: null,
        hellfireGauge: 0,
        hellfireTick: 0,
        stealthUntil: def.type === 'ninja' ? performance.now() + 4500 : 0,
        hasBarrierMechanics: is50xBoss,
        barrierThresholds: is50xBoss ? [0.75, 0.50, 0.25] : [],
        hasBarrier: false,
        hasAdaptiveArmor: floor >= 300,
        weakness: weakTypes[Math.floor(Math.random() * weakTypes.length)],
        breakGauge: 0
      });

      this.activeBoss = boss;
      if (boss.hasAdaptiveArmor) {
        const wLabel = { melee: '近接', ranged: '遠距離', skill: 'スキル/大技' }[boss.weakness];
        this.onToast(`🛡️ 適応の装甲：現在の弱点は【${wLabel}】！`);
      }
    }
  }

  createEnemy(cfg) {
    const root = new THREE.Group();
    root.position.set(cfg.x, 0, cfg.z);
    this.scene.add(root);

    const s = cfg.scale;
    const mat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      emissive: cfg.color,
      emissiveIntensity: cfg.isBoss ? 0.25 : 0.1,
      roughness: 0.45,
      transparent: true,
      opacity: 1.0
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 1.3 * s, 0.9 * s), mat);
    body.position.y = 0.75 * s;
    body.castShadow = true;
    root.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.65 * s, 0.65 * s, 0.65 * s), mat);
    head.position.y = 1.65 * s;
    head.castShadow = true;
    root.add(head);

    const eye = new THREE.Mesh(
      new THREE.BoxGeometry(0.45 * s, 0.12 * s, 0.1 * s),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    eye.position.set(0, 1.68 * s, 0.34 * s);
    root.add(eye);

    let barrierMesh = null;
    if (cfg.isBoss) {
      const hornGeo = new THREE.ConeGeometry(0.22 * s, 0.9 * s, 6);
      const hornL = new THREE.Mesh(hornGeo, mat);
      hornL.position.set(-0.35 * s, 2.2 * s, 0);
      hornL.rotation.z = 0.3;
      const hornR = new THREE.Mesh(hornGeo, mat);
      hornR.position.set(0.35 * s, 2.2 * s, 0);
      hornR.rotation.z = -0.3;
      root.add(hornL, hornR);

      barrierMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.7 * s, 18, 18),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.65 })
      );
      barrierMesh.position.y = 1.2 * s;
      barrierMesh.visible = false;
      root.add(barrierMesh);
    }

    const warnGeo = new THREE.RingGeometry(0.2, cfg.atkRange, 28);
    const warnMat = new THREE.MeshBasicMaterial({
      color: 0xff2244,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0
    });
    const warnRing = new THREE.Mesh(warnGeo, warnMat);
    warnRing.rotation.x = -Math.PI / 2;
    warnRing.position.y = 0.06;
    root.add(warnRing);
    const stunBox = new THREE.Mesh(
      new THREE.BoxGeometry(1.35 * s, 2.1 * s, 1.35 * s),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.32, wireframe: false })
    );
    stunBox.position.y = 1.05 * s;
    stunBox.visible = false;
    root.add(stunBox);

    const hpBg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4 * s, 0.16),
      new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide })
    );
    hpBg.position.y = 2.4 * s;
    root.add(hpBg);

    const hpFill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.34 * s, 0.11),
      new THREE.MeshBasicMaterial({ color: cfg.isBoss ? 0xff1144 : cfg.isRare ? 0xffd36a : 0xe53e3e, side: THREE.DoubleSide })
    );
    hpFill.position.set(0, 2.4 * s, 0.01);
    root.add(hpFill);

    const enemy = {
      ...cfg,
      root,
      body,
      mat,
      barrierMesh,
      warnRing,
      warnMat,
      stunBox,
      hpBg,
      hpFill,
      hpBarWidth: 1.34 * s,
      state: 'idle',
      stateTimer: 0,
      patternTimer: 2.2,
      dashVel: new THREE.Vector3(),
      stunUntil: 0,
      slowUntil: 0,
      hitFlashUntil: 0,
      bleedCount: 0
    };

    this.enemies.push(enemy);
    return enemy;
  }

  addBossHellfire(amount) {
    if (!this.activeBoss) return;
    this.activeBoss.hellfireGauge = Math.min(100, (this.activeBoss.hellfireGauge || 0) + amount);
  }

  onPlayerSkillUsed(playerPos) {
    const boss = this.activeBoss;
    if (!boss || boss.bossType !== 'elementalist' || boss.hp <= 0) return;
    this.onToast('🔮 エレメンタリストが魔力反応で自動反撃！');
    const dir = playerPos.clone().sub(boss.root.position).setY(0).normalize();
    this.fireEnemyOrb(boss, dir, 0.25, true);
  }

  clearProjectilesInRadius(centerPos, radius) {
    let removed = 0;
    this.enemyProjectiles = this.enemyProjectiles.filter((p) => {
      if (p.mesh.position.distanceTo(centerPos) <= radius) {
        this.scene.remove(p.mesh);
        removed++;
        return false;
      }
      return true;
    });
    return removed;
  }

  activateBossBarrier(boss) {
    boss.hasBarrier = true;
    if (boss.barrierMesh) boss.barrierMesh.visible = true;
    this.onToast('🛡️ ボスが無敵バリアを展開！四隅の「魔力結晶」を4体破壊せよ！');

    for (const oldBox of [...this.world.destructibles]) {
      this.world.destroyBlock(oldBox);
    }
    for (const c of this.bossRoomCorners) {
      this.world.addDestructibleBlock(c.x, 1.0, c.z, 0x00ffff, Math.max(40, Math.round(boss.maxHp * 0.04)));
    }
  }

  breakBossBarrier(msg = '💥 魔力結晶全破壊！バリア解除＋2.5秒スタン！') {
    const boss = this.activeBoss;
    if (!boss) return;
    boss.hasBarrier = false;
    if (boss.barrierMesh) boss.barrierMesh.visible = false;
    boss.stunUntil = performance.now() + 2500;
    this.onToast(msg);
  }

  damageEnemy(enemy, rawDmg, opts = {}) {
    if (!enemy || enemy.hp <= 0) return false;
    const now = performance.now();
    const cat = opts.attackCategory || 'melee'; // 'melee' | 'ranged' | 'skill'

    if (enemy.isBoss && enemy.hasBarrier) {
      const popupPos = enemy.root.position.clone().add(new THREE.Vector3(0, 1.8 * enemy.scale, 0));
      this.onDamagePopup(popupPos, 'BARRIER', false);
      return false;
    }

    let dmg = Math.round(rawDmg * (enemy.isBoss ? bossDmgMult() : 1.0));

    // ブレイク中の被ダメージ2.5倍（300.5F+ 適応装甲ブレイク）または通常スタン特効
    if (enemy.stunUntil > now) {
      if (enemy.isAdaptiveBroken) {
        dmg = Math.round(dmg * 2.5);
      } else {
        const mubiBonus = hasSynergy('awake_mubi') ? 0.85 : (artifactStat('motif_mubi') / 100);
        const stunBonus = 1.3 + mubiBonus;
        dmg = Math.round(dmg * stunBonus);
      }
    }

    if (enemy.isBoss) {
      // 25.5F ゴーレム・ガーディアン：遠距離50%軽減
      if (enemy.bossType === 'golem_guard' && cat === 'ranged') {
        dmg = Math.round(dmg * 0.5);
      }

      // 35.5F ニンジャ：ステルス解除＆近接攻撃5%反射
      if (enemy.bossType === 'ninja') {
        enemy.stealthUntil = 0;
        if (cat === 'melee' && opts.playerPos) {
          const refDmg = Math.max(1, Math.round(dmg * 0.05));
          this.onToast(`🥷 ニンジャの反撃の刃！反射 -${refDmg}`);
        }
      }

      // 55.5F アンチ・レンジゴーレム：遠距離被弾で60%目の前ワープ
      if (enemy.bossType === 'anti_range' && cat === 'ranged' && opts.playerPos && Math.random() < 0.6) {
        const wx = opts.playerPos.x + (Math.random() - 0.5) * 3.0;
        const wz = opts.playerPos.z + (Math.random() - 0.5) * 3.0;
        if (!this.world.isBlockedForEntity(wx, wz, 1.2)) {
          enemy.root.position.set(wx, 0, wz);
          this.onToast('⚡ アンチ・レンジゴーレムが目の前にワープ！');
        }
      }

      // 60.5F レッドドラゴン：近接50%軽減＋耐久消耗＋割り込みワープ吸血ブレス
      if (enemy.bossType === 'red_dragon') {
        if (cat === 'melee') {
          dmg = Math.round(dmg * 0.5);
          if (state.weapon) wear(state.weapon, 4);
        }
        if (opts.playerPos && Math.random() < 0.18) {
          enemy.state = 'chase';
          enemy.warnMat.opacity = 0;
          const wx = opts.playerPos.x + (Math.random() - 0.5) * 5.0;
          const wz = opts.playerPos.z + (Math.random() - 0.5) * 5.0;
          if (!this.world.isBlockedForEntity(wx, wz, 1.4)) {
            enemy.root.position.set(wx, 0, wz);
          }
          const dir = opts.playerPos.clone().sub(enemy.root.position).setY(0).normalize();
          [-0.25, 0, 0.25].forEach((off) => {
            const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), off);
            this.fireEnemyOrb(enemy, d, 0.28, false, true); // 命中時ボスHP5%回復する吸血弾
          });
          this.onToast('🐉 レッドドラゴンの割り込み吸血ブレス！');
        }
      }

      // 300.5F+ 適応の装甲（弱点一致1.2倍＋ブレイク蓄積：通常+12% / スキル+22%、不一致0.4倍）
      if (enemy.hasAdaptiveArmor && enemy.stunUntil <= now) {
        enemy.isAdaptiveBroken = false;
        if (cat === enemy.weakness) {
          dmg = Math.round(dmg * 1.2);
          const addBreak = (cat === 'skill') ? 22 : 12;
          enemy.breakGauge = Math.min(100, enemy.breakGauge + addBreak);
          if (enemy.breakGauge >= 100) {
            enemy.breakGauge = 0;
            enemy.isAdaptiveBroken = true;
            enemy.stunUntil = now + 3500;
            const weakTypes = ['melee', 'ranged', 'skill'].filter((t) => t !== enemy.weakness);
            enemy.weakness = weakTypes[Math.floor(Math.random() * weakTypes.length)];
            const wLabel = { melee: '近接', ranged: '遠距離', skill: 'スキル/大技' }[enemy.weakness];
            this.onToast(`💥 装甲ブレイク(3.5秒・被ダメ2.5倍)！次の弱点は【${wLabel}】！`);
          }
        } else {
          dmg = Math.round(dmg * 0.4);
        }
      }
    }

    enemy.hp = Math.max(0, enemy.hp - dmg);
    enemy.hitFlashUntil = now + 90;

    const bleedPerHit = artifactStat('bleed');
    if (bleedPerHit > 0 && enemy.hp > 0 && !opts.isBleedProc) {
      enemy.bleedCount = (enemy.bleedCount || 0) + bleedPerHit;
      const threshold = hasSynergy('crimson_harvest') ? 4 : 5;
      if (enemy.bleedCount >= threshold) {
        enemy.bleedCount = 0;
        const bleedDmg = Math.max(1, Math.round(enemy.maxHp * 0.025));
        this.damageEnemy(enemy, bleedDmg, { color: 0xff1144, isCrit: true, isBleedProc: true, attackCategory: 'skill' });
        if (hasSynergy('crimson_harvest') && opts.playerRef) {
          const heal = Math.max(1, Math.round(maxHp() * 0.02));
          opts.playerRef.hp = Math.min(maxHp(), opts.playerRef.hp + heal);
        }
      }
    }

    if (opts.stunMs) {
      enemy.stunUntil = Math.max(enemy.stunUntil, now + opts.stunMs);
      enemy.state = 'idle';
      enemy.warnMat.opacity = 0;
    }

    const popupPos = enemy.root.position.clone().add(new THREE.Vector3(0, 1.8 * enemy.scale, 0));
    this.onDamagePopup(popupPos, dmg, opts.isCrit || enemy.stunUntil > now);
    this.world.spawnHitSpark(popupPos, opts.color || 0x00ffff);

    const ratio = Math.max(0, enemy.hp / enemy.maxHp);
    enemy.hpFill.scale.x = Math.max(0.001, ratio);
    enemy.hpFill.position.x = -(1 - ratio) * (enemy.hpBarWidth * 0.5);

    if (enemy.isBoss && enemy.hp > 0) {
      if (!enemy.enraged && ratio <= 0.5) {
        enemy.enraged = true;
        this.onToast('💢 ボスが激昂状態に突入！攻撃CD短縮＆弾幕強化！');
      }
      if (enemy.barrierThresholds.length > 0 && ratio <= enemy.barrierThresholds[0]) {
        enemy.barrierThresholds.shift();
        this.activateBossBarrier(enemy);
      }
    }

    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
      return true;
    }
    return false;
  }

  killEnemy(enemy) {
    const pos = enemy.root.position.clone();
    for (let i = 0; i < 12; i++) {
      this.world.spawnHitSpark(pos.clone().add(new THREE.Vector3(0, 1, 0)), enemy.color);
    }

    this.scene.remove(enemy.root);
    this.enemies = this.enemies.filter((e) => e !== enemy);

    // 10.5F以降で手下が倒されるとボスの最大HPの5%回復
    if (!enemy.isBoss && enemy.isSummonedMinion && this.activeBoss && this.activeBoss.floor >= 10) {
      const heal = Math.round(this.activeBoss.maxHp * 0.05);
      this.activeBoss.hp = Math.min(this.activeBoss.maxHp, this.activeBoss.hp + heal);
      this.onToast(`🩸 手下撃破によりボスのHPが5%回復！`);
    }
    
    if (!enemy.isBoss && state.weapon?.type === 'inferno_scythe') {
      if (this.playerRef) {
        const heal = Math.round(maxHp() * 0.12);
        this.playerRef.hp = Math.min(maxHp(), this.playerRef.hp + heal);
      }
      if (this.activeBoss && this.activeBoss.hp > 0) {
        this.addBossHellfire(20);
        this.onToast('🔥 魂吸収！HP12%回復＆ボス業火+20%');
      }
    }

    if (this.activeBoss === enemy) {
      this.activeBoss = null;
      this.clearAllProjectilesAndHazards(); // 撃破時に残存ボス弾幕を全消去
      this.world.unlockExitPortal();
    }

    const expGain = EXP_PER_KILL * (enemy.isBoss ? 10 : enemy.isRare ? 3 : 1);
    const goldGain = goldFor(enemy.floor, enemy.isBoss) * (enemy.isRare ? 2 : 1);
    PLAYER.exp += expGain;
    PLAYER.gold += goldGain;
    state.exsGauge = Math.min(EXS_GAUGE_MAX, state.exsGauge + (enemy.isBoss ? 40 : 12));

    while (PLAYER.exp >= expNeed(PLAYER.lv)) {
      PLAYER.exp -= expNeed(PLAYER.lv);
      PLAYER.lv++;
      PLAYER.pts += 3;
      this.onToast(`🎉 LEVEL UP! Lv.${PLAYER.lv} (ステータスPt +3)`);
    }

    if (enemy.isBoss) {
      SAVE.cleared = Math.max(SAVE.cleared, enemy.floor);
      const rWep = Math.random();
      if (enemy.floor >= 10 && rWep < 0.15) {
        const bw = rollWeapon(enemy.dropWep, enemy.floor);
        if (addToPack(bw)) this.onToast(`🏆 ボス専用武器【${bw.name}】ドロップ！`);
      } else if (rWep < 0.25) {
        const types = ['sword', 'dual', 'bow', 'greatsword', 'spear', 'spellbook'];
        const nw = rollWeapon(types[Math.floor(Math.random() * types.length)], enemy.floor);
        if (addToPack(nw)) this.onToast(`✨ 武器ドロップ【${nw.name}】！`);
      }
      if (Math.random() < 0.20) {
        const art = rollArtifact();
        if (addToPack(art)) this.onToast(`🔮 遺物ドロップ【${art.name}】！`);
      }
      this.onToast(`🏆 ${enemy.floor}.5F ボス撃破！階段開放＆ExS+40%`);
    } else if (enemy.isRare) {
      // ★異名持ちレアモンスター撃破：永続ステータス強化＋初回スペルブック確定ドロップ
      if (enemy.rareBuffType === 'hp') {
        PLAYER.bonusHp = (PLAYER.bonusHp || 0) + 100;
        if (this.playerRef) this.playerRef.hp += 100;
        this.onToast('🌟 レア討伐報酬！基礎最大HP +100（永続）！');
      } else {
        PLAYER.bonusAtk = (PLAYER.bonusAtk || 0) + 50;
        this.onToast('🌟 レア討伐報酬！基礎攻撃力 +50（永続）！');
      }

      if (!SAVE.spellbookDropped) {
        const sb = rollWeapon('spellbook', enemy.floor);
        if (addToPack(sb)) {
          SAVE.spellbookDropped = true;
          this.onToast('📖 初回レア討伐特典【スペルブック】を入手！');
        }
      } /*else if (Math.random() < 0.5) {
        const art = rollArtifact();
        if (addToPack(art)) this.onToast(`🔮 遺物ドロップ【${art.name}】！`);
      }*/
    } else if (Math.random() < DROP_RATE) {
      const arm = rollArmor(randomSlot(), enemy.floor);  
      if (addToPack(arm)) { 
        this.onToast(`🛡️ ドロップ【${arm.label}】！`);
      } else {
        this.onToast('バッグがいっぱいで拾えなかった…');
      }
    }

    saveGame();
  }

  fireEnemyOrb(enemy, dir, speed = 0.25, homing = false, lifesteal = false) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 10, 10),
      new THREE.MeshBasicMaterial({ color: lifesteal ? 0xff1144 : homing ? 0xff00ff : enemy.color })
    );
    mesh.position.copy(enemy.root.position).add(new THREE.Vector3(0, 1.2 * enemy.scale, 0));
    this.scene.add(mesh);

    this.enemyProjectiles.push({
      mesh,
      vel: dir.clone().multiplyScalar(speed),
      atk: enemy.atk,
      life: 3.5,
      homing,
      lifesteal,
      ownerBoss: enemy.isBoss ? enemy : null
    });
  }

  // ---- 最も近いターゲット（プレイヤー または 味方召喚ビット）を取得 ----
  getNearestTargetPos(bossPos, player) {
    let bestPos = player.root.position.clone();
    let minDist = bossPos.distanceTo(bestPos);

    if (player.astralBits && player.astralBits.length > 0) {
      for (const b of player.astralBits) {
        const d = bossPos.distanceTo(b.mesh.position);
        if (d < minDist) {
          minDist = d;
          bestPos = b.mesh.position.clone();
        }
      }
    }
    return { pos: bestPos, dist: minDist };
  }

  // ---- 前回と同じ技を避けて攻撃パターンを選択し、赤い予兆フェーズへ移行 ----
  beginBossPatternWindup(boss) {
    const f = boss.floor;
    const warnMult = boss.enraged ? 0.7 : 1.0;

    const pool = ['omni', 'fan', 'dash'];
    if (f >= 3) pool.push('summon', 'homing');
    if (f >= 5) pool.push('shockwave');
    if (f >= 10) pool.push('eruption');
    if (f >= 15) pool.push('blaster');

    // 前回と同じ技は選ばない
    const candidates = pool.filter((p) => p !== boss.lastPattern);
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    boss.lastPattern = pick;
    boss.pendingPattern = pick;

    const baseWarn = {
      omni: 0.8, fan: 0.6, dash: 0.9, summon: 1.0,
      homing: 0.7, shockwave: 1.1, eruption: 1.8, blaster: 1.2
    }[pick] || 0.8;

    boss.state = 'pattern_windup';
    boss.stateTimer = baseWarn * warnMult;
    boss.maxWindupTimer = boss.stateTimer;
  }

  // ---- 予兆完了後のボス攻撃実行 ----
  executeBossPattern(boss, targetPos) {
    const pick = boss.pendingPattern;
    const f = boss.floor;
    const enraged = boss.enraged;
    const toP = targetPos.clone().sub(boss.root.position).setY(0).normalize();

    if (pick === 'omni') {
      const count = enraged ? 18 : 12;
      for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count;
        this.fireEnemyOrb(boss, new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)), 0.24);
      }
    } else if (pick === 'fan') {
      const count = enraged ? 7 : 5;
      const spread = 0.16;
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * spread;
        const d = toP.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), off);
        this.fireEnemyOrb(boss, d, 0.27);
      }
    } else if (pick === 'dash') {
      boss.state = 'dash';
      boss.stateTimer = 0.55;
      boss.dashVel.copy(toP).multiplyScalar(0.36);
      return;
    } else if (pick === 'summon') {
      const minionCount = this.enemies.filter((e) => !e.isBoss).length;
      if (minionCount < 5) {
        const addCount = enraged ? 2 : 1;
        for (let i = 0; i < addCount; i++) {
          const sx = boss.root.position.x + (Math.random() - 0.5) * 6;
          const sz = boss.root.position.z + (Math.random() - 0.5) * 6;
          this.createEnemy({
            name: '召喚された従者',
            x: sx, z: sz,
            color: 0x9f7aea, scale: 0.95,
            hp: Math.round(boss.maxHp * 0.08),
            maxHp: Math.round(boss.maxHp * 0.08),
            atk: Math.round(boss.atk * 0.5),
            speed: 0.1, atkRange: 2.2,
            isBoss: false, isRare: false, isSummonedMinion: true, floor: f
          });
        }
        this.onToast('👾 ボスが手下を召喚した！');
      }
    } else if (pick === 'homing') {
      this.fireEnemyOrb(boss, toP, 0.21, true);
    } else if (pick === 'shockwave') {
      this.spawnHazardZone(boss.root.position.x, boss.root.position.z, 6.2, 0.35, Math.round(boss.atk * 1.3), 0xb15cff, false);
    } else if (pick === 'eruption') {
      this.onToast('🌋 大噴火！足元の「緑の安全地帯円」に留まれ！');
      this.spawnHazardZone(targetPos.x, targetPos.z, 6.8, 0.85, Math.round(boss.atk * 1.8), 0x48bb78, true);
    } else if (pick === 'blaster') {
      const count = enraged ? 4 : 3;
      this.onToast('⚡ ガスターブラスター照準！射線から離れろ！');
      for (let i = 0; i < count; i++) {
        const bx = targetPos.x + (Math.random() - 0.5) * 10;
        const bz = targetPos.z + (Math.random() - 0.5) * 10;
        this.spawnHazardZone(bx, bz, 2.4, 0.7, Math.round(boss.atk * 1.6), 0x00ffff, false);
      }
    }

    boss.state = 'chase';
  }

  spawnHazardZone(x, z, radius, delaySec, atk, color, isSafeZone = false) {
    const geo = isSafeZone
      ? new THREE.RingGeometry(radius - 0.4, radius, 32)
      : new THREE.CircleGeometry(radius, 28);
    const ring = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.09, z);
    this.scene.add(ring);

    this.hazardZones.push({
      mesh: ring,
      pos: new THREE.Vector3(x, 0, z),
      radius,
      timer: delaySec,
      maxTimer: delaySec,
      atk,
      color,
      isSafeZone
    });
  }

  update(dt, player) {
    this.playerRef = player;
    const now = performance.now();
    const pPos = player.root.position;

    if (this.activeBoss && this.activeBoss.hasBarrier && this.world.destructibles.length === 0) {
      this.breakBossBarrier();
    }

    if (this.activeBoss && this.activeBoss.hellfireGauge > 0 && this.activeBoss.hp > 0) {
      this.activeBoss.hellfireTick += dt;
      if (this.activeBoss.hellfireTick >= 1.0) {
        this.activeBoss.hellfireTick -= 1.0;
        const slip = Math.max(1, Math.round(this.activeBoss.maxHp * 0.004 * (this.activeBoss.hellfireGauge / 100)));
        this.damageEnemy(this.activeBoss, slip, { color: 0xff4500, attackCategory: 'skill' });
      }
    }

    this.hazardZones = this.hazardZones.filter((h) => {
      h.timer -= dt;
      h.mesh.material.opacity = 0.3 + (1 - Math.max(0, h.timer / h.maxTimer)) * 0.6;
      if (h.timer <= 0) {
        const dist = Math.hypot(pPos.x - h.pos.x, pPos.z - h.pos.z);
        if (h.isSafeZone) {
          if (dist > h.radius) player.receiveEnemyAttack(h.atk, h.pos);
        } else {
          for (let i = 0; i < 8; i++) {
            this.world.spawnHitSpark(h.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), h.color);
          }
          if (dist <= h.radius && pPos.y < 1.6) {
            player.receiveEnemyAttack(h.atk, h.pos);
          }
        }
        this.scene.remove(h.mesh);
        return false;
      }
      return true;
    });

    for (const enemy of [...this.enemies]) {
      enemy.hpBg.lookAt(this.camera.position);
      enemy.hpFill.lookAt(this.camera.position);

      if (enemy.bossType === 'ninja') {
        enemy.mat.opacity = now < enemy.stealthUntil ? 0.12 : 1.0;
      }

      if (now < enemy.hitFlashUntil) {
        enemy.mat.emissive.setHex(0xffffff);
        enemy.mat.emissiveIntensity = 0.85;
      } else if (enemy.state === 'pattern_windup') {
        // 赤い予兆表示（本体点滅）
        const blink = Math.sin(now * 0.035) > 0;
        enemy.mat.emissive.setHex(blink ? 0xff1133 : enemy.color);
        enemy.mat.emissiveIntensity = blink ? 0.9 : 0.25;
      } else {
        enemy.mat.emissive.setHex(enemy.color);
        enemy.mat.emissiveIntensity = enemy.isBoss ? 0.25 : 0.1;
      }

      if (now < enemy.stunUntil) {
        enemy.warnMat.opacity = 0;
        enemy.stunBox.visible = true;
        enemy.stunBox.rotation.y += dt * 2.5;
        continue;
      } else {
        enemy.stunBox.visible = false;
      }

      const speedMult = now < enemy.slowUntil ? 0.45 : 1.0;

      // ボスのターゲット取得（プレイヤー＆味方ビットの最寄り対象、索敵範囲26m）
      const targetInfo = enemy.isBoss
        ? this.getNearestTargetPos(enemy.root.position, player)
        : { pos: pPos, dist: enemy.root.position.distanceTo(pPos) };

      const tPos = targetInfo.pos;
      const toTarget = new THREE.Vector3(tPos.x - enemy.root.position.x, 0, tPos.z - enemy.root.position.z);
      const dist = toTarget.length();
      const dir = dist > 0.01 ? toTarget.clone().normalize() : new THREE.Vector3(0, 0, 1);

      // ボスの行動サイクル（距離28m以内かつCD完了時に前回と違う技を選択→予兆→実行）
      if (enemy.isBoss) {
        if (enemy.state === 'pattern_windup') {
          enemy.stateTimer -= dt;
          enemy.warnMat.opacity = 0.45;
          if (enemy.stateTimer <= 0) {
            enemy.warnMat.opacity = 0;
            this.executeBossPattern(enemy, tPos);
          }
          continue;
        }

        if (enemy.state === 'dash') {
          enemy.stateTimer -= dt;
          const nx = enemy.root.position.x + enemy.dashVel.x * speedMult;
          const nz = enemy.root.position.z + enemy.dashVel.z * speedMult;
          if (!this.world.isBlockedForEntity(nx, nz, 0.5 * enemy.scale)) {
            enemy.root.position.set(nx, 0, nz);
          }
          if (enemy.root.position.distanceTo(pPos) < 1.8 * enemy.scale) {
            player.receiveEnemyAttack(Math.round(enemy.atk * 1.5), enemy.root.position);
          }
          if (enemy.stateTimer <= 0) enemy.state = 'chase';
          continue;
        }

        if (dist <= 28) {
          enemy.patternTimer -= dt;
          if (enemy.patternTimer <= 0) {
            enemy.patternTimer = enemy.enraged ? 1.4 : 2.2;
            this.beginBossPatternWindup(enemy);
            continue;
          }
        }
      }

      // 通常敵は22m以内で索敵、ボスは26m以内で追跡
      const aggroRange = enemy.isBoss ? 26 : 22;
      if (dist > aggroRange && enemy.state === 'idle') continue;

      if (enemy.state === 'idle' || enemy.state === 'chase') {
        enemy.state = 'chase';
        enemy.root.rotation.y = Math.atan2(dir.x, dir.z);

        const stopDist = enemy.ranged ? 9.0 : enemy.atkRange * 0.85;
        if (dist > stopDist) {
          const nextX = enemy.root.position.x + dir.x * enemy.speed * speedMult;
          const nextZ = enemy.root.position.z + dir.z * enemy.speed * speedMult;
          if (!this.world.isBlockedForEntity(nextX, enemy.root.position.z, 0.5 * enemy.scale)) {
            enemy.root.position.x = nextX;
          }
          if (!this.world.isBlockedForEntity(enemy.root.position.x, nextZ, 0.5 * enemy.scale)) {
            enemy.root.position.z = nextZ;
          }
        } else {
          enemy.state = 'windup';
          enemy.stateTimer = (enemy.isBoss ? 0.65 : 0.55) * (enemy.enraged ? 0.7 : 1.0);
        }
      } else if (enemy.state === 'windup') {
        enemy.stateTimer -= dt;
        const progress = 1 - Math.max(0, enemy.stateTimer / 0.65);
        enemy.warnMat.opacity = 0.2 + progress * 0.65;
        enemy.warnRing.scale.setScalar(0.5 + progress * 0.5);

        if (enemy.stateTimer <= 0) {
          enemy.warnMat.opacity = 0;
          enemy.state = 'cooldown';
          enemy.stateTimer = enemy.isBoss ? (enemy.enraged ? 0.8 : 1.1) : 1.3;

          if (enemy.ranged) {
            this.fireEnemyOrb(enemy, dir, 0.22);
          } else if (dist <= enemy.atkRange + 0.6) {
            player.receiveEnemyAttack(enemy.atk, enemy.root.position);
          }
        }
      } else if (enemy.state === 'cooldown') {
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) enemy.state = 'chase';
      }
    }

    this.enemyProjectiles = this.enemyProjectiles.filter((p) => {
      p.life -= dt;
      if (p.homing) {
        const target = pPos.clone().add(new THREE.Vector3(0, 1.0, 0));
        const toT = target.sub(p.mesh.position).normalize();
        const spd = p.vel.length();
        p.vel.lerp(toT.multiplyScalar(spd), 0.06).normalize().multiplyScalar(spd);
      }
      p.mesh.position.add(p.vel);

      const dPlayer = p.mesh.position.distanceTo(pPos.clone().add(new THREE.Vector3(0, 1.0, 0)));
      if (dPlayer < 0.85) {
        player.receiveEnemyAttack(p.atk, p.mesh.position);
        // 60.5F レッドドラゴン吸血ブレス命中時、ボス最大HP5%回復
        if (p.lifesteal && p.ownerBoss && p.ownerBoss.hp > 0) {
          p.ownerBoss.hp = Math.min(p.ownerBoss.maxHp, p.ownerBoss.hp + Math.round(p.ownerBoss.maxHp * 0.05));
        }
        this.scene.remove(p.mesh);
        return false;
      }

      if (p.life <= 0 || this.world.isBlockedForEntity(p.mesh.position.x, p.mesh.position.z, 0.25)) {
        this.scene.remove(p.mesh);
        return false;
      }
      return true;
    });
  }
}
