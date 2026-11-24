import {
  SAVE_KEY, PLAYER_HP, HP_PER_PT, ATK_PER_PT, GOLD, POTION_DEF,
  SHOP, DEATH, SMITH, DURABILITY, EXS_GAUGE_MAX,
  WEAPONS, LEGEND_BASE_ATK, isLegendWeapon, isRestrictedLegend, WEAPON_VARIATIONS,
  ARMOR_TYPES, SLOT_KEYS, ARMOR_VARIATIONS, ARMOR_BASE_STATS, TIERS, ARMOR_ROLL, RED_CAP, FLOORS_PER_TIER,
  ARTIFACT_LIST, ARTIFACT_SYNERGIES
} from './data.js';

export const PACK_COLS = 5;
export const PACK_ROWS = 4;
export const STORAGE_MAX = 40;

export const SAVE = { cleared: 0, autoSell: false, autoDismantle: false };
export const PLAYER = { lv: 1, exp: 0, pts: 0, hpPts: 0, atkPts: 0, bonusHp: 0, bonusAtk: 0, gold: GOLD.start, currentHp: null };
export const POTIONS = { small: 0, full: 0 };

export const EQUIPPED = {
  helmet: null,
  chest: null,
  legs: null,
  shoes: null,
  sub_weapon: null
};

export const ARTIFACTS = [null, null, null];
export const BACKPACK = Array(PACK_COLS * PACK_ROWS).fill(null);
export const STORAGE = Array(PACK_COLS * PACK_ROWS).fill(null);
export const SPELLBOOK_SLOTS = [null, null, null];
export const TRIGGER_SLOTS = {
  normal: 'kogetsu', // 左クリック（初期は弧月）
  skillE: null,      // Eキー
  skillQ: null,      // Qキー
  opt1: null,        // 1キー
  opt2: null,        // 2キー
  opt3: null,        // 3キー
  exs: 'ibis'        // Zキー（EXS枠）
};

// 動的に切り替わる装備・ゲージ状態
export const state = {
  weapon: null,
  exsGauge: 0,
  equippedExsId: 'giga_breaker',
  ownedExs: { giga_breaker: 1 },
  ownedTriggers: { kogetsu: 1 } // 開発室倉庫の所持トリガーとレベル（id: lv）
};

// 動的に切り替わる装備・ゲージ状態
export const state = {
  weapon: null,
  exsGauge: 0,
  equippedExsId: 'giga_breaker',
  ownedExs: { giga_breaker: 1 }
};

// ---- 武器・防具・遺物生成 ----
const WEAPON_SCALE = { perFloor: 0.12 };
export const weaponFloorMult = (floor) => 1 + WEAPON_SCALE.perFloor * (Math.max(1, floor) - 1);

export function rollWeapon(type, floor = 1) {
  const baseDef = WEAPONS[type] || WEAPONS.sword;
  let name = baseDef.name;
  let atk = Math.round(baseDef.base * weaponFloorMult(floor));
  let cd = baseDef.cd;

  if (baseDef.isLegend) {
    const targetFloor = Math.max(floor, SAVE.cleared || 1);
    const baseVal = LEGEND_BASE_ATK[type] || 500;
    const scaledAtk = Math.round(baseVal * weaponFloorMult(targetFloor));
    return {
      type,
      name: baseDef.name,
      baseAtk: baseVal,
      cd: baseDef.cd,
      range: baseDef.range,
      speedMult: baseDef.speedMult,
      projSpeed: baseDef.projSpeed || 0.85,
      skill: baseDef.skill,
      slot: 'weapon',
      dur: 999,
      durMax: 999,
      lv: 0,
      atk: scaledAtk,
      isLegend: true,
      rarity: 'Legend'
    };
  }

  if (WEAPON_VARIATIONS[type]) {
    const vars = WEAPON_VARIATIONS[type];
    const v = vars[Math.floor(Math.random() * vars.length)];
    name = v.name;
    atk = Math.round(baseDef.base * v.mult * (0.85 + Math.random() * 0.3) * weaponFloorMult(floor));
    cd = Math.round(baseDef.cd * v.cdMult);
  }

  const isBoss = ['demon_sword', 'eruption_wand', 'dragon_chain', 'lightning_staff'].includes(type);
  return {
    type,
    name,
    baseAtk: baseDef.base,
    cd,
    range: baseDef.range,
    speedMult: baseDef.speedMult,
    projSpeed: baseDef.projSpeed || 0.85,
    skill: baseDef.skill,
    slot: 'weapon',
    dur: 100,
    durMax: 100,
    lv: 0,
    atk,
    isBossItem: isBoss,
    rarity: isBoss ? 'boss' : 'normal'
  };
}

