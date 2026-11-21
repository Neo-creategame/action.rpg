import * as THREE from 'three';
import { EXP_PER_KILL, expNeed, goldFor, DROP_RATE, EXS_GAUGE_MAX } from './data.js';
import {
  state, SAVE, PLAYER, maxHp, takeDamage, bossDmgMult,
  rollWeapon, rollArmor, randomSlot, rollArtifact, addToPack, saveGame
} from './save.js';

const BOSS_DEFS = [
  { floor: 5,  name: '第5層ボス【深淵の魔王】',   color: 0xb15cff, scale: 1.9, hpMult: 1.0,  atkMult: 1.0,  dropWep: 'demon_sword' },
  { floor: 10, name: '第10層ボス【滅びの炎巨神】', color: 0xff4500, scale: 2.2, hpMult: 1.35, atkMult: 1.25, dropWep: 'eruption_wand' },
  { floor: 15, name: '第15層ボス【天空の雷帝竜】', color: 0xffd36a, scale: 2.4, hpMult: 1.7,  atkMult: 1.45, dropWep: 'dragon_chain' },
  { floor: 20, name: '第20層ボス【雷神・タケミカヅチ】', color: 0x00ffff, scale: 2.5, hpMult: 2.1, atkMult: 1.7, dropWep: 'lightning_staff' }
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
    this.activeBoss = null;
  }

  clearAll() {
    for (const e of this.enemies) {
      this.scene.remove(e.root);
    }
    this.enemies = [];
    this.activeBoss = null;

    for (const p of this.enemyProjectiles) {
      this.scene.remove(p.mesh);
    }
    this.enemyProjectiles = [];
  }

  // 階層に応じた敵・ボスのスポーン
  spawnForFloor(floor, spawnPoints, bossPoint) {
    this.clearAll();
    const isBossFloor = floor % 5 === 0;

    // 雑魚敵・レア敵の配置
    const mobTypes = [
      { name: 'コボルト兵',   color: 0xe53e3e, scale: 1.0, hp: 140, atk: 12, speed: 0.085, range: 2.2 },
      { name: 'シャドウウルフ', color: 0x805ad5, scale: 0.9, hp: 110, atk: 15, speed: 0.125, range: 2.0 },
      { name: 'ゴーレム衛兵', color: 0xdd6b20, scale: 1.35, hp: 240, atk: 20, speed: 0.055, range: 2.6 }
    ];

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
        floor
      });
    });

    // ボス階層ならボスを配置
    if (isBossFloor && bossPoint) {
      const def = BOSS_DEFS.find((b) => b.floor === floor) || {
        name: `第${floor}層ボス【深淵の覇王】`,
        color: 0xff1144,
        scale: 2.5,
        hpMult: 1.5 + floor * 0.08,
        atkMult: 1.2 + floor * 0.05,
        dropWep: ['demon_sword', 'eruption_wand', 'dragon_chain', 'lightning_staff'][Math.floor(Math.random() * 4)]
      };

      const bossHp = Math.round(1600 * scaleMult * def.hpMult);
      const bossAtk = Math.round(28 * (1 + (floor - 1) * 0.16) * def.atkMult);

      const boss = this.createEnemy({
        name: def.name,
        x: bossPoint.x,
        z: bossPoint.z,
        color: def.color,
        scale: def.scale,
        hp: bossHp,
        maxHp: bossHp,
        atk: bossAtk,
        speed: 0.075,
        atkRange: 3.8,
        isBoss: true,
        isRare: false,
        dropWep: def.dropWep,
        floor
      });
      this.activeBoss = boss;
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

    // 胴体
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 1.3 * s, 0.9 * s), mat);
    body.position.y = 0.75 * s;
    body.castShadow = true;
    root.add(body);

    // 頭部・発光アイ
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

    // 攻撃予兆リング（足元に広がる赤い警告円）
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

    // 3D頭上HPバー
    const hpBg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4 * s, 0.16),
      new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide })
    );
    hpBg.position.y = 2.3 * s;
    root.add(hpBg);

    const hpFill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.34 * s, 0.11),
      new THREE.MeshBasicMaterial({ color: cfg.isBoss ? 0xff1144 : cfg.isRare ? 0xffd36a : 0xe53e3e, side: THREE.DoubleSide })
    );
    hpFill.position.set(0, 2.3 * s, 0.01);
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
      state: 'idle',      // 'idle' | 'chase' | 'windup' | 'cooldown'
      stateTimer: 0,
      stunUntil: 0,
      bleedStacks: 0,
      hitFlashUntil: 0
    };

    this.enemies.push(enemy);
    return enemy;
  }

  // プレイヤーから敵へのダメージ適用
  damageEnemy(enemy, rawDmg, opts = {}) {
    if (!enemy || enemy.hp <= 0) return false;
    const now = performance.now();

    let dmg = Math.round(rawDmg * (enemy.isBoss ? bossDmgMult() : 1.0));
    if (enemy.stunUntil > now) {
      dmg = Math.round(dmg * 1.3); // ブレイク/スタン中の追撃ボーナス
    }

    enemy.hp = Math.max(0, enemy.hp - dmg);
    enemy.hitFlashUntil = now + 90;

    if (opts.stunMs) {
      enemy.stunUntil = Math.max(enemy.stunUntil, now + opts.stunMs);
      enemy.state = 'idle';
      enemy.warnMat.opacity = 0;
    }

    // 3D空間のワールド座標をスクリーン座標へ変換してダメージ数値表示
    const popupPos = enemy.root.position.clone().add(new THREE.Vector3(0, 1.8 * enemy.scale, 0));
    this.onDamagePopup(popupPos, dmg, opts.isCrit || enemy.stunUntil > now);
    this.world.spawnHitSpark(popupPos, opts.color || 0x00ffff);

    // HPバー更新
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
      this.world.unlockExitPortal(); // ボス撃破で階段ポータル解放
    }

    // EXP・ゴールド・ドロップ報酬
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

    // ボス確定ドロップ＆通常ドロップ
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
      if (r < 0.45) drop = rollWeapon(['sword', 'dual', 'bow', 'greatsword', 'spear'][Math.floor(Math.random() * 5)], enemy.floor);
      else if (r < 0.85) drop = rollArmor(randomSlot(), enemy.floor);
      else drop = rollArtifact();

      if (drop && addToPack(drop)) {
        this.onToast(`✨ ドロップ: ${drop.name || drop.label}`);
      }
    }

    saveGame();
  }

  // 敵からの遠距離弾（ボスや一部雑魚用）
  fireEnemyOrb(enemy, dir) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 10, 10),
      new THREE.MeshBasicMaterial({ color: enemy.color })
    );
    mesh.position.copy(enemy.root.position).add(new THREE.Vector3(0, 1.2 * enemy.scale, 0));
    this.scene.add(mesh);

    this.enemyProjectiles.push({
      mesh,
      vel: dir.clone().multiplyScalar(0.24),
      atk: enemy.atk,
      life: 3.0
    });
  }

  update(dt, player) {
    const now = performance.now();
    const pPos = player.root.position;

    for (const enemy of [...this.enemies]) {
      // 頭上HPバーをカメラの向きに合わせる（ビルボード）
      enemy.hpBg.lookAt(this.camera.position);
      enemy.hpFill.lookAt(this.camera.position);

      // ヒットフラッシュ復元
      if (now < enemy.hitFlashUntil) {
        enemy.mat.emissive.setHex(0xffffff);
        enemy.mat.emissiveIntensity = 0.8;
      } else {
        enemy.mat.emissive.setHex(enemy.color);
        enemy.mat.emissiveIntensity = enemy.isBoss ? 0.25 : 0.1;
      }

      // スタン中は行動停止
      if (now < enemy.stunUntil) {
        enemy.warnMat.opacity = 0;
        continue;
      }

      const toPlayer = new THREE.Vector3(pPos.x - enemy.root.position.x, 0, pPos.z - enemy.root.position.z);
      const dist = toPlayer.length();
      const dir = dist > 0.01 ? toPlayer.clone().normalize() : new THREE.Vector3(0, 0, 1);

      // 索敵範囲外なら待機
      if (!enemy.isBoss && dist > 18 && enemy.state === 'idle') continue;

      if (enemy.state === 'idle' || enemy.state === 'chase') {
        enemy.state = 'chase';
        enemy.root.rotation.y = Math.atan2(dir.x, dir.z);

        if (dist > enemy.atkRange * 0.85) {
          const nextX = enemy.root.position.x + dir.x * enemy.speed;
          const nextZ = enemy.root.position.z + dir.z * enemy.speed;
          if (!this.world.isBlockedForEntity(nextX, enemy.root.position.z, 0.5 * enemy.scale)) {
            enemy.root.position.x = nextX;
          }
          if (!this.world.isBlockedForEntity(enemy.root.position.x, nextZ, 0.5 * enemy.scale)) {
            enemy.root.position.z = nextZ;
          }
        } else {
          // 攻撃予兆（テレグラフ）開始！
          enemy.state = 'windup';
          enemy.stateTimer = enemy.isBoss ? 0.65 : 0.55;
        }
      } else if (enemy.state === 'windup') {
        // 赤い警告円を徐々に濃くして「今が極限回避のタイミング！」と知らせる
        enemy.stateTimer -= dt;
        const progress = 1 - Math.max(0, enemy.stateTimer / 0.65);
        enemy.warnMat.opacity = 0.2 + progress * 0.65;
        enemy.warnRing.scale.setScalar(0.5 + progress * 0.5);

        if (enemy.stateTimer <= 0) {
          enemy.warnMat.opacity = 0;
          enemy.state = 'cooldown';
          enemy.stateTimer = enemy.isBoss ? 1.1 : 1.3;

          // 攻撃判定実行
          if (dist <= enemy.atkRange + 0.6) {
            player.receiveEnemyAttack(enemy.atk, enemy.root.position);
          }
          // ボスは遠距離衝撃弾も放つ
          if (enemy.isBoss) {
            this.fireEnemyOrb(enemy, dir);
          }
        }
      } else if (enemy.state === 'cooldown') {
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) {
          enemy.state = 'chase';
        }
      }
    }

    // 敵の遠距離弾更新
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
