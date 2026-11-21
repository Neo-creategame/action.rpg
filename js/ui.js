import {
  POTION_DEF, TOWN_INN_COST, SHOP, SMITH, ARMOR_TYPES, SLOT_KEYS,
  EXS_LIST, isLegendWeapon, isRestrictedLegend, expNeed
} from './data.js';
import {
  state, SAVE, PLAYER, POTIONS, EQUIPPED, ARTIFACTS, BACKPACK, STORAGE,
  unlockedArtifactSlots, equippedArtifacts, activeSynergies, maxHp, atkTotal,
  armorStats, plus, armorLabel, addToPack, spendGold, saveGame,
  rollWeapon, rollArmor, randomSlot, rollArtifact, rollLegendArtifact, createPotion
} from './save.js';

export class UIManager {
  constructor(player, world, enemyManager, onToast) {
    this.player = player;
    this.world = world;
    this.enemyManager = enemyManager;
    this.onToast = onToast || (() => {});

    this.activeModal = null; // null | 'bag' | 'town'
    this.townTab = 'inn';    // 'inn' | 'shop' | 'smith' | 'storage' | 'gacha' | 'exs'
    this.selectedPackIdx = -1;

    // ミニマップ探索履歴（ワールド座標を2m単位で記録）
    this.exploredSet = new Set();
    this.lastFloor = -1;

    this.modalOverlay = document.getElementById('modal-overlay');
    this.modalTitle = document.getElementById('modal-title');
    this.modalBody = document.getElementById('modal-body');
    this.minimapCanvas = document.getElementById('minimap-canvas');
    this.minimapCtx = this.minimapCanvas ? this.minimapCanvas.getContext('2d') : null;

    this.bindEvents();
  }

