// ---- 武器・防具・遺物・ExS・ゲーム定数マスターデータ ----

export const SAVE_KEY = 'alone_rpg_save_data_v1';
export const GAME_VERSION = '3.0.0-3D';
export const VERSION_KEY = 'alone_rpg_seen_version';

export const PLAYER_HP = 100;
export const HP_PER_PT = 10;
export const ATK_PER_PT = 5;
export const EXP_PER_KILL = 30;
export const expNeed = (lv) => 50 + 25 * (lv - 1);

export const GOLD = { start: 100, perKill: 6, perFloor: 4, bossMult: 10 };
export const goldFor = (floor, boss) => (GOLD.perKill + GOLD.perFloor * floor) * (boss ? GOLD.bossMult : 1);

export const TOWN_INN_COST = 500;
export const POTION_DEF = {
  small: { name: '小回復', pct: 0.25, price: 250 },
  full:  { name: '全回復', pct: 1.0,  price: 1000 }
};

export const SHOP = { sellPerAtk: 0.8, sellPerArmor: 2, sellPerArtifactPct: 15 };
export const DEATH = { respawnHpPct: 0.1, durKeep: 0.5 };
export const SMITH = { repairPerPt: 1, weaponRepairMult: 1.5, upMax: 5, upBase: 120, upGrowth: 1.7, weaponUpMult: 1.5, upStep: 0.10 };
export const DURABILITY = { weaponAttack: 1, weaponSkill: 2, armorHit: 1, brokenAtkMult: 0.5 };
export const EXS_GAUGE_MAX = 100;

export const RANGED_WEAPON_TYPES = ['bow', 'eruption_wand', 'lightning_staff', 'astral_orb', 'chronos_bow'];

// 武器一覧（3D用の射程・速度パラメータ付き）
export const WEAPONS = {
  sword:           { name: '片手剣',             base: 100, cd: 320, range: 3.4, speedMult: 1.0,  skill: { name: '回転斬り', cd: 3000 } },
  dual:            { name: '双剣',               base: 55,  cd: 240, range: 2.8, speedMult: 1.1,  skill: { name: '乱舞', cd: 3000 } },
  bow:             { name: '弓',                 base: 110, cd: 450, range: 26,  speedMult: 1.0,  projSpeed: 0.85, skill: { name: '三連射', cd: 3000 } },
  greatsword:      { name: '大剣',               base: 210, cd: 680, range: 4.4, speedMult: 0.8,  skill: { name: '重撃一閃', cd: 5000 } },
  spear:           { name: '槍',                 base: 85,  cd: 240, range: 4.8, speedMult: 1.0,  skill: { name: '突進貫通', cd: 3500 } },
  demon_sword:     { name: '魔王の魔剣',         base: 280, cd: 360, range: 4.2, speedMult: 1.1,  skill: { name: 'ソウルサモン', cd: 8000 } },
  eruption_wand:   { name: '滅びの噴火杖',       base: 160, cd: 460, range: 24,  speedMult: 1.0,  projSpeed: 0.75, skill: { name: 'エラプションゾーン', cd: 6000 } },
  dragon_chain:    { name: '龍王の鎖鎌',         base: 140, cd: 290, range: 5.0, speedMult: 1.15, skill: { name: 'ドラゴンチャージ', cd: 5000 } },
  lightning_staff: { name: '雷神の杖',           base: 130, cd: 380, range: 26,  speedMult: 1.05, projSpeed: 0.95, skill: { name: 'サンダークロス', cd: 5000 } },
  spellbook:       { name: 'スペルブック',       base: 30,  cd: 300, range: 2.4, speedMult: 1.0,  skill: { name: '魔術ストック', cd: 1000 } },
  mubi: {
    name: '無尾', baseAtk: 500, base: 500, cd: 300, range: 4.2, speedMult: 1.15,
    isLegend: true, skill: { name: '蒼焔連突', cd: 4000 }
  },
  apocalypse: {
    name: 'アポカリプス', baseAtk: 750, base: 750, cd: 360, range: 5.0, speedMult: 1.15,
    isLegend: true, skill: { name: 'メテオ・フォール', cd: 4500 }
  },
  astral_orb: {
    name: 'アストラル・オーブ', baseAtk: 500, base: 500, cd: 320, range: 26, speedMult: 1.1,
    projSpeed: 0.8, isLegend: true, skill: { name: 'アストラル・パルス', cd: 4000 }
  },
  chronos_bow: {
    name: 'クロノス・ボウ', baseAtk: 800, base: 800, cd: 400, range: 32, speedMult: 1.2,
    projSpeed: 1.1, isLegend: true, skill: { name: 'バックステップ・アロー', cd: 4000 }
  },
  inferno_scythe: {
    name: 'インフェルノ・サイズ', baseAtk: 300, base: 350, cd: 360, range: 5.0, speedMult: 1.15,
    isLegend: true, skill: { name: 'ソウル・ハーベスト', cd: 4500 }
  },
  trigger_holder: {
    name: 'トリガーホルダー', baseAtk: 600, base: 600, cd: 320, range: 4.5, speedMult: 1.15,
    isLegend: true, skill: { name: 'メイン起動', cd: 3000 }
  }
};

