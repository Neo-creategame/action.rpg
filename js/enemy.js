import * as THREE from 'three';
import { EXP_PER_KILL, expNeed, goldFor, DROP_RATE, EXS_GAUGE_MAX } from './data.js';
import {
  state, SAVE, PLAYER, bossDmgMult,
  rollWeapon, rollArmor, randomSlot, rollArtifact, addToPack, saveGame
} from './save.js';

const BOSS_DEFS = [
  { floor: 5,  type: 'demon',     name: '第5層ボス【深淵の魔王】',         color: 0xb15cff, scale: 1.9, hpMult: 1.0,  atkMult: 1.0,  dropWep: 'demon_sword' },
  { floor: 10, type: 'ifrit',     name: '第10層ボス【滅びの炎巨神】',       color: 0xff4500, scale: 2.2, hpMult: 1.35, atkMult: 1.25, dropWep: 'eruption_wand' },
  { floor: 15, type: 'dragon',    name: '第15層ボス【天空の雷帝竜】',       color: 0xffd36a, scale: 2.4, hpMult: 1.7,  atkMult: 1.45, dropWep: 'dragon_chain' },
  { floor: 20, type: 'takemika',  name: '第20層ボス【雷神・タケミカヅチ】', color: 0x00ffff, scale: 2.5, hpMult: 2.1,  atkMult: 1.7,  dropWep: 'lightning_staff' }
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
    this.hazardZones = []; // ボスのマグマ噴火・落雷予兆ゾーン
    this.activeBoss = null;
    this.initialBossPillars = 0;
  }

  clearAll() {
    for (const e of this.enemies) this.scene.remove(e.root);
    this.enemies = [];
    this.activeBoss = null;

    for (const p of this.enemyProjectiles) this.scene.remove(p.mesh);
    this.enemyProjectiles = [];

    for (const h of this.hazardZones) this.scene.remove(h.mesh);
    this.hazardZones = [];
  }

  spawnForFloor(floor, spawnPoints, bossPoint) {
    this.clearAll();
    const isBossFloor = floor % 5 === 0;

    // 階層が進むと上位モンスター（ダークナイト・ワイバーン）が追加出現
    const mobTypes = [
      { name: 'コボルト兵',     color: 0xe53e3e, scale: 1.0,  hp: 140, atk: 12, speed: 0.085, range: 2.2 },
      { name: 'シャドウウルフ', color: 0x805ad5, scale: 0.9,  hp: 110, atk: 15, speed: 0.130, range: 2.0 },
      { name: 'ゴーレム衛兵',   color: 0xdd6b20, scale: 1.35, hp: 250, atk: 20, speed: 0.055, range: 2.6 }
    ];
    if (floor >= 6) {
      mobTypes.push({ name: 'ダークナイト', color: 0x4a5568, scale: 1.15, hp: 220, atk: 24, speed: 0.095, range: 2.5 });
    }
    if (floor >= 11) {
      mobTypes.push({ name: 'カオスワイバーン', color: 0xd53f8c, scale: 1.25, hp: 280, atk: 28, speed: 0.115, range: 3.0, ranged: true });
    }

    const scaleMult = 1 + (floor - 1) * 0.22;

    spawnPoints.forEach((pt) => {
      const isRare = Math.random() < 0.14;
      const base = mobTypes[Math.floor(Math.random() * mobTypes.length)];
      const hp = Math.round(base.hp * scaleMult * (isRare ? 2.2 : 1.0));
      const atk = Math.round(base.atk * (1 + (floor - 1) * 0.16) * (isRare ? 1.4 : 1.0));

      this.createEnemy({
        name: isRare ? `★レア・${base.name}` : base.name,
        x: pt.x,
        z: pt.z,
        color: isRare ? 0xffd36a : base.color,
        scale: base.scale * (isRare ? 1.2 : 1.0),
        hp,
        maxHp: hp,
        atk,
        speed: base.speed,
        atkRange: base.range,
        isBoss: false,
        isRare,
        ranged: !!base.ranged,
        floor
      });
    });

    if (isBossFloor && bossPoint) {
      const def = BOSS_DEFS.find((b) => b.floor === floor) || {
        type: 'overlord',
        name: `第${floor}層ボス【深淵の覇王】`,
        color: 0xff1144,
        scale: 2.6,
        hpMult: 1.6 + floor * 0.08,
        atkMult: 1.3 + floor * 0.05,
        dropWep: ['demon_sword', 'eruption_wand', 'dragon_chain', 'lightning_staff'][Math.floor(Math.random() * 4)]
      };

      const bossHp = Math.round(1700 * scaleMult * def.hpMult);
      const bossAtk = Math.round(28 * (1 + (floor - 1) * 0.16) * def.atkMult);

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
        speed: 0.08,
        atkRange: 4.0,
        isBoss: true,
        isRare: false,
        dropWep: def.dropWep,
        floor
      });
      this.activeBoss = boss;
      this.initialBossPillars = this.world.destructibles.length;
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
      roughness: 0.45
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

    // ボスには角・翼パーツを追加して威圧感を出す
    if (cfg.isBoss) {
      const hornGeo = new THREE.ConeGeometry(0.22 * s, 0.9 * s, 6);
      const hornL = new THREE.Mesh(hornGeo, mat);
      hornL.position.set(-0.35 * s, 2.2 * s, 0);
      hornL.rotation.z = 0.3;
      const hornR = new THREE.Mesh(hornGeo, mat);
      hornR.position.set(0.35 * s, 2.2 * s, 0);
      hornR.rotation.z = -0.3;
      root.add(hornL, hornR);
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
      warnRing,
      warnMat,
      hpBg,
      hpFill,
      hpBarWidth: 1.34 * s,
      state: 'idle',
      stateTimer: 0,
      specialTimer: 3.5,
      stunUntil: 0,
      hitFlashUntil: 0
    };

    this.enemies.push(enemy);
    return enemy;
  }

  damageEnemy(enemy, rawDmg, opts = {}) {
    if (!enemy || enemy.hp <= 0) return false;
    const now = performance.now();

    let dmg = Math.round(rawDmg * (enemy.isBoss ? bossDmgMult() : 1.0));
    if (enemy.stunUntil > now) {
      dmg = Math.round(dmg * 1.35);
    }

    enemy.hp = Math.max(0, enemy.hp - dmg);
    enemy.hitFlashUntil = now + 90;

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
    if (this.activeBoss === enemy) {
      this.activeBoss = null;
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
      const bossWep = rollWeapon(enemy.dropWep || 'demon_sword', enemy.floor);
      if (addToPack(bossWep)) {
        this.onToast(`🏆 ボス撃破！確定ドロップ【${bossWep.name}】獲得！`);
      } else {
        this.onToast(`🏆 ボス撃破！+${goldGain}G`);
      }
      if (Math.random() < 0.5) addToPack(rollArtifact());
    } else if (Math.random() < (enemy.isRare ? 0.65 : DROP_RATE)) {
      const r = Math.random();
      let drop = null;
      if (r < 0.45) {
        const types = ['sword', 'dual', 'bow', 'greatsword', 'spear', 'spellbook'];
        drop = rollWeapon(types[Math.floor(Math.random() * types.length)], enemy.floor);
      } else if (r < 0.85) {
        drop = rollArmor(randomSlot(), enemy.floor);
      } else {
        drop = rollArtifact();
      }

      if (drop && addToPack(drop)) {
        this.onToast(`✨ ドロップ: ${drop.name || drop.label}`);
      }
    }

    saveGame();
  }

  fireEnemyOrb(enemy, dir, speed = 0.25) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 10, 10),
      new THREE.MeshBasicMaterial({ color: enemy.color })
    );
    mesh.position.copy(enemy.root.position).add(new THREE.Vector3(0, 1.2 * enemy.scale, 0));
    this.scene.add(mesh);

    this.enemyProjectiles.push({
      mesh,
      vel: dir.clone().multiplyScalar(speed),
      atk: enemy.atk,
      life: 3.5
    });
  }

  // ボスの予兆範囲攻撃（マグマ噴火・雷帝落雷）
  spawnHazardZone(x, z, radius, delaySec, atk, color) {
    const ring = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 24),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.35 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.08, z);
    this.scene.add(ring);

    this.hazardZones.push({
      mesh: ring,
      pos: new THREE.Vector3(x, 0, z),
      radius,
      timer: delaySec,
      atk,
      color
    });
  }

  // ボスごとの固有大技実行
  triggerBossSpecial(boss, playerPos) {
    const type = boss.bossType;
    if (type === 'ifrit') {
      // 10F 炎巨神：マグマ噴火ゾーンを3箇所発生
      this.onToast('🔥 炎巨神のマグマ噴火！赤い円から離れろ！');
      for (let i = 0; i < 3; i++) {
        const ox = playerPos.x + (Math.random() - 0.5) * 9;
        const oz = playerPos.z + (Math.random() - 0.5) * 9;
        this.spawnHazardZone(ox, oz, 3.2, 1.35, Math.round(boss.atk * 1.4), 0xff4500);
      }
    } else if (type === 'dragon') {
      // 15F 雷帝竜：5連雷帝落雷陣
      this.onToast('⚡ 雷帝竜の雷嵐ブレス！');
      for (let i = 0; i < 5; i++) {
        const ox = playerPos.x + (Math.random() - 0.5) * 11;
        const oz = playerPos.z + (Math.random() - 0.5) * 11;
        this.spawnHazardZone(ox, oz, 2.8, 1.2 + i * 0.15, Math.round(boss.atk * 1.3), 0xffd36a);
      }
    } else if (type === 'takemika' || type === 'overlord') {
      // 20F+ 雷神・覇王：全方位8方向魔力弾＋落雷
      this.onToast('💥 ボスの全周囲サンダーストーム！');
      for (let i = 0; i < 8; i++) {
        const ang = (Math.PI * 2 * i) / 8;
        this.fireEnemyOrb(boss, new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)), 0.28);
      }
      this.spawnHazardZone(playerPos.x, playerPos.z, 3.4, 1.25, Math.round(boss.atk * 1.5), 0x00ffff);
    } else {
      // 5F 深淵の魔王：3WAY追尾闇弾
      const baseDir = playerPos.clone().sub(boss.root.position).setY(0).normalize();
      [-0.3, 0, 0.3].forEach((off) => {
        const d = baseDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), off);
        this.fireEnemyOrb(boss, d, 0.26);
      });
    }
  }

  update(dt, player) {
    const now = performance.now();
    const pPos = player.root.position;

    // ボス部屋の魔力結晶柱がすべて破壊されたらボスをブレイクスタンさせるギミック
    if (this.activeBoss && this.initialBossPillars > 0 && this.world.destructibles.length === 0) {
      this.initialBossPillars = 0;
      this.activeBoss.stunUntil = now + 4500;
      this.onToast('💥 魔力結晶全破壊！ボスが4.5秒間ブレイクスタン！');
    }

    // 予兆ゾーン（マグマ噴火・落雷）の更新
    this.hazardZones = this.hazardZones.filter((h) => {
      h.timer -= dt;
      h.mesh.material.opacity = 0.25 + (1 - Math.max(0, h.timer / 1.4)) * 0.55;
      if (h.timer <= 0) {
        // 爆発柱エフェクト＆プレイヤー被弾判定
        for (let i = 0; i < 8; i++) {
          this.world.spawnHitSpark(h.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), h.color);
        }
        if (Math.hypot(pPos.x - h.pos.x, pPos.z - h.pos.z) <= h.radius && pPos.y < 1.5) {
          player.receiveEnemyAttack(h.atk, h.pos);
        }
        this.scene.remove(h.mesh);
        return false;
      }
      return true;
    });

    for (const enemy of [...this.enemies]) {
      enemy.hpBg.lookAt(this.camera.position);
      enemy.hpFill.lookAt(this.camera.position);

      if (now < enemy.hitFlashUntil) {
        enemy.mat.emissive.setHex(0xffffff);
        enemy.mat.emissiveIntensity = 0.85;
      } else {
        enemy.mat.emissive.setHex(enemy.color);
        enemy.mat.emissiveIntensity = enemy.isBoss ? 0.25 : 0.1;
      }

      if (now < enemy.stunUntil) {
        enemy.warnMat.opacity = 0;
        continue;
      }

      // ボスの固有大技タイマー
      if (enemy.isBoss) {
        enemy.specialTimer -= dt;
        if (enemy.specialTimer <= 0) {
          enemy.specialTimer = 5.5;
          this.triggerBossSpecial(enemy, pPos);
        }
      }

      const toPlayer = new THREE.Vector3(pPos.x - enemy.root.position.x, 0, pPos.z - enemy.root.position.z);
      const dist = toPlayer.length();
      const dir = dist > 0.01 ? toPlayer.clone().normalize() : new THREE.Vector3(0, 0, 1);

      if (!enemy.isBoss && dist > 22 && enemy.state === 'idle') continue;

      if (enemy.state === 'idle' || enemy.state === 'chase') {
        enemy.state = 'chase';
        enemy.root.rotation.y = Math.atan2(dir.x, dir.z);

        const stopDist = enemy.ranged ? 9.0 : enemy.atkRange * 0.85;
        if (dist > stopDist) {
          const nextX = enemy.root.position.x + dir.x * enemy.speed;
          const nextZ = enemy.root.position.z + dir.z * enemy.speed;
          if (!this.world.isBlockedForEntity(nextX, enemy.root.position.z, 0.5 * enemy.scale)) {
            enemy.root.position.x = nextX;
          }
          if (!this.world.isBlockedForEntity(enemy.root.position.x, nextZ, 0.5 * enemy.scale)) {
            enemy.root.position.z = nextZ;
          }
        } else {
          enemy.state = 'windup';
          enemy.stateTimer = enemy.isBoss ? 0.65 : 0.55;
        }
      } else if (enemy.state === 'windup') {
        enemy.stateTimer -= dt;
        const progress = 1 - Math.max(0, enemy.stateTimer / 0.65);
        enemy.warnMat.opacity = 0.2 + progress * 0.65;
        enemy.warnRing.scale.setScalar(0.5 + progress * 0.5);

        if (enemy.stateTimer <= 0) {
          enemy.warnMat.opacity = 0;
          enemy.state = 'cooldown';
          enemy.stateTimer = enemy.isBoss ? 1.1 : 1.3;

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
      p.mesh.position.add(p.vel);

      const dPlayer = p.mesh.position.distanceTo(pPos.clone().add(new THREE.Vector3(0, 1.0, 0)));
      if (dPlayer < 0.85) {
        player.receiveEnemyAttack(p.atk, p.mesh.position);
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