  bindEvents() {
    document.getElementById('modal-close')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btn-open-bag')?.addEventListener('click', () => this.toggleModal('bag'));
    document.getElementById('btn-open-town')?.addEventListener('click', () => this.toggleModal('town'));

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyI') {
        e.preventDefault();
        this.toggleModal('bag');
      } else if (e.code === 'KeyT') {
        e.preventDefault();
        this.toggleModal('town');
      } else if (e.code === 'Escape' && this.activeModal) {
        this.closeModal();
      } else if (e.code === 'KeyR') {
        this.usePotionKind('small');
      } else if (e.code === 'KeyV') {
        this.usePotionKind('full');
      }
    });
  }

  isOpen() {
    return this.activeModal !== null;
  }

  toggleModal(type) {
    if (this.activeModal === type) {
      this.closeModal();
    } else {
      this.openModal(type);
    }
  }

  openModal(type) {
    this.activeModal = type;
    this.selectedPackIdx = -1;
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.modalOverlay.classList.remove('hidden');
    this.render();
  }

  closeModal() {
    this.activeModal = null;
    this.modalOverlay.classList.add('hidden');
    saveGame();
  }

  // ---- ポーション使用 ----
  usePotionKind(kind) {
    const def = POTION_DEF[kind];
    if (!def) return;

    // バッグ内のポーション優先、なければストック消費
    let used = false;
    for (let i = 0; i < BACKPACK.length; i++) {
      const it = BACKPACK[i];
      if (it && it.slot === 'potion' && it.kind === kind) {
        it.stack--;
        if (it.stack <= 0) BACKPACK[i] = null;
        used = true;
        break;
      }
    }
    if (!used && POTIONS[kind] > 0) {
      POTIONS[kind]--;
      used = true;
    }
    if (!used) {
      this.onToast(`${def.name}がありません`);
      return;
    }

    const mHp = maxHp();
    const heal = Math.round(mHp * def.pct);
    this.player.hp = Math.min(mHp, this.player.hp + heal);
    this.onToast(`💚 ${def.name}使用！ HP +${heal}`);
    saveGame();
    if (this.activeModal) this.render();
  }

  // ---- アイテム売却価格計算 ----
  calcSellPrice(it) {
    if (!it) return 0;
    if (it.slot === 'potion') return Math.round(POTION_DEF[it.kind].price * 0.4 * (it.stack || 1));
    if (it.slot === 'weapon') return Math.max(10, Math.round(it.atk * SHOP.sellPerAtk * (1 + (it.lv || 0) * 0.2)));
    if (it.slot === 'artifact') return Math.max(30, Math.round((it.val || 10) * SHOP.sellPerArtifactPct));
    return Math.max(10, Math.round(((it.hp || 10) + (it.red || 0.01) * 500) * SHOP.sellPerArmor * (1 + (it.lv || 0) * 0.2)));
  }

  // ---- メイン描画ディスパッチ ----
  render() {
    if (!this.activeModal) return;
    if (this.activeModal === 'bag') {
      this.modalTitle.textContent = '🎒 バッグ・装備・ステータス [I]';
      this.renderBagScreen();
    } else if (this.activeModal === 'town') {
      this.modalTitle.textContent = '🏰 始まりの町（拠点メニュー） [T]';
      this.renderTownScreen();
    }
  }

  // ==========================================
  // 1. バッグ・装備・ステータス画面
  // ==========================================
  renderBagScreen() {
    const mHp = maxHp();
    const arm = armorStats();
    const syns = activeSynergies();
    const artSlots = unlockedArtifactSlots();

    const itemTitle = (it) => {
      if (!it) return 'なし';
      if (it.slot === 'weapon') return `${it.name}${plus(it)} (ATK:${it.atk})`;
      if (it.slot === 'artifact') return `${it.name} [${it.desc}]`;
      if (it.slot === 'potion') return `${it.name} ×${it.stack}`;
      return armorLabel(it);
    };

    let html = `
      <div class="ui-grid-2">
        <!-- 左カラム：ステータス＆装備中 -->
        <div class="ui-card">
          <h3>📊 ステータス (残りPt: <b class="gold">${PLAYER.pts}</b>)</h3>
          <div class="stat-lines">
            <div>Lv.<b>${PLAYER.lv}</b> (EXP: ${PLAYER.exp} / ${expNeed(PLAYER.lv)})</div>
            <div>最大HP: <b>${mHp}</b> (現在: ${Math.ceil(this.player.hp)})
              ${PLAYER.pts > 0 ? `<button class="mini-btn" data-act="add-hp">+1Pt (HP+10)</button>` : ''}
            </div>
            <div>総合攻撃力: <b>${atkTotal(this.player.hp)}</b>
              ${PLAYER.pts > 0 ? `<button class="mini-btn" data-act="add-atk">+1Pt (ATK+5)</button>` : ''}
            </div>
            <div>ダメージ軽減: <b>${(arm.red * 100).toFixed(1)}%</b> / 所持金: <b class="gold">${PLAYER.gold.toLocaleString()}G</b></div>
          </div>

          <h3 style="margin-top:12px;">⚔️ 装備スロット（クリックで外す）</h3>
          <div class="equip-list">
            <div class="equip-row"><span>メイン武器:</span> <b>${itemTitle(state.weapon)}</b></div>
            <div class="equip-row"><span>サブ武器:</span>
              <span>${itemTitle(EQUIPPED.sub_weapon)}</span>
              ${EQUIPPED.sub_weapon ? `<button class="mini-btn" data-act="unequip" data-slot="sub_weapon">外す</button>` : ''}
            </div>
            ${SLOT_KEYS.map((k) => `
              <div class="equip-row">
                <span>${ARMOR_TYPES[k].slot}:</span>
                <span>${itemTitle(EQUIPPED[k])}</span>
                ${EQUIPPED[k] ? `<button class="mini-btn" data-act="unequip" data-slot="${k}">外す</button>` : ''}
              </div>
            `).join('')}
          </div>

          <h3 style="margin-top:12px;">🔮 遺物スロット (${artSlots}/3枠解放)</h3>
          <div class="equip-list">
            ${[0, 1, 2].map((idx) => {
              if (idx >= artSlots) return `<div class="equip-row muted">枠${idx + 1}: 🔒 ${idx === 1 ? '100F' : '250F'}踏破で解放</div>`;
              const art = ARTIFACTS[idx];
              return `<div class="equip-row">
                <span>枠${idx + 1}:</span>
                <span>${art ? art.name : '空き'}</span>
                ${art ? `<button class="mini-btn" data-act="unequip-art" data-idx="${idx}">外す</button>` : ''}
              </div>`;
            }).join('')}
          </div>
          ${syns.length > 0 ? `
            <div class="synergy-box">
              <b>✨ 発動中の共鳴シナジー:</b>
              ${syns.map((s) => `<div>${s.name} - ${s.desc}</div>`).join('')}
            </div>
          ` : ''}
        </div>

        <!-- 右カラム：バッグ一覧 -->
        <div class="ui-card">
          <h3>🎒 バッグ (${BACKPACK.filter(Boolean).length} / ${BACKPACK.length})</h3>
          <div class="pack-grid">
            ${BACKPACK.map((it, idx) => {
              if (!it) return `<div class="pack-cell empty">空き</div>`;
              const sel = this.selectedPackIdx === idx ? 'selected' : '';
              const rarityCls = it.isLegend || it.rarity === 'Legend' ? 'legend' : it.isBossItem ? 'boss' : '';
              const label = it.slot === 'weapon' ? `${it.name}${plus(it)}<br><small>ATK ${it.atk}</small>`
                          : it.slot === 'potion' ? `${it.name}<br><small>×${it.stack}</small>`
                          : it.slot === 'artifact' ? `${it.name}<br><small>${it.typeName}</small>`
                          : `${it.label}${plus(it)}<br><small>HP+${it.hp}</small>`;
              return `<div class="pack-cell ${sel} ${rarityCls}" data-pack="${idx}">${label}</div>`;
            }).join('')}
          </div>

          <div class="detail-panel">
            ${this.renderSelectedItemDetail()}
          </div>
        </div>
      </div>
    `;

    this.modalBody.innerHTML = html;
    this.bindBagEvents();
  }

  renderSelectedItemDetail() {
    const it = BACKPACK[this.selectedPackIdx];
    if (!it) return `<div class="muted">バッグ内のアイテムをクリックして選択してください</div>`;

    const sellPrice = this.calcSellPrice(it);
    let desc = '';
    if (it.slot === 'weapon') desc = `${it.name}${plus(it)} | 攻撃力: ${it.atk} | 耐久: ${it.isLegend ? '∞' : `${it.dur}/${it.durMax}`} | スキル: ${it.skill?.name || '-'}`;
    else if (it.slot === 'artifact') desc = `${it.name} | ${it.desc}`;
    else if (it.slot === 'potion') desc = `${it.name} (所持: ${it.stack}個) | 最大HPの${Math.round(it.pct * 100)}%回復`;
    else desc = `${armorLabel(it)} | 耐久: ${it.dur}/${it.durMax}`;

    return `
      <div class="detail-text">${desc}</div>
      <div class="detail-actions">
        ${it.slot === 'potion' ? `<button class="act-btn primary" data-act="use-item">使う</button>` : `<button class="act-btn primary" data-act="equip-item">装備する</button>`}
        ${it.slot === 'weapon' && !isRestrictedLegend(it) ? `<button class="act-btn" data-act="equip-sub">サブに装備</button>` : ''}
        <button class="act-btn" data-act="to-storage">倉庫へ送る</button>
        ${!isRestrictedLegend(it) ? `<button class="act-btn danger" data-act="sell-item">売却 (+${sellPrice}G)</button>` : ''}
      </div>
    `;
  }

  bindBagEvents() {
    this.modalBody.querySelectorAll('[data-pack]').forEach((el) => {
      el.addEventListener('click', () => {
        this.selectedPackIdx = Number(el.dataset.pack);
        this.render();
      });
    });

    this.modalBody.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'add-hp' && PLAYER.pts > 0) {
          PLAYER.pts--;
          PLAYER.hpPts++;
          this.player.hp += 10;
        } else if (act === 'add-atk' && PLAYER.pts > 0) {
          PLAYER.pts--;
          PLAYER.atkPts++;
        } else if (act === 'unequip') {
          const sl = btn.dataset.slot;
          if (EQUIPPED[sl] && addToPack(EQUIPPED[sl])) EQUIPPED[sl] = null;
          else this.onToast('バッグがいっぱいです');
        } else if (act === 'unequip-art') {
          const idx = Number(btn.dataset.idx);
          if (ARTIFACTS[idx] && addToPack(ARTIFACTS[idx])) ARTIFACTS[idx] = null;
          else this.onToast('バッグがいっぱいです');
        } else if (act === 'use-item') {
          const it = BACKPACK[this.selectedPackIdx];
          if (it && it.slot === 'potion') this.usePotionKind(it.kind);
        } else if (act === 'equip-item') {
          this.equipFromPack(this.selectedPackIdx, false);
        } else if (act === 'equip-sub') {
          this.equipFromPack(this.selectedPackIdx, true);
        } else if (act === 'to-storage') {
          const it = BACKPACK[this.selectedPackIdx];
          const emptyIdx = STORAGE.indexOf(null);
          if (it && emptyIdx >= 0) {
            STORAGE[emptyIdx] = it;
            BACKPACK[this.selectedPackIdx] = null;
            this.selectedPackIdx = -1;
            this.onToast('倉庫へ送りました');
          } else {
            this.onToast('倉庫がいっぱいです');
          }
        } else if (act === 'sell-item') {
          const it = BACKPACK[this.selectedPackIdx];
          if (it && !isRestrictedLegend(it)) {
            const gain = this.calcSellPrice(it);
            PLAYER.gold += gain;
            BACKPACK[this.selectedPackIdx] = null;
            this.selectedPackIdx = -1;
            this.onToast(`💰 売却完了 +${gain}G`);
          }
        }
        saveGame();
        this.render();
      });
    });
  }

  equipFromPack(idx, toSub = false) {
    const it = BACKPACK[idx];
    if (!it) return;

    if (it.slot === 'weapon') {
      if (toSub) {
        if (isRestrictedLegend(state.weapon) || isRestrictedLegend(it)) {
          return this.onToast('Legend武器はサブ装備不可');
        }
        const prev = EQUIPPED.sub_weapon;
        EQUIPPED.sub_weapon = it;
        BACKPACK[idx] = prev;
      } else {
        const prev = state.weapon;
        state.weapon = it;
        BACKPACK[idx] = prev;
        if (isRestrictedLegend(it) && EQUIPPED.sub_weapon) {
          addToPack(EQUIPPED.sub_weapon);
          EQUIPPED.sub_weapon = null;
        }
        this.player.syncWeaponVisual();
      }
      this.onToast(`⚔️ ${it.name} を装備しました`);
    } else if (it.slot === 'artifact') {
      const slots = unlockedArtifactSlots();
      let targetIdx = ARTIFACTS.slice(0, slots).indexOf(null);
      if (targetIdx < 0) targetIdx = 0;
      const prev = ARTIFACTS[targetIdx];
      ARTIFACTS[targetIdx] = it;
      BACKPACK[idx] = prev;
      this.onToast(`🔮 遺物【${it.name}】を装着`);
    } else if (SLOT_KEYS.includes(it.slot)) {
      const prev = EQUIPPED[it.slot];
      EQUIPPED[it.slot] = it;
      BACKPACK[idx] = prev;
      this.onToast(`🛡️ ${it.label} を装備`);
    }
    this.selectedPackIdx = -1;
  }

  // ==========================================
  // 2. 町（拠点）メニュー画面
  // ==========================================
  renderTownScreen() {
    const tabs = [
      { id: 'inn',     label: '🏨 宿屋' },
      { id: 'shop',    label: '🛒 ショップ' },
      { id: 'smith',   label: '🔨 鍛冶屋' },
      { id: 'storage', label: '📦 倉庫' },
      { id: 'gacha',   label: '🎰 ガチャ' },
      { id: 'exs',     label: '⚡ ExS変更' }
    ];

    let contentHtml = '';
    if (this.townTab === 'inn') contentHtml = this.renderInnTab();
    else if (this.townTab === 'shop') contentHtml = this.renderShopTab();
    else if (this.townTab === 'smith') contentHtml = this.renderSmithTab();
    else if (this.townTab === 'storage') contentHtml = this.renderStorageTab();
    else if (this.townTab === 'gacha') contentHtml = this.renderGachaTab();
    else if (this.townTab === 'exs') contentHtml = this.renderExsTab();

    this.modalBody.innerHTML = `
      <div class="town-header">
        <div class="tab-bar">
          ${tabs.map((t) => `<button class="tab-btn ${this.townTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </div>
        <div class="gold-disp">所持金: <b class="gold">${PLAYER.gold.toLocaleString()}G</b></div>
      </div>
      <div class="town-content">${contentHtml}</div>
    `;

    this.modalBody.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.townTab = btn.dataset.tab;
        this.render();
      });
    });

    this.bindTownEvents();
  }

  renderInnTab() {
    return `
      <div class="ui-card center-card">
        <h3>🏨 冒険者の宿屋</h3>
        <p>HPを全回復し、装備中の武器・防具の耐久度を全回復します。</p>
        <p>現在HP: <b>${Math.ceil(this.player.hp)} / ${maxHp()}</b></p>
        <button class="act-btn primary" data-town="inn-rest">宿泊する (${TOWN_INN_COST}G)</button>
      </div>
    `;
  }

  renderShopTab() {
    const floor = Math.max(1, SAVE.cleared + 1);
    return `
      <div class="ui-card">
        <h3>🛒 道具・装備ショップ</h3>
        <div class="shop-list">
          <div class="shop-row">
            <span>小回復ポーション (HP25%回復)</span>
            <button class="act-btn primary" data-town="buy-pot-small">購入 (${POTION_DEF.small.price}G)</button>
          </div>
          <div class="shop-row">
            <span>全回復ポーション (HP100%回復)</span>
            <button class="act-btn primary" data-town="buy-pot-full">購入 (${POTION_DEF.full.price}G)</button>
          </div>
          <div class="shop-row">
            <span>ランダム武器ボックス (${floor}F相当)</span>
            <button class="act-btn primary" data-town="buy-wep">購入 (${300 * floor}G)</button>
          </div>
          <div class="shop-row">
            <span>ランダム防具ボックス (${floor}F相当)</span>
            <button class="act-btn primary" data-town="buy-arm">購入 (${250 * floor}G)</button>
          </div>
        </div>
      </div>
    `;
  }

  renderSmithTab() {
    const targets = [
      { key: 'main', label: 'メイン武器', item: state.weapon },
      { key: 'sub',  label: 'サブ武器',   item: EQUIPPED.sub_weapon },
      ...SLOT_KEYS.map((k) => ({ key: k, label: ARMOR_TYPES[k].slot, item: EQUIPPED[k] }))
    ].filter((t) => t.item);

    return `
      <div class="ui-card">
        <h3>🔨 鍛冶屋（修理＆強化 +1〜+5）</h3>
        <div class="shop-list">
          ${targets.map((t) => {
            const it = t.item;
            const miss = it.isLegend ? 0 : (it.durMax - it.dur);
            const repCost = Math.ceil(miss * SMITH.repairPerPt * (it.slot === 'weapon' ? SMITH.weaponRepairMult : 1));
            const canUp = (it.lv || 0) < SMITH.upMax;
            const upCost = Math.round(SMITH.upBase * Math.pow(SMITH.upGrowth, it.lv || 0) * (it.slot === 'weapon' ? SMITH.weaponUpMult : 1));
            const name = it.slot === 'weapon' ? `${it.name}${plus(it)} (ATK:${it.atk})` : armorLabel(it);
            return `
              <div class="shop-row">
                <span>[${t.label}] <b>${name}</b> <small>(耐久:${it.isLegend ? '∞' : `${it.dur}/${it.durMax}`})</small></span>
                <div>
                  ${miss > 0 ? `<button class="mini-btn" data-town="repair" data-target="${t.key}" data-cost="${repCost}">修理(${repCost}G)</button>` : ''}
                  ${canUp ? `<button class="mini-btn primary" data-town="upgrade" data-target="${t.key}" data-cost="${upCost}">強化(${upCost}G)</button>` : '<span class="muted">MAX</span>'}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  renderStorageTab() {
    return `
      <div class="ui-card">
        <h3>📦 倉庫（クリックでバッグへ取り出し）</h3>
        <div class="pack-grid">
          ${STORAGE.map((it, idx) => {
            if (!it) return `<div class="pack-cell empty">空き</div>`;
            const name = it.slot === 'weapon' ? `${it.name}${plus(it)}` : it.slot === 'artifact' ? it.name : it.slot === 'potion' ? `${it.name}×${it.stack}` : `${it.label}${plus(it)}`;
            return `<div class="pack-cell" data-town="take-storage" data-idx="${idx}">${name}</div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  renderGachaTab() {
    return `
      <div class="ui-card center-card">
        <h3>🎰 異界の召喚ガチャ</h3>
        <p>Legend武器（無尾・アポカリプス・アストラル・クロノス・インフェルノ）や専用モチーフ遺物、ExSスキルが出現！</p>
        <div style="display:flex; gap:12px; justify-content:center; margin-top:14px;">
          <button class="act-btn primary" data-town="gacha-1">1回召喚 (1,000G)</button>
          <button class="act-btn primary" data-town="gacha-5">5連召喚 (4,500G)</button>
        </div>
      </div>
    `;
  }

  renderExsTab() {
    if (isRestrictedLegend(state.weapon)) {
      return `<div class="ui-card center-card"><p>「${state.weapon.name}」装備中は固有奥義が優先されるためExSは変更できません。</p></div>`;
    }
    return `
      <div class="ui-card">
        <h3>⚡ ExS（終結スキル）装備変更 [Zキー]</h3>
        <div class="shop-list">
          ${Object.values(EXS_LIST).map((exs) => {
            const owned = !!state.ownedExs[exs.id];
            const equipped = state.equippedExsId === exs.id;
            return `
              <div class="shop-row">
                <div>
                  <b>[${exs.rarity}] ${exs.name}</b>
                  <div style="font-size:11px; color:#a0aec0;">${exs.desc}</div>
                </div>
                <div>
                  ${!owned ? '<span class="muted">未所持(ガチャで獲得)</span>' : equipped ? '<b style="color:#00ffff;">装備中</b>' : `<button class="act-btn primary" data-town="equip-exs" data-id="${exs.id}">装備</button>`}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  bindTownEvents() {
    this.modalBody.querySelectorAll('[data-town]').forEach((el) => {
      el.addEventListener('click', () => {
        const act = el.dataset.town;
        const floor = Math.max(1, SAVE.cleared + 1);

        if (act === 'inn-rest') {
          if (!spendGold(TOWN_INN_COST)) return this.onToast('ゴールド不足です');
          this.player.hp = maxHp();
          [state.weapon, EQUIPPED.sub_weapon, ...Object.values(EQUIPPED)].forEach((it) => {
            if (it && !it.isLegend) it.dur = it.durMax;
          });
          this.onToast('🏨 HPと装備耐久が全回復しました！');
        } else if (act === 'buy-pot-small') {
          if (!spendGold(POTION_DEF.small.price)) return this.onToast('ゴールド不足です');
          if (!addToPack(createPotion('small', 1))) POTIONS.small++;
          this.onToast('小回復ポーションを購入しました');
        } else if (act === 'buy-pot-full') {
          if (!spendGold(POTION_DEF.full.price)) return this.onToast('ゴールド不足です');
          if (!addToPack(createPotion('full', 1))) POTIONS.full++;
          this.onToast('全回復ポーションを購入しました');
        } else if (act === 'buy-wep') {
          const cost = 300 * floor;
          if (!spendGold(cost)) return this.onToast('ゴールド不足です');
          const types = ['sword', 'dual', 'bow', 'greatsword', 'spear'];
          const w = rollWeapon(types[Math.floor(Math.random() * types.length)], floor);
          if (addToPack(w)) this.onToast(`⚔️ ${w.name} を入手！`);
          else { PLAYER.gold += cost; this.onToast('バッグがいっぱいです'); }
        } else if (act === 'buy-arm') {
          const cost = 250 * floor;
          if (!spendGold(cost)) return this.onToast('ゴールド不足です');
          const a = rollArmor(randomSlot(), floor);
          if (addToPack(a)) this.onToast(`🛡️ ${a.label} を入手！`);
          else { PLAYER.gold += cost; this.onToast('バッグがいっぱいです'); }
        } else if (act === 'repair' || act === 'upgrade') {
          const tKey = el.dataset.target;
          const cost = Number(el.dataset.cost);
          const it = tKey === 'main' ? state.weapon : tKey === 'sub' ? EQUIPPED.sub_weapon : EQUIPPED[tKey];
          if (!it || !spendGold(cost)) return this.onToast('ゴールド不足です');
          if (act === 'repair') {
            it.dur = it.durMax;
            this.onToast('🔨 修理完了！');
          } else {
            it.lv = (it.lv || 0) + 1;
            if (it.slot === 'weapon') it.atk = Math.round(it.atk * (1 + SMITH.upStep));
            else {
              it.hp = Math.round(it.hp * (1 + SMITH.upStep));
              it.red = Math.round(it.red * (1 + SMITH.upStep) * 1000) / 1000;
            }
            this.onToast(`✨ ${it.name || it.label} が +${it.lv} に強化された！`);
          }
        } else if (act === 'take-storage') {
          const idx = Number(el.dataset.idx);
          const it = STORAGE[idx];
          if (it && addToPack(it)) {
            STORAGE[idx] = null;
            this.onToast('バッグへ取り出しました');
          } else {
            this.onToast('バッグがいっぱいです');
          }
        } else if (act === 'gacha-1' || act === 'gacha-5') {
          const count = act === 'gacha-5' ? 5 : 1;
          const cost = act === 'gacha-5' ? 4500 : 1000;
          if (!spendGold(cost)) return this.onToast('ゴールド不足です');
          this.runGacha(count, floor);
        } else if (act === 'equip-exs') {
          state.equippedExsId = el.dataset.id;
          this.onToast(`⚡ ExS【${EXS_LIST[state.equippedExsId].name}】を装備！`);
        }

        saveGame();
        this.render();
      });
    });
  }

  runGacha(count, floor) {
    const results = [];
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      if (r < 0.12) {
        const legs = ['mubi', 'apocalypse', 'astral_orb', 'chronos_bow', 'inferno_scythe'];
        const w = rollWeapon(legs[Math.floor(Math.random() * legs.length)], floor);
        addToPack(w);
        results.push(`★Legend武器【${w.name}】`);
      } else if (r < 0.25) {
        const motifs = ['motif_mubi', 'motif_apo', 'motif_astral', 'motif_chronos'];
        const art = rollLegendArtifact(motifs[Math.floor(Math.random() * motifs.length)]);
        if (art) { addToPack(art); results.push(`★モチーフ遺物【${art.name}】`); }
      } else if (r < 0.40) {
        const exsKeys = Object.keys(EXS_LIST);
        const pick = exsKeys[Math.floor(Math.random() * exsKeys.length)];
        state.ownedExs[pick] = 1;
        results.push(`⚡ExS【${EXS_LIST[pick].name}】`);
      } else if (r < 0.70) {
        const art = rollArtifact();
        addToPack(art);
        results.push(`🔮遺物【${art.name}】`);
      } else {
        const pot = createPotion('full', 1);
        addToPack(pot);
        results.push('🧪全回復ポーション');
      }
    }
    this.onToast(`🎰 召喚結果: ${results.join(' / ')}`);
  }

  // ==========================================
  // 3. 右上ミニマップ（探索レーダー）更新
  // ==========================================
  updateMinimap(currentFloor) {
    if (!this.minimapCtx) return;
    if (this.lastFloor !== currentFloor) {
      this.exploredSet.clear();
      this.lastFloor = currentFloor;
    }

    const pPos = this.player.root.position;
    const gx = Math.round(pPos.x / 3);
    const gz = Math.round(pPos.z / 3);
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        this.exploredSet.add(`${gx + dx},${gz + dz}`);
      }
    }

    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const scale = 2.4; // 1m = 2.4px
    const cx = w / 2;
    const cy = h / 2;

    // 探索済み床
    ctx.fillStyle = 'rgba(45, 55, 72, 0.7)';
    for (const key of this.exploredSet) {
      const [ex, ez] = key.split(',').map(Number);
      const sx = cx + (ex * 3 - pPos.x) * scale;
      const sy = cy + (ez * 3 - pPos.z) * scale;
      if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
      ctx.fillRect(sx - 3.5, sy - 3.5, 7, 7);
    }

    // 周囲の壁
    ctx.fillStyle = '#718096';
    for (const wall of this.world.walls) {
      if (wall.userData.destructible) continue;
      const sx = cx + (wall.position.x - pPos.x) * scale;
      const sy = cy + (wall.position.z - pPos.z) * scale;
      if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
      ctx.fillRect(sx - 3.2, sy - 3.2, 6.4, 6.4);
    }

    // 階段ポータル（シアン）
    const px = cx + (this.world.portalPos.x - pPos.x) * scale;
    const py = cy + (this.world.portalPos.z - pPos.z) * scale;
    ctx.fillStyle = this.world.portalLocked ? '#ff2244' : '#00ffff';
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // 敵（赤点）
    for (const e of this.enemyManager.enemies) {
      const ex = cx + (e.root.position.x - pPos.x) * scale;
      const ey = cy + (e.root.position.z - pPos.z) * scale;
      if (ex < 0 || ex > w || ey < 0 || ey > h) continue;
      ctx.fillStyle = e.isBoss ? '#ff1144' : e.isRare ? '#ffd36a' : '#f56565';
      ctx.beginPath();
      ctx.arc(ex, ey, e.isBoss ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // プレイヤー（中央白矢印）
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-this.player.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