export const LEGEND_BASE_ATK = {
  mubi: 500,
  astral_orb: 500,
  apocalypse: 750,
  chronos_bow: 800,
  inferno_scythe: 300,
  trigger_holder: 600,
};

export const isLegendWeapon = (w) => !!(w && LEGEND_BASE_ATK[w.type]);
export const isRestrictedLegend = (it) => isLegendWeapon(it);

export const WEAPON_VARIATIONS = {
  sword: [
    { name: 'ショートソード', mult: 0.9, cdMult: 0.9 },
    { name: 'ロングソード', mult: 1.0, cdMult: 1.0 },
    { name: 'バスタードソード', mult: 1.25, cdMult: 1.2 }
  ],
  dual: [
    { name: 'ダガー', mult: 0.85, cdMult: 0.8 },
    { name: 'ツインブレード', mult: 1.0, cdMult: 1.0 },
    { name: 'シノビクナイ', mult: 1.15, cdMult: 0.95 }
  ],
  bow: [
    { name: 'ショートボウ', mult: 0.9, cdMult: 0.85 },
    { name: 'コンポジットボウ', mult: 1.0, cdMult: 1.0 },
    { name: 'ヘビィクロスボウ', mult: 1.3, cdMult: 1.3 }
  ],
  greatsword: [
    { name: 'クレイモア', mult: 0.95, cdMult: 0.95 },
    { name: 'ツヴァイハンダー', mult: 1.0, cdMult: 1.0 },
    { name: 'ドラゴンスレイヤー', mult: 1.3, cdMult: 1.2 }
  ],
  spear: [
    { name: 'ショートスピア', mult: 0.9, cdMult: 0.85 },
    { name: 'ランス', mult: 1.0, cdMult: 1.0 },
    { name: 'ハルバード', mult: 1.25, cdMult: 1.15 }
  ]
};

// ExS (Extra Skill) リスト
export const EXS_LIST = {
  giga_breaker: {
    id: 'giga_breaker',
    name: 'ギガ・ブレイカー',
    rarity: 'SR',
    color: 0xff4500,
    desc: '前方広範囲を大剣の衝撃波で破砕（1500% DMG + 3秒スタン）'
  },
  shadow_flash: {
    id: 'shadow_flash',
    name: '疾風・影閃八重咲き',
    rarity: 'SR',
    color: 0xffd36a,
    desc: '周囲の敵を8回連続ワープ斬り付け（合計 2000% DMG）'
  },
  hell_legion: {
    id: 'hell_legion',
    name: '百鬼夜行・冥界陣',
    rarity: 'SSR',
    color: 0xb15cff,
    desc: '冥界の衝撃波と呪怨の奔流で前方を薙ぎ払う（1800% DMG）'
  }
};

// 防具
export const ARMOR_TYPES = {
  helmet: { slot: '兜' },
  chest:  { slot: '胸' },
  legs:   { slot: '脚' },
  shoes:  { slot: '靴' }
};
export const SLOT_KEYS = Object.keys(ARMOR_TYPES);

