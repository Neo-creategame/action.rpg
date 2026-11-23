import * as THREE from 'three';
import { World } from './world.js';
import { EnemyManager } from './enemy.js';
import { Player } from './player.js';
import { UIManager } from './ui.js';
import { expNeed, EXS_GAUGE_MAX, DEATH } from './data.js';
import {
  state, SAVE, PLAYER, EQUIPPED, BACKPACK, STORAGE, SPELLBOOK_SLOTS,
  maxHp, atkTotal, plus, wear, saveGame
} from './save.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.FogExp2(0x0b0d12, 0.018);

// 全体を均一に照らす環境光（ダンジョン内の暗がり対策）
const hemiLight = new THREE.HemisphereLight(0xa0c4ff, 0x2d3748, 1.4);
scene.add(hemiLight);

// 立体感と影を作るメインの平行光源
const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
dirLight.position.set(25, 45, 25);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 150;
const d = 50;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
scene.add(dirLight);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('warp-floor', (e) => {
  if (typeof e.detail === 'object' && e.detail !== null) {
    enterFloor(e.detail.floor, !!e.detail.isBoss);
  } else {
    enterFloor(e.detail, false);
  }
});

const toastContainer = document.getElementById('toast-container');
function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

const damageLayer = document.getElementById('damage-layer');
function spawnDamagePopup(worldPos, dmg, isCrit = false) {
  const projected = worldPos.clone().project(camera);
  if (projected.z > 1) return;

  const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;

  const el = document.createElement('div');
  el.className = isCrit ? 'dmg-popup crit' : 'dmg-popup';
  el.textContent = isCrit ? `${dmg}!` : dmg;
  el.style.left = `${x + (Math.random() - 0.5) * 24}px`;
  el.style.top = `${y}px`;
  damageLayer.appendChild(el);
  setTimeout(() => el.remove(), 750);
}

let currentFloor = 0;
let isBossStage = false; // false = 通常階 (XF), true = ボス階 (X.5F)
let slowMoUntil = 0;

const world = new World(scene, showToast);
const enemyManager = new EnemyManager(scene, camera, world, showToast, spawnDamagePopup);
let uiManager = null;

const player = new Player(scene, camera, world, enemyManager, {
  onToast: showToast,
  onNextFloor: () => {
    if (currentFloor === 0) {
      const startDungeonFloor = Math.max(1, (SAVE.cleared || 0) + 1);
      enterFloor(startDungeonFloor, false);
    } else if (!isBossStage) {
      enterFloor(currentFloor, true);
    } else {
      enterFloor(currentFloor + 1, false);
    }
  },
  onDeath: () => {
    PLAYER.pts = 0;
    const allItems = [state.weapon, ...Object.values(EQUIPPED), ...BACKPACK, ...STORAGE];
    for (const it of allItems) {
      if (it && !it.isLegend && it.dur > 0) {
        const loss = Math.floor(it.dur * (1 - DEATH.durKeep));
        if (loss > 0) wear(it, loss);
      }
    }
    saveGame();
    showToast('💀 力尽きた… 未振分Pt没収＆装備耐久半減で町へ帰還');
    enterFloor(0, false);
  },
  onSlowMo: (sec) => { slowMoUntil = performance.now() + sec * 1000; },
  isUiOpen: () => uiManager ? uiManager.isOpen() : false
});

uiManager = new UIManager(player, world, enemyManager, showToast);

function enterFloor(floor, bossFlag = false) {
  currentFloor = floor;
  isBossStage = bossFlag;

  const layout = world.buildFloor(floor, isBossStage);
  player.root.position.copy(layout.playerStart);
  player.velocityY = 0;

  enemyManager.spawnForFloor(floor, layout.spawnPoints, layout.bossPoint, isBossStage, layout.bossRoomCorners);
  showToast(floor === 0 ? '🏰 0F 始まりの町' : isBossStage ? `⚠️ 第${floor}.5層 ボス階突入！` : `⚔️ 第${floor}層 到着`);
  saveGame();
}

enterFloor(currentFloor, false);

// PointerLock
const overlay = document.getElementById('lock-overlay');
overlay.addEventListener('click', () => {
  if (!uiManager.isOpen()) document.body.requestPointerLock();
});

renderer.domElement.addEventListener('mousedown', () => {
  if (!uiManager.isOpen() && document.pointerLockElement !== document.body) {
    document.body.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === document.body) {
    overlay.classList.add('hidden');
  }
});

// HUD要素
const fpsSpan = document.getElementById('fps-value');
const enemyCountSpan = document.getElementById('enemy-count');
const statusSpan = document.getElementById('action-status');
const floorSpan = document.getElementById('hud-floor');
const bossHud = document.getElementById('boss-hud');
const bossNameSpan = document.getElementById('boss-name');
const bossHpBar = document.getElementById('boss-hp-bar');
const bossHpText = document.getElementById('boss-hp-text');
const interactPrompt = document.getElementById('interact-prompt');

