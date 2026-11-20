import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';

// シーン・カメラ・レンダラー
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.FogExp2(0x0b0d12, 0.015);

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

// ワールド＆プレイヤー生成
const world = new World(scene);
const player = new Player(scene, camera, world);

// PointerLock（クリックで操作開始・ESCで解除）
const overlay = document.getElementById('lock-overlay');
overlay.addEventListener('click', () => {
  document.body.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === document.body) {
    overlay.classList.add('hidden');
  } else {
    overlay.classList.remove('hidden');
  }
});

// HUD要素の参照
const fpsSpan = document.getElementById('fps-value');
const statusSpan = document.getElementById('action-status');
const hpBar = document.getElementById('hud-hp-bar');
const hpText = document.getElementById('hud-hp-text');
const gaugeBar = document.getElementById('hud-gauge-bar');
const gaugeText = document.getElementById('hud-gauge-text');
const cdDodge = document.getElementById('cd-dodge');
const cdSkill = document.getElementById('cd-skill');
const cdExs = document.getElementById('cd-exs');

function updateHud(now) {
  hpBar.style.width = `${(player.hp / player.maxHp) * 100}%`;
  hpText.textContent = `HP ${player.hp} / ${player.maxHp}`;

  gaugeBar.style.width = `${player.exsGauge}%`;
  gaugeText.textContent = `ExS ${Math.floor(player.exsGauge)}%`;

  const dodgeLeft = Math.max(0, player.nextDodgeTime - now);
  cdDodge.textContent = dodgeLeft > 0 ? `${(dodgeLeft / 1000).toFixed(1)}s` : 'READY';
  cdDodge.style.color = dodgeLeft > 0 ? '#ffd36a' : '#48bb78';

  const skillLeft = Math.max(0, player.nextSkillTime - now);
  cdSkill.textContent = skillLeft > 0 ? `${(skillLeft / 1000).toFixed(1)}s` : 'READY';
  cdSkill.style.color = skillLeft > 0 ? '#ffd36a' : '#48bb78';

  cdExs.textContent = player.exsGauge >= 100 ? 'READY!!' : `${Math.floor(player.exsGauge)}%`;
  cdExs.style.color = player.exsGauge >= 100 ? '#00ffff' : '#a0aec0';

  if (now < player.dodgeUntil) {
    statusSpan.textContent = '極限回避ダッシュ中';
  } else if (player.comboStep > 0) {
    statusSpan.textContent = `コンボ ${player.comboStep}段目`;
  } else {
    statusSpan.textContent = '戦闘待機';
  }
}

// メインループ
let lastFpsTime = performance.now();
let prevFrameTime = performance.now();
let frames = 0;

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min((now - prevFrameTime) / 1000, 0.05);
  prevFrameTime = now;

  frames++;
  if (now >= lastFpsTime + 1000) {
    fpsSpan.textContent = frames;
    frames = 0;
    lastFpsTime = now;
  }

  world.update(dt);
  player.update(dt);
  updateHud(now);

  renderer.render(scene, camera);
}

animate();