export const ARMOR_VARIATIONS = {
  helmet: [
    { tier: 0, name: 'ブロンズヘルム', hpMult: 1.0, redMult: 1.0 },
    { tier: 0, name: '青銅の額当て',   hpMult: 0.7, redMult: 1.4 },
    { tier: 1, name: 'アイアンヘルム', hpMult: 1.0, redMult: 1.0 },
    { tier: 1, name: '鉄のカブト',     hpMult: 1.3, redMult: 0.8 },
    { tier: 2, name: 'スチールヘルム', hpMult: 1.0, redMult: 1.0 },
    { tier: 2, name: '鋼鉄のバイザー', hpMult: 0.8, redMult: 1.3 },
    { tier: 3, name: 'ミスリルヘルム', hpMult: 1.0, redMult: 1.0 },
    { tier: 3, name: '聖銀の冠',       hpMult: 1.2, redMult: 0.9 }
  ],
  chest: [
    { tier: 0, name: 'ブロンズプレート', hpMult: 1.0, redMult: 1.0 },
    { tier: 0, name: 'ブロンズメイル',   hpMult: 0.8, redMult: 1.3 },
    { tier: 1, name: 'アイアンプレート', hpMult: 1.0, redMult: 1.0 },
    { tier: 1, name: '鉄の胸当て',       hpMult: 1.3, redMult: 0.85 },
    { tier: 2, name: 'スチールプレート', hpMult: 1.0, redMult: 1.0 },
    { tier: 2, name: '鋼の鎧',           hpMult: 0.85, redMult: 1.25 },
    { tier: 3, name: 'ミスリルプレート', hpMult: 1.0, redMult: 1.0 },
    { tier: 3, name: 'ミスリルローブ',   hpMult: 1.2, redMult: 0.9 }
  ],
  legs: [
    { tier: 0, name: 'ブロンズレギンス', hpMult: 1.0, redMult: 1.0 },
    { tier: 0, name: '青銅のグリーブ',   hpMult: 0.8, redMult: 1.3 },
    { tier: 1, name: 'アイアンレギンス', hpMult: 1.0, redMult: 1.0 },
    { tier: 1, name: '鉄の具足',         hpMult: 1.2, redMult: 0.85 },
    { tier: 2, name: 'スチールレギンス', hpMult: 1.0, redMult: 1.0 },
    { tier: 2, name: '鋼の脚甲',         hpMult: 0.85, redMult: 1.25 },
    { tier: 3, name: 'ミスリルレギンス', hpMult: 1.0, redMult: 1.0 },
    { tier: 3, name: '聖銀の脚甲',       hpMult: 1.15, redMult: 0.9 }
  ],
  shoes: [
    { tier: 0, name: 'ブロンズシューズ', hpMult: 1.0, redMult: 1.0 },
    { tier: 0, name: '青銅のブーツ',     hpMult: 0.8, redMult: 1.3 },
    { tier: 1, name: 'アイアンシューズ', hpMult: 1.0, redMult: 1.0 },
    { tier: 1, name: '鉄の靴',           hpMult: 1.3, redMult: 0.8 },
    { tier: 2, name: 'スチールシューズ', hpMult: 1.0, redMult: 1.0 },
    { tier: 2, name: '鋼のブーツ',       hpMult: 0.85, redMult: 1.25 },
    { tier: 3, name: 'ミスリルシューズ', hpMult: 1.0, redMult: 1.0 },
    { tier: 3, name: '聖銀の靴',         hpMult: 1.2, redMult: 0.9 }
  ]
};

export const ARMOR_BASE_STATS = {
  helmet: { hp: 12, red: 0.02 },
  chest:  { hp: 30, red: 0.05 },
  legs:   { hp: 18, red: 0.03 },
  shoes:  { hp: 8,  red: 0.015 }
};

export const TIERS = [{ mult: 1 }, { mult: 1.7 }, { mult: 2.5 }, { mult: 3.5 }];
export const ARMOR_ROLL = [0.8, 1.2];
export const RED_CAP = 0.6;
export const DROP_RATE = 0.2;
export const FLOORS_PER_TIER = 3;