const lvSpan = document.getElementById('hud-lv');
const hpBar = document.getElementById('hud-hp-bar');
const hpText = document.getElementById('hud-hp-text');
const expBar = document.getElementById('hud-exp-bar');
const specialWrap = document.getElementById('hud-special-wrap');
const specialBar = document.getElementById('hud-special-bar');
const specialText = document.getElementById('hud-special-text');
const atkSpan = document.getElementById('hud-atk');
const goldSpan = document.getElementById('hud-gold');

const mainWepSpan = document.getElementById('hud-main-wep');
const mainDurSpan = document.getElementById('hud-main-dur');
const subWepSpan = document.getElementById('hud-sub-wep');

const cdDodge = document.getElementById('cd-dodge');
const cdSkill = document.getElementById('cd-skill');
const nameSkill = document.getElementById('name-skill');
const cdExs = document.getElementById('cd-exs');

function updateHud(now) {
  const w = state.weapon;
  const mHp = maxHp();
  if (player.hp > mHp) player.hp = mHp;

  floorSpan.textContent = currentFloor === 0 ? '0 (始まりの町)' : currentFloor;
  enemyCountSpan.textContent = enemyManager.enemies.length;

  const boss = enemyManager.activeBoss;
  const extraHud = document.getElementById('boss-extra-hud');
  const weakBadge = document.getElementById('boss-weak-badge');
  const subWrap = document.getElementById('boss-sub-bar-wrap');
  const subBar = document.getElementById('boss-sub-bar');
  const subText = document.getElementById('boss-sub-text');

  if (boss && boss.hp > 0) {
    bossHud.classList.remove('hidden');
    bossNameSpan.textContent = boss.name;
    bossHpBar.style.width = `${(boss.hp / boss.maxHp) * 100}%`;
    bossHpText.textContent = `${boss.hp.toLocaleString()} / ${boss.maxHp.toLocaleString()}`;

    if (extraHud) {
      const showAdaptive = boss.hasAdaptiveArmor;
      const showHellfire = (w.type === 'inferno_scythe' || boss.hellfireGauge > 0);
      if (showAdaptive || showHellfire) {
        extraHud.classList.remove('hidden');
        if (showAdaptive) {
          weakBadge.classList.remove('hidden');
          const wLabel = { melee: '⚔️ 弱点: 近接', ranged: '🏹 弱点: 遠距離', skill: '✨ 弱点: スキル' }[boss.weakness];
          weakBadge.textContent = boss.isAdaptiveBroken ? '💥 ARMOR BREAK!' : wLabel;
          subWrap.classList.remove('hidden');
          subBar.style.width = `${boss.breakGauge}%`;
          subBar.style.background = 'linear-gradient(90deg, #dd6b20, #ffd36a)';
          subText.textContent = `ブレイク ${Math.floor(boss.breakGauge)}%`;
        } else {
          weakBadge.classList.add('hidden');
          subWrap.classList.remove('hidden');
          subBar.style.width = `${boss.hellfireGauge}%`;
          subBar.style.background = 'linear-gradient(90deg, #c53030, #ff5500)';
          subText.textContent = `業火 ${Math.floor(boss.hellfireGauge)}%`;
        }
      } else {
        extraHud.classList.add('hidden');
      }
    }
  } else {
    bossHud.classList.add('hidden');
  }

  // 宝箱・回復の泉・階段ポータルの接近プロンプト
  const nearbyItem = world.getNearbyInteractable(player.root.position);
  const distPortal = Math.hypot(
    player.root.position.x - world.portalPos.x,
    player.root.position.z - world.portalPos.z
  );
  if (nearbyItem) {
    interactPrompt.classList.remove('hidden');
    interactPrompt.textContent = nearbyItem.label;
  } else if (distPortal <= 2.8) {
    interactPrompt.classList.remove('hidden');
    interactPrompt.textContent = currentFloor === 0
      ? '[F] ダンジョンへ出発する'
      : world.portalLocked ? '🔒 ボス討伐で解放' : '[F] 次の階層へ進む';
  } else {
    interactPrompt.classList.add('hidden');
  }

  lvSpan.textContent = PLAYER.lv;
  hpBar.style.width = `${(player.hp / mHp) * 100}%`;
  hpText.textContent = `HP ${Math.ceil(player.hp)} / ${mHp}`;
  expBar.style.width = `${Math.min(100, (PLAYER.exp / expNeed(PLAYER.lv)) * 100)}%`;

  atkSpan.textContent = atkTotal(player.hp).toLocaleString();
  goldSpan.textContent = PLAYER.gold.toLocaleString();

  if (w.type === 'mubi') {
    specialWrap.classList.remove('hidden');
    specialBar.style.width = `${(player.souenGauge / 120) * 100}%`;
    specialBar.style.background = 'linear-gradient(90deg, #00b5d8, #00ffff)';
    specialText.textContent = `蒼焔 ${Math.floor(player.souenGauge)} / 120`;
  } else if (w.type === 'apocalypse') {
    specialWrap.classList.remove('hidden');
    specialBar.style.width = `${player.apoGauge}%`;
    specialBar.style.background = 'linear-gradient(90deg, #9b2c2c, #ff1144)';
    specialText.textContent = `終末 ${Math.floor(player.apoGauge)} / 100`;
  } else if (w.type === 'astral_orb') {
    specialWrap.classList.remove('hidden');
    specialBar.style.width = `${player.starGauge}%`;
    specialBar.style.background = 'linear-gradient(90deg, #047857, #10b981)';
    specialText.textContent = `星力 ${Math.floor(player.starGauge)} / 100`;
  } else if (w.type === 'chronos_bow') {
    specialWrap.classList.remove('hidden');
    specialBar.style.width = `${player.chronosGauge}%`;
    specialBar.style.background = 'linear-gradient(90deg, #1d4ed8, #3b82f6)';
    specialText.textContent = `刻限 ${Math.floor(player.chronosGauge)} / 100`;
  } else {
    specialWrap.classList.add('hidden');
  }

  mainWepSpan.textContent = `${w.name}${plus(w)}`;
  mainDurSpan.textContent = w.isLegend ? '∞' : `${w.dur}/${w.durMax}`;
  subWepSpan.textContent = EQUIPPED.sub_weapon ? `${EQUIPPED.sub_weapon.name}${plus(EQUIPPED.sub_weapon)}` : 'なし';

  const dodgeLeft = Math.max(0, player.nextDodgeTime - now);
  cdDodge.textContent = dodgeLeft > 0 ? `${(dodgeLeft / 1000).toFixed(1)}s` : 'READY';
  cdDodge.style.color = dodgeLeft > 0 ? '#ffd36a' : '#48bb78';

  nameSkill.textContent = w.skill ? w.skill.name : 'スキル';
  const skillLeft = Math.max(0, player.nextSkillTime - now);
  cdSkill.textContent = skillLeft > 0 ? `${(skillLeft / 1000).toFixed(1)}s` : 'READY';
  cdSkill.style.color = skillLeft > 0 ? '#ffd36a' : '#48bb78';

  // スペルブック装備時のみ1・2・3スロットをHUDに表示
  const sbContainer = document.getElementById('spellbook-hud-slots');
  if (sbContainer) {
    if (w.type === 'spellbook') {
      sbContainer.classList.remove('hidden');
      for (let i = 0; i < 3; i++) {
        const sl = SPELLBOOK_SLOTS[i];
        document.getElementById(`sb-name-${i}`).textContent = sl ? sl.skillName : '未登録';
        const cdEl = document.getElementById(`sb-cd-${i}`);
        if (!sl) {
          cdEl.textContent = '-';
          cdEl.style.color = '#718096';
        } else {
          const left = Math.max(0, player.nextSbTimes[i] - now);
          cdEl.textContent = left > 0 ? `${(left / 1000).toFixed(1)}s` : 'READY';
          cdEl.style.color = left > 0 ? '#ffd36a' : '#48bb78';
        }
      }
    } else {
      sbContainer.classList.add('hidden');
    }
  }

  cdExs.textContent = state.exsGauge >= EXS_GAUGE_MAX ? 'READY!!' : `${Math.floor(state.exsGauge)}%`;
  cdExs.style.color = state.exsGauge >= EXS_GAUGE_MAX ? '#00ffff' : '#a0aec0';

  if (now < slowMoUntil) statusSpan.textContent = '⚡ 極限回避スロー';
  else if (now < player.dodgeUntil) statusSpan.textContent = '回避ダッシュ中';
  else if (player.comboStep > 0) statusSpan.textContent = `コンボ ${player.comboStep}段目`;
  else statusSpan.textContent = '戦闘待機';

  uiManager.updateMinimap(currentFloor);
}

let lastFpsTime = performance.now();
let prevFrameTime = performance.now();
let frames = 0;

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  let dt = Math.min((now - prevFrameTime) / 1000, 0.05);
  prevFrameTime = now;

  frames++;
  if (now >= lastFpsTime + 1000) {
    fpsSpan.textContent = frames;
    frames = 0;
    lastFpsTime = now;
  }

  // メニュー（バッグ・町）を開いている間は戦闘を一時停止
  if (!uiManager.isOpen()) {
    const worldDt = now < slowMoUntil ? dt * 0.25 : dt;
    world.update(worldDt, player);
    enemyManager.update(worldDt, player);
    player.update(dt);
  }

  updateHud(now);
  renderer.render(scene, camera);
}

animate();
