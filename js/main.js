import * as THREE from 'three';
import { World } from './world.js';
import { EnemyManager } from './enemy.js';
import { Player } from './player.js';
import { UIManager } from './ui.js';
import { expNeed, EXS_GAUGE_MAX } from './data.js';
import { state, SAVE, PLAYER, EQUIPPED, maxHp, atkTotal, plus, saveGame } from './save.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.FogExp2(0x0b0d12, 0.018);

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

let currentFloor = Math.max(1, (SAVE.cleared || 0) + 1);
let slowMoUntil = 0;

const world = new World(scene);
const enemyManager = new EnemyManager(scene, camera, world, showToast, spawnDamagePopup);
let uiManager = null;

const player = new Player(scene, camera, world, enemyManager, {
  onToast: showToast,
  onNextFloor: () => enterFloor(currentFloor + 1),
  onDeath: () => {
    showToast('💀 力尽きた… 1Fへ帰還');
    enterFloor(1);
  },
  onSlowMo: (sec) => { slowMoUntil = performance.now() + sec * 1000; },
  isUiOpen: () => uiManager ? uiManager.isOpen() : false
});

uiManager = new UIManager(player, world, enemyManager, showToast);

function enterFloor(floor) {
  currentFloor = floor;
  const layout = world.buildFloor(floor);
  player.root.position.copy(layout.playerStart);
  player.velocityY = 0;
  enemyManager.spawnForFloor(floor, layout.spawnPoints, layout.bossPoint);
  showToast(floor % 5 === 0 ? `⚠️ 第${floor}層 ボスフロア突入！` : `⚔️ 第${floor}層 到着`);
  saveGame();
}

enterFloor(currentFloor);

// PointerLock
const overlay = document.getElementById('lock-overlay');
overlay.addEventListener('click', () => {
  if (!uiManager.isOpen()) document.body.requestPointerLock();
});

// オーバーレイが消えている状態でも、画面クリック時にロックが外れていれば再ロックする
renderer.domElement.addEventListener('mousedown', () => {
  if (!uiManager.isOpen() && document.pointerLockElement !== document.body) {
    document.body.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === document.body;
  overlay.classList.toggle('hidden', locked || uiManager.isOpen());
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

  floorSpan.textContent = currentFloor;
  enemyCountSpan.textContent = enemyManager.enemies.length;

  const boss = enemyManager.activeBoss;
  if (boss && boss.hp > 0) {
    bossHud.classList.remove('hidden');
    bossNameSpan.textContent = boss.name;
    bossHpBar.style.width = `${(boss.hp / boss.maxHp) * 100}%`;
    bossHpText.textContent = `${boss.hp.toLocaleString()} / ${boss.maxHp.toLocaleString()}`;
  } else {
    bossHud.classList.add('hidden');
  }

  const distPortal = Math.hypot(
    player.root.position.x - world.portalPos.x,
    player.root.position.z - world.portalPos.z
  );
  if (distPortal <= 2.6) {
    interactPrompt.classList.remove('hidden');
    interactPrompt.textContent = world.portalLocked ? '🔒 ボス討伐で解放' : '[F] 次の階層へ進む';
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
    world.update(worldDt);
    enemyManager.update(worldDt, player);
    player.update(dt);
  }

  updateHud(now);
  renderer.render(scene, camera);
}

animate();