// 遺物（アーティファクト）
export const ARTIFACT_LIST = [
  { name: '王家の印章',         typeKey: 'bossPct',     typeName: 'ボスダメ',       val: 25,  unit: '%',  desc: 'ボスへのダメージ +25%' },
  { name: '竜牙の護符',         typeKey: 'regen',       typeName: '持続回復(秒)',   val: 2,   unit: 'HP', desc: '毎秒 HP+2 回復' },
  { name: '深淵の眼',           typeKey: 'crisisAtk',   typeName: 'ピンチ時攻撃力', val: 30,  unit: '%',  desc: 'HP30%以下で攻撃力 +30%' },
  { name: '古王の王冠',         typeKey: 'hpPct',       typeName: '最大HP',         val: 20,  unit: '%',  desc: '最大HP +20%' },
  { name: '狂戦士の血石',       typeKey: 'atkPct',      typeName: '基礎攻撃力',     val: 15,  unit: '%',  desc: '攻撃力 +15%' },
  { name: '時の砂時計',         typeKey: 'cdPct',       typeName: 'スキル短縮',     val: 15,  unit: '%',  desc: '武器スキルCD -15%' },
  { name: '巨神の心臓',         typeKey: 'hpFlat',      typeName: '固定HP',         val: 500, unit: '',   desc: '基礎最大HP +500' },
  { name: '守護者の盾紋章',     typeKey: 'dmgCut',      typeName: '被ダメ軽減',     val: 15,  unit: '%',  desc: '受けるダメージ -15%' },
  { name: '血塗られた短剣',     typeKey: 'bleed',       typeName: '出血蓄積',       val: 1,   unit: '層', desc: '攻撃命中ごとに出血+1層(5層で敵最大HP2.5%爆発)' },
  { name: 'ガラスの聖杯',       typeKey: 'glassCannon', typeName: '背水の呪い',     val: 100, unit: '%',  desc: '最大HPが50%になる代わりに全攻撃ダメージ +100%' },
  { name: '蒼焔の狐面',         typeKey: 'motif_mubi',    rarity: 'Legend', motifFor: 'mubi',        val: 25, unit: '%', desc: '氷結・スタン敵へダメ+25%【無尾装備時:覚醒】', awakeDesc: '✦覚醒【無尾】蒼焔ゲージ獲得2倍＆氷結・スタン敵へダメ+85%' },
  { name: '終末の黙示録',       typeKey: 'motif_apo',     rarity: 'Legend', motifFor: 'apocalypse',  val: 25, unit: '%', desc: 'スキル威力+25%【アポカリプス装備時:覚醒】', awakeDesc: '✦覚醒【アポカリプス】終末ゲージ獲得+50%＆スキル・大技ダメ+75%' },
  { name: '星界の天球儀',       typeKey: 'motif_astral',  rarity: 'Legend', motifFor: 'astral_orb',  val: 25, unit: '%', desc: '遠距離弾ダメ+25%【アストラル・オーブ装備時:覚醒】', awakeDesc: '✦覚醒【アストラル】通常攻撃が3WAY化＆Qビットのゲージ消費ゼロ' },
  { name: 'クロノスの懐中時計', typeKey: 'motif_chronos', rarity: 'Legend', motifFor: 'chronos_bow', val: 25, unit: '%', desc: 'スキルCD-25%【クロノス・ボウ装備時:覚醒】', awakeDesc: '✦覚醒【クロノス・ボウ】刻限ゲージ+50%＆遠距離狙撃倍率が最大2.5倍化' }
];

export const ARTIFACT_SYNERGIES = [
  { id: 'immortal_king',     name: '【不死の古王】',         keys: ['hpPct', 'regen'],          desc: '毎秒回復量がさらに+1%最大HP分増加＆被ダメ-10%' },
  { id: 'abyss_berserker',   name: '【背水の狂戦士】',       keys: ['crisisAtk', 'atkPct'],     desc: 'ピンチ時攻撃力補正が+60%に倍増＆HP50%以下から発動' },
  { id: 'god_slayer',        name: '【神殺しの覇道】',       keys: ['bossPct', 'atkPct'],       desc: 'ボスへのダメージがさらに+35%（合計+75%）' },
  { id: 'chronos_overdrive', name: '【時空超越】',           keys: ['cdPct', 'bossPct'],        desc: 'スキルCDがさらに-15%（合計-30%）＆ExSゲージ回収+25%' },
  { id: 'colossus_heart',    name: '【巨神の生命】',         keys: ['hpFlat', 'hpPct'],         desc: '最大HPさらに+25%＆被弾無敵延長' },
  { id: 'absolute_aegis',    name: '【絶対防衛線】',         keys: ['dmgCut', 'regen'],         desc: '被ダメさらに-15%＆HP50%以下で回復2倍' },
  { id: 'crimson_harvest',   name: '【紅蓮の血祭り】',       keys: ['bleed', 'atkPct'],         desc: '出血爆発が4層で発動＆出血爆発のたびにHP2%回復' },
  { id: 'glass_god',         name: '【死線の超神】',         keys: ['glassCannon', 'crisisAtk'],desc: 'ガラスの聖杯装備中、常にピンチ状態扱い（攻撃力さらに+50%）' },
  { id: 'awake_mubi',        name: '✦覚醒【霜月・無尾の極意】', keys: ['motif_mubi'],    reqWeapon: 'mubi',        desc: '蒼焔ゲージ獲得量2倍＆凍結中の敵に与えるダメージ+60%' },
  { id: 'awake_apo',         name: '✦覚醒【終焉の代行者】',     keys: ['motif_apo'],     reqWeapon: 'apocalypse',  desc: '終末ゲージ獲得量+50%＆メテオ・奥義のダメージ+50%' },
  { id: 'awake_astral',      name: '✦覚醒【星界の支配者】',     keys: ['motif_astral'],  reqWeapon: 'astral_orb',  desc: 'Qスキル【ビット】のゲージ消費がゼロになり、弾数が3発に増加' },
  { id: 'awake_chronos',     name: '✦覚醒【永遠の刻限】',       keys: ['motif_chronos'], reqWeapon: 'chronos_bow', desc: '刻限ゲージ獲得量+50%＆距離補正の最大倍率が1.6倍→2.5倍に強化' }
];