export const randomSlot = () => SLOT_KEYS[Math.floor(Math.random() * SLOT_KEYS.length)];
export const tierFor = (floor) => Math.min(TIERS.length - 1, Math.floor((Math.max(1, floor) - 1) / FLOORS_PER_TIER) + (Math.random() < 0.15 ? 1 : 0));

export function rollArmor(slot, floor) {
  const base = ARMOR_BASE_STATS[slot];
  const ti = tierFor(floor);
  const vars = ARMOR_VARIATIONS[slot].filter((v) => v.tier === ti);
  const v = vars[Math.floor(Math.random() * vars.length)];
  const roll = ARMOR_ROLL[0] + Math.random() * (ARMOR_ROLL[1] - ARMOR_ROLL[0]);
  const depth = 1 + 0.05 * Math.max(0, floor - TIERS.length * FLOORS_PER_TIER);
  const m = TIERS[ti].mult * roll * depth;

  return {
    slot,
    tier: ti,
    label: v.name,
    hp: Math.round(base.hp * v.hpMult * m),
    red: Math.round(base.red * v.redMult * m * 1000) / 1000,
    dur: 50 + 25 * ti,
    durMax: 50 + 25 * ti,
    lv: 0
  };
}

export function rollArtifact() {
  const normalList = ARTIFACT_LIST.filter((a) => a.rarity !== 'Legend');
  const fixed = normalList[Math.floor(Math.random() * normalList.length)];
  return {
    slot: 'artifact',
    name: fixed.name,
    typeKey: fixed.typeKey,
    typeName: fixed.typeName,
    val: fixed.val,
    unit: fixed.unit,
    desc: fixed.desc,
    dur: 1,
    durMax: 1,
    lv: 0
  };
}

export function rollLegendArtifact(typeKey) {
  const fixed = ARTIFACT_LIST.find((a) => a.typeKey === typeKey);
  if (!fixed) return null;
  return {
    slot: 'artifact',
    rarity: 'Legend',
    motifFor: fixed.motifFor,
    name: fixed.name,
    typeKey: fixed.typeKey,
    typeName: fixed.typeName,
    val: fixed.val,
    unit: fixed.unit,
    desc: fixed.desc,
    awakeDesc: fixed.awakeDesc || '',
    dur: 1,
    durMax: 1,
    lv: 0
  };
}

export const createPotion = (kind = 'small', count = 1) => ({
  slot: 'potion',
  kind,
  name: POTION_DEF[kind].name,
  pct: POTION_DEF[kind].pct,
  stack: count,
  maxStack: 5,
  dur: 1,
  durMax: 1,
  lv: 0
});

// 初期アイテム配置
state.weapon = rollWeapon('sword');
BACKPACK[0] = rollWeapon('dual');
BACKPACK[1] = rollWeapon('bow');
BACKPACK[2] = rollWeapon('greatsword');
BACKPACK[3] = rollWeapon('spear');

// ---- ステータス＆シナジー計算 ----
export const unlockedArtifactSlots = () => (SAVE.cleared >= 250 ? 3 : SAVE.cleared >= 100 ? 2 : 1);
export const equippedArtifacts = () => ARTIFACTS.slice(0, unlockedArtifactSlots()).filter(Boolean);
export const isArtifact = (it) => !!it && it.slot === 'artifact';
export const isWeapon = (it) => !!it && it.slot === 'weapon';

export function activeSynergies() {
  const eqKeys = new Set(equippedArtifacts().map((it) => it.typeKey));
  return ARTIFACT_SYNERGIES.filter((syn) => {
    const hasKeys = syn.keys.every((k) => eqKeys.has(k));
    const hasWep = !syn.reqWeapon || (state.weapon && state.weapon.type === syn.reqWeapon);
    return hasKeys && hasWep;
  });
}

export const hasSynergy = (id) => activeSynergies().some((s) => s.id === id);
export const artifactStat = (key) => equippedArtifacts().reduce((sum, it) => sum + (it.typeKey === key ? it.val : 0), 0);
export const bossDmgMult = () => 1 + (artifactStat('bossPct') + (hasSynergy('god_slayer') ? 35 : 0)) / 100;

export function armorStats() {
  let hp = 0;
  let red = 0;
  for (const key of SLOT_KEYS) {
    const it = EQUIPPED[key];
    if (it && it.dur > 0) {
      hp += it.hp || 0;
      red += it.red || 0;
    }
  }
  if (red > RED_CAP) {
    hp += Math.floor((red - RED_CAP) * 100);
    red = RED_CAP;
  }
  return { hp, red };
}

export function maxHp() {
  const base = PLAYER_HP + PLAYER.hpPts * HP_PER_PT + (PLAYER.bonusHp || 0) + armorStats().hp + artifactStat('hpFlat');
  const bonusPct = artifactStat('hpPct') + (hasSynergy('colossus_heart') ? 25 : 0);
  let mult = 1 + bonusPct / 100;
  if (artifactStat('glassCannon') > 0) mult *= 0.5;
  return Math.max(1, Math.round(base * mult));
}

export function atkTotal(curHp = null) {
  const w = state.weapon;
  const base = Math.round((w.atk + PLAYER.atkPts * ATK_PER_PT + (PLAYER.bonusAtk || 0)) * (w.dur > 0 ? 1 : DURABILITY.brokenAtkMult));
  let mult = 1 + artifactStat('atkPct') / 100;
  if (artifactStat('glassCannon') > 0) mult += artifactStat('glassCannon') / 100;

  const threshold = hasSynergy('abyss_berserker') ? 0.5 : 0.3;
  const isCrisis = hasSynergy('glass_god') || (curHp !== null && curHp <= maxHp() * threshold);
  if (isCrisis && artifactStat('crisisAtk') > 0) {
    const crisisBonus = hasSynergy('abyss_berserker')
      ? artifactStat('crisisAtk') * 2
      : hasSynergy('glass_god')
      ? 50
      : artifactStat('crisisAtk');
    mult += crisisBonus / 100;
  }
  return Math.round(base * mult);
}

export const takeDamage = (d) => Math.max(1, Math.round(d * (1 - armorStats().red)));
export const plus = (it) => (it && it.lv ? `+${it.lv}` : '');
export const armorLabel = (it) => `${it.label}${plus(it)}(HP+${it.hp} 軽減${(it.red * 100).toFixed(1)}%)`;

// ---- バッグ・装備操作 ----
export function addToPack(it) {
  if (SAVE.autoSell && it && !it.isLegend && !it.isBossItem && it.type !== 'spellbook') {
    if (it.slot === 'weapon') {
      const gain = Math.max(10, Math.round(it.atk * SHOP.sellPerAtk));
      PLAYER.gold += gain;
      return true;
    }
    if (SLOT_KEYS.includes(it.slot)) {
      const gain = Math.max(10, Math.round(((it.hp || 10) + (it.red || 0.01) * 500) * SHOP.sellPerArmor));
      PLAYER.gold += gain;
      return true;
    }
  }
  if (PLAYER.lv >= 200 && SAVE.autoDismantle && it && SLOT_KEYS.includes(it.slot)) {
    const eq = EQUIPPED[it.slot];
    const score = (a) => (a ? (a.hp || 0) + (a.red || 0) * 500 : 0);
    // 同じ部位を装備中で、拾った防具の性能が装備中以下なら自動分解してゴールド化
    if (eq && score(it) <= score(eq)) {
      const goldGain = Math.max(15, Math.round(score(it) * SHOP.sellPerArmor));
      PLAYER.gold += goldGain;
      return true; // バッグには入れず取得完了扱い
    }
  }
  if (it.slot === 'potion') {
    for (let i = 0; i < BACKPACK.length; i++) {
      const slotItem = BACKPACK[i];
      if (slotItem && slotItem.slot === 'potion' && slotItem.kind === it.kind && slotItem.stack < slotItem.maxStack) {
        const space = slotItem.maxStack - slotItem.stack;
        if (it.stack <= space) {
          slotItem.stack += it.stack;
          return true;
        } else {
          slotItem.stack = slotItem.maxStack;
          it.stack -= space;
        }
      }
    }
  }
  const emptyIndex = BACKPACK.indexOf(null);
  if (emptyIndex < 0) return false;
  BACKPACK[emptyIndex] = it;
  return true;
}

export function wear(it, n) {
  if (!it || it.dur <= 0 || it.isLegend) return false;
  it.dur = Math.max(0, it.dur - n);
  return it.dur === 0;
}