// ワールドトリガー再現：開発室倉庫用トリガー一覧（重複でLvUP）
export const TRIGGER_LIST = {
  // --- 通常攻撃枠（normal: 3種類） ---
  kogetsu: {
    id: 'kogetsu', slotType: 'normal', name: '弧月',
    cd: 300, cost: 0,
    desc: '素早い3段斬撃コンボ（消費トリオン: 0 / LvUPで威力+15%）'
  },
  asteroid: {
    id: 'asteroid', slotType: 'normal', name: 'アステロイド',
    cd: 340, cost: 10,
    desc: 'トリオン弾を3連射する標準射手トリガー（消費トリオン: 10 / LvUPで威力+15%）'
  },
  raygust: {
    id: 'raygust', slotType: 'normal', name: 'レイガスト',
    cd: 420, cost: 5,
    desc: '広範囲を薙ぎ払い敵弾をかき消す重厚ブレード（消費トリオン: 5 / LvUPで威力+15%）'
  },

  // --- スキル枠（skill: E / Q / 1 / 2 / 3 に重複セット可） ---
  viper: {
    id: 'viper', slotType: 'skill', name: 'バイパー',
    cd: 3800, cost: 50,
    desc: '大きく蛇行しながら死角から追尾する変化軌道弾（消費: 50）'
  },
  hound: {
    id: 'hound', slotType: 'skill', name: 'ハウンド',
    cd: 3500, cost: 75,
    desc: '敵を執拗に追尾する誘導弾を一斉発射（消費: 75）'
  },
  meteora: {
    id: 'meteora', slotType: 'skill', name: 'メテオラ',
    cd: 4800, cost: 100,
    desc: '着弾地点で大爆発を起こし周囲を吹き飛ばす炸裂弾（消費: 100）'
  },
  senku: {
    id: 'senku', slotType: 'skill', name: '旋空弧月',
    cd: 4200, cost: 100,
    desc: '刀身を伸ばし前方の敵と障害物を薙ぎ払う長距離貫通斬撃波（消費: 100）'
  },
  grasshopper: {
    id: 'grasshopper', slotType: 'skill', name: 'グラスホッパー',
    cd: 1500, cost: 10,
    desc: '緑の反発パッドを生成し入力方向（未入力時は上空）へ高速跳躍（消費: 10）'
  },
  escudo: {
    id: 'escudo', slotType: 'skill', name: 'エスクード',
    cd: 5500, cost: 75,
    desc: '前方に破壊可能な盾壁を3枚せり上げ敵の突進やレーザーを遮蔽（消費: 75）'
  },
  shield: {
    id: 'shield', slotType: 'skill', name: 'シールド',
    cd: 5000, cost: 10,
    desc: '3秒間全身にトリオン障壁を展開し被ダメ大幅軽減（消費: 10 / LvUPで軽減率UP）'
  },
  teleporter: {
    id: 'teleporter', slotType: 'skill', name: 'テレポーター',
    cd: 3200, cost: 150,
    desc: '視線・入力方向へ障害物をすり抜けて瞬間移動（消費: 150）'
  },
  radar: {
    id: 'radar', slotType: 'skill', name: 'レーダー',
    cd: 8000, cost: 5,
    desc: '8秒間攻撃力UP＆全フロアの敵・宝箱・罠をミニマップに完全探知（消費: 5）'
  },

  // --- EXS / 必殺枠（exs: ZキーでExSゲージ100%消費） ---
  ibis: {
    id: 'ibis', slotType: 'exs', name: 'アイビス',
    cd: 1000, cost: 150,
    desc: '【EXS】超威力・壁＆敵貫通の狙撃砲撃＋着弾大爆発（ExS100% + トリオン150）'
  },
  full_attack: {
    id: 'full_attack', slotType: 'exs', name: 'フルアタック',
    cd: 1000, cost: 300,
    desc: '【EXS】E/Q/1/2/3にセット中の全スキルトリガーをノータイム一斉同時発動（ExS100% + トリオン300）'
  }
};