export const wearArmor = (n) => SLOT_KEYS.map((k) => EQUIPPED[k]).filter((it) => it && wear(it, n));

export const spendGold = (n) => {
  if (PLAYER.gold < n) return false;
  PLAYER.gold -= n;
  return true;
};

// ---- セーブ＆ロード ----
export function saveGame() {
  try {
    const data = {
      spellbookDropped: !!SAVE.spellbookDropped,
      cleared: SAVE.cleared,
      autoSell: SAVE.autoSell,
      autoDismantle: SAVE.autoDismantle,
      player: { ...PLAYER },
      potions: { ...POTIONS },
      weapon: state.weapon,
      artifacts: [...ARTIFACTS],
      artifactEq: ARTIFACTS[0],
      equipped: EQUIPPED,
      backpack: BACKPACK,
      storage: STORAGE,
      spellbookSlots: SPELLBOOK_SLOTS,
      exsGauge: state.exsGauge,
      equippedExsId: state.equippedExsId,
      ownedExs: { ...state.ownedExs },
      triggerSlots: { ...TRIGGER_SLOTS },
      ownedTriggers: { ...state.ownedTriggers },
      triggerHolderDropped: !!SAVE.triggerHolderDropped,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('セーブ失敗:', e);
    return false;
  }
}

export function loadGame() {
  try {
    const json = localStorage.getItem(SAVE_KEY);
    if (!json) return false;
    const data = JSON.parse(json);

    SAVE.cleared = data.cleared || 0;
    SAVE.autoSell = !!data.autoSell;
    SAVE.autoDismantle = !!data.autoDismantle;
    SAVE.spellbookDropped = !!data.spellbookDropped;
    SAVE.triggerHolderDropped = !!data.triggerHolderDropped;
    if (data.triggerSlots) Object.assign(TRIGGER_SLOTS, data.triggerSlots);
    if (data.ownedTriggers) Object.assign(state.ownedTriggers, data.ownedTriggers);
    Object.assign(PLAYER, data.player);
    Object.assign(POTIONS, data.potions);
    
    if (data.weapon) state.weapon = data.weapon;

    if (Array.isArray(data.artifacts)) {
      data.artifacts.forEach((it, i) => { ARTIFACTS[i] = it; });
    } else if (data.artifactEq) {
      ARTIFACTS[0] = data.artifactEq;
    }

    Object.keys(EQUIPPED).forEach((k) => {
      if (data.equipped && k in data.equipped) EQUIPPED[k] = data.equipped[k];
    });
    if (Array.isArray(data.backpack)) {
      data.backpack.forEach((item, i) => { if (i < BACKPACK.length) BACKPACK[i] = item; });
    }
    if (Array.isArray(data.storage)) {
      STORAGE.length = Math.max(20, data.storage.length);
      STORAGE.fill(null);
      data.storage.forEach((item, i) => { STORAGE[i] = item; });
    }
    if (Array.isArray(data.spellbookSlots)) {
      data.spellbookSlots.forEach((item, i) => { SPELLBOOK_SLOTS[i] = item; });
    }

    if (data.exsGauge != null) state.exsGauge = data.exsGauge;
    if (data.equippedExsId) state.equippedExsId = data.equippedExsId;
    if (data.ownedExs) Object.assign(state.ownedExs, data.ownedExs);

    // Legend武器の攻撃力スケーリング維持
    const targetFloor = Math.max(1, SAVE.cleared || 1);
    const allItems = [state.weapon, ...BACKPACK, ...STORAGE, ...Object.values(EQUIPPED)];
    allItems.forEach((it) => {
      if (isLegendWeapon(it)) {
        const baseVal = LEGEND_BASE_ATK[it.type] || 500;
        const baseScaled = Math.round(baseVal * weaponFloorMult(targetFloor));
        const lvMult = Math.pow(1 + SMITH.upStep, it.lv || 0);
        const newAtk = Math.round(baseScaled * lvMult);
        if (it.atk < newAtk) it.atk = newAtk;
      }
    });

    if (isRestrictedLegend(state.weapon)) {
      if (EQUIPPED.sub_weapon) {
        addToPack(EQUIPPED.sub_weapon);
        EQUIPPED.sub_weapon = null;
      }
      state.equippedExsId = null;
    }
    return true;
  } catch (e) {
    console.error('ロード失敗:', e);
    return false;
  }
}

// 起動時に自動ロード
loadGame();
