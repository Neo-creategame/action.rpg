import {
  POTION_DEF, TOWN_INN_COST, SHOP, SMITH, ARMOR_TYPES, SLOT_KEYS,
  EXS_LIST, TRIGGER_LIST, isLegendWeapon, isRestrictedLegend, expNeed
} from './data.js';
import {
  state, SAVE, PLAYER, POTIONS, EQUIPPED, ARTIFACTS, BACKPACK, STORAGE,
  unlockedArtifactSlots, equippedArtifacts, activeSynergies, maxHp, atkTotal,
  armorStats, plus, armorLabel, addToPack, spendGold, saveGame,
  rollWeapon, rollArmor, randomSlot, rollArtifact, rollLegendArtifact, createPotion,
  SPELLBOOK_SLOTS, STORAGE_MAX, TRIGGER_SLOTS,
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
      if (e.code === 'Tab') {
        e.preventDefault();
        this.toggleModal('pause');
      } else if (e.code === 'KeyI') {
        e.preventDefault();
        this.toggleModal('bag');
      } else if (e.code === 'Escape' && this.activeModal) {
        this.closeModal();
      } else if (e.code === 'KeyR') {
        this.usePotionKind('small');
      } else if (e.code === 'KeyV') {
        this.usePotionKind('full');
      }
    });
    window.addEventListener('open-town-tab', (e) => {
      this.townTab = e.detail || 'inn';
      this.openModal('town');
  });
  this.modalOverlay?.addEventListener('click', (e) => {
    if (e.target === this.modalOverlay) this.closeModal();
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
    try {
      document.body.requestPointerLock?.()?.catch?.(() => {});
    } catch (e) {}
  }

  // ---- ポーション使用 ----
  usePotionKind(kind) {
    if (state.weapon?.type === 'trigger_holder') {
      this.onToast('⚠️ トリオン体状態のためポーションは使用不可！');
      return;
    }
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
    if (this.activeModal === 'pause') {
      this.modalTitle.textContent = '⏸ ポーズメニュー [Tab]';
      this.renderPauseScreen();
    } else if (this.activeModal === 'bag') {
      this.modalTitle.textContent = '🎒 バッグ・装備・ステータス [I]';
      this.renderBagScreen();
    } else if (this.activeModal === 'town') {
      const titles = {
        inn: '🏨 冒険者の宿屋',
        shop: '🛒 道具・装備ショップ',
        smith: '🔨 鍛冶屋',
        storage: '📦 倉庫',
        gacha: '🎰 異界の召喚ガチャ',
        exs: '⚡ ExS（終結スキル）変更',
        magic: '📖 魔導台（スペルブック編集）',
        trigger: '💠 トリガー開発室（カスタムトリガー）',
      };
      this.modalTitle.textContent = titles[this.townTab] || '🏰 始まりの町';
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
    let contentHtml = '';
    if (this.townTab === 'inn') contentHtml = this.renderInnTab();
    else if (this.townTab === 'shop') contentHtml = this.renderShopTab();
    else if (this.townTab === 'smith') contentHtml = this.renderSmithTab();
    else if (this.townTab === 'storage') contentHtml = this.renderStorageTab();
    else if (this.townTab === 'gacha') contentHtml = this.renderGachaTab();
    else if (this.townTab === 'exs') contentHtml = this.renderExsTab();
    else if (this.townTab === 'magic') contentHtml = this.renderMagicTab();
    else if (this.townTab === 'trigger') contentHtml = this.renderTriggerTab();

    this.modalBody.innerHTML = `
      <div class="town-header" style="justify-content: flex-end;">
        <div class="gold-disp">所持金: <b class="gold">${PLAYER.gold.toLocaleString()}G</b></div>
      </div>
      <div class="town-content">${contentHtml}</div>
    `;

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
    const canExpand = STORAGE.length < STORAGE_MAX;
    const expandCost = STORAGE.length === 20 ? 10000 : STORAGE.length === 30 ? 25000 : 50000;

    return `
      <div class="ui-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h3>📦 倉庫 (${STORAGE.filter(Boolean).length} / ${STORAGE.length}枠)</h3>
          ${canExpand ? `<button class="mini-btn primary" data-town="expand-storage" data-cost="${expandCost}">+10枠拡張 (${expandCost.toLocaleString()}G)</button>` : '<span class="muted">最大拡張済み</span>'}
        </div>
        <p class="muted" style="margin-bottom:8px;">クリックでバッグへ取り出し ／ 右クリックで直接売却</p>
        <div class="pack-grid">
          ${STORAGE.map((it, idx) => {
            if (!it) return `<div class="pack-cell empty">空き</div>`;
            const name = it.slot === 'weapon' ? `${it.name}${plus(it)}` : it.slot === 'artifact' ? it.name : it.slot === 'potion' ? `${it.name}×${it.stack}` : `${it.label}${plus(it)}`;
            const sellVal = this.calcSellPrice(it);
            return `<div class="pack-cell" data-town="take-storage" data-idx="${idx}" title="右クリックで売却 (+${sellVal}G)">${name}<br><small class="gold">${sellVal}G</small></div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  renderGachaTab() {
    return `
      <div class="ui-card">
        <h3>🎰 異界の召喚ガチャ（3種の召喚台）</h3>
        <p class="muted" style="margin-bottom:12px;">
          目的に合わせて3つの召喚ガチャから選択してください（5連召喚は500Gお得）。
        </p>
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px;">
          <!-- ① 武器ガチャ -->
          <div style="background:#131720; border:1px solid #ffd36a; border-radius:8px; padding:12px; display:flex; flex-direction:column; justify-content:space-between; text-align:center;">
            <div>
              <div style="font-size:15px; font-weight:bold; color:#ffd36a; margin-bottom:6px;">⚔️ 武器召喚</div>
              <p style="font-size:11px; color:#cbd5e0; line-height:1.5;">
                Legend武器（無尾・アポカリプス・アストラル・クロノス・インフェルノ）やExSスキルが出現！
              </p>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; margin-top:12px;">
              <button class="act-btn primary" data-town="gacha" data-pool="weapon" data-count="1">1回召喚 (1,000G)</button>
              <button class="act-btn primary" data-town="gacha" data-pool="weapon" data-count="5">5連召喚 (4,500G)</button>
            </div>
          </div>

          <!-- ② モチーフ遺物ガチャ -->
          <div style="background:#131720; border:1px solid #b15cff; border-radius:8px; padding:12px; display:flex; flex-direction:column; justify-content:space-between; text-align:center;">
            <div>
              <div style="font-size:15px; font-weight:bold; color:#d6bcfa; margin-bottom:6px;">🔮 モチーフ遺物召喚</div>
              <p style="font-size:11px; color:#cbd5e0; line-height:1.5;">
                Legend武器を覚醒させる専用モチーフ遺物（蒼焔の狐面・終末の黙示録など）や各種遺物が出現！
              </p>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; margin-top:12px;">
              <button class="act-btn primary" data-town="gacha" data-pool="motif" data-count="1">1回召喚 (1,000G)</button>
              <button class="act-btn primary" data-town="gacha" data-pool="motif" data-count="5">5連召喚 (4,500G)</button>
            </div>
          </div>

          <!-- ③ トリガーガチャ -->
          <div style="background:#131720; border:1px solid #00ffff; border-radius:8px; padding:12px; display:flex; flex-direction:column; justify-content:space-between; text-align:center;">
            <div>
              <div style="font-size:15px; font-weight:bold; color:#00ffff; margin-bottom:6px;">💠 トリガー召喚</div>
              <p style="font-size:11px; color:#cbd5e0; line-height:1.5;">
                全14種のトリガー（弧月・アステロイド・アイビス・フルアタック等）が出現！重複でLvUP＆威力強化！
              </p>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; margin-top:12px;">
              <button class="act-btn primary" data-town="gacha" data-pool="trigger" data-count="1">1回召喚 (1,000G)</button>
              <button class="act-btn primary" data-town="gacha" data-pool="trigger" data-count="5">5連召喚 (4,500G)</button>
            </div>
          </div>
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

  renderMagicTab() {
    // 装備中・バッグ内の武器をピックアップ（スペルブック自身とLegend武器は対象外）
    const equipWeapons = [
      { label: 'メイン装備', item: state.weapon },
      { label: 'サブ装備',   item: EQUIPPED.sub_weapon }
    ].filter((x) => x.item && x.item.slot === 'weapon' && x.item.type !== 'spellbook' && !x.item.isLegend && x.item.skill);

    return `
      <div class="ui-grid-2">
        <!-- 左カラム：スペルブックの3スロット -->
        <div class="ui-card">
          <h3>📖 スペルブック登録スロット</h3>
          <p class="muted" style="margin-bottom:10px;">
            スペルブック装備中、[1][2][3]キーで発動します（威力50%・CD2倍）。
          </p>
          <div class="shop-list">
            ${[0, 1, 2].map((idx) => {
              const sl = SPELLBOOK_SLOTS[idx];
              return `
                <div class="shop-row">
                  <div>
                    <div><b>スロット [${idx + 1}]</b></div>
                    <div style="font-size:12px; color:${sl ? '#00ffff' : '#718096'};">
                      ${sl ? `${sl.skillName} (${sl.weaponName} / CD:${(sl.cd / 1000).toFixed(1)}s)` : '未登録'}
                    </div>
                  </div>
                  ${sl ? `<button class="mini-btn danger" data-town="sb-clear" data-idx="${idx}">解除</button>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- 右カラム：バッグ一覧（ここから直接選択して登録） -->
        <div class="ui-card">
          <h3>🎒 バッグ (${BACKPACK.filter(Boolean).length} / ${BACKPACK.length})</h3>
          <div class="pack-grid">
            ${BACKPACK.map((it, pIdx) => {
              if (!it) return `<div class="pack-cell empty">空き</div>`;
              const isValidWep = (it.slot === 'weapon' && it.type !== 'spellbook' && !it.isLegend && it.skill);
              const sel = this.selectedPackIdx === pIdx ? 'selected' : '';
              const rarityCls = it.isLegend || it.rarity === 'Legend' ? 'legend' : it.isBossItem ? 'boss' : '';
              const label = it.slot === 'weapon' ? `${it.name}${plus(it)}<br><small>${it.skill?.name || ''}</small>`
                          : it.slot === 'potion' ? `${it.name}<br><small>×${it.stack}</small>`
                          : it.slot === 'artifact' ? `${it.name}<br><small>${it.typeName}</small>`
                          : `${it.label}${plus(it)}<br><small>HP+${it.hp}</small>`;
              return `<div class="pack-cell ${sel} ${rarityCls}" style="${isValidWep ? '' : 'opacity:0.45;'}" data-town="sb-select-pack" data-pack="${pIdx}">${label}</div>`;
            }).join('')}
          </div>

          <div class="detail-panel">
            ${this.renderMagicBagDetail()}
          </div>
        </div>
      </div>
    `;
  }

  renderMagicBagDetail() {
    const it = BACKPACK[this.selectedPackIdx];
    if (!it) {
      return `<div class="muted">右のバッグからスキルを登録したい武器をクリックしてください</div>`;
    }
    if (it.slot !== 'weapon' || !it.skill) {
      return `<div class="muted">「${it.name || it.label}」は武器ではないためスキルを抽出できません</div>`;
    }
    if (it.type === 'spellbook' || it.isLegend) {
      return `<div class="muted">「${it.name}」のスキルはスペルブックに登録できません</div>`;
    }

    return `
      <div class="detail-text">
        <b>${it.name}${plus(it)}</b> ｜ 武器スキル: <b style="color:#00ffff;">${it.skill.name}</b> (スペルブック時CD: ${(it.skill.cd * 2 / 1000).toFixed(1)}秒)
      </div>
      <div class="detail-actions">
        <button class="act-btn primary" data-town="sb-set-pack" data-idx="0">スロット [1] にセット</button>
        <button class="act-btn primary" data-town="sb-set-pack" data-idx="1">スロット [2] にセット</button>
        <button class="act-btn primary" data-town="sb-set-pack" data-idx="2">スロット [3] にセット</button>
      </div>
    `;
  }

  renderTriggerTab() {
    const slotDefs = [
      { key: 'normal', label: '左クリック (通常攻撃)', accept: 'normal' },
      { key: 'skillE', label: 'E キー (メインスキル)', accept: 'skill' },
      { key: 'skillQ', label: 'Q / 右クリック (サブスキル)', accept: 'skill' },
      { key: 'opt1',   label: '1 キー (オプショナル1)', accept: 'skill' },
      { key: 'opt2',   label: '2 キー (オプショナル2)', accept: 'skill' },
      { key: 'opt3',   label: '3 キー (オプショナル3)', accept: 'skill' },
      { key: 'exs',    label: 'Z キー (EXS / 必殺)', accept: 'exs' }
    ];

    const ownedIds = Object.keys(state.ownedTriggers || {});
    if (!this.selectedTriggerId && ownedIds.length > 0) {
      this.selectedTriggerId = ownedIds[0];
    }
    const selTrig = TRIGGER_LIST[this.selectedTriggerId];
    const selLv = selTrig ? (state.ownedTriggers[selTrig.id] || 1) : 1;

    return `
      <div class="ui-grid-2">
        <!-- 左カラム：トリガーホルダー 7スロット構成 -->
        <div class="ui-card">
          <h3>💠 トリガーホルダー構成（重複セット可）</h3>
          <p class="muted" style="margin-bottom:8px;">
            装備中はHPが「TRION」となり、毎秒0.5%自然回復／回復アイテム不可。
          </p>
          <div class="shop-list">
            ${slotDefs.map((sd) => {
              const eqId = TRIGGER_SLOTS[sd.key];
              const tr = eqId ? TRIGGER_LIST[eqId] : null;
              const lv = tr ? (state.ownedTriggers[tr.id] || 1) : 0;
              return `
                <div class="shop-row">
                  <div>
                    <div style="font-size:11px; color:#a0aec0;">${sd.label}</div>
                    <div style="font-size:13px; color:${tr ? '#00ffff' : '#718096'}; font-weight:bold;">
                      ${tr ? `${tr.name} Lv.${lv}` : '未セット'}
                    </div>
                  </div>
                  ${tr ? `<button class="mini-btn danger" data-town="tr-clear" data-slot="${sd.key}">解除</button>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- 右カラム：開発室トリガー倉庫 -->
        <div class="ui-card">
          <h3>🗄️ 開発室トリガー倉庫 (${ownedIds.length} / ${Object.keys(TRIGGER_LIST).length}種)</h3>
          <div class="pack-grid" style="grid-template-columns: repeat(3, 1fr);">
            ${Object.values(TRIGGER_LIST).map((tr) => {
              const lv = state.ownedTriggers[tr.id] || 0;
              if (lv <= 0) {
                return `<div class="pack-cell empty" style="opacity:0.4;">未所持<br><small>${tr.name}</small></div>`;
              }
              const sel = this.selectedTriggerId === tr.id ? 'selected' : '';
              const badge = tr.slotType === 'normal' ? '通常' : tr.slotType === 'exs' ? 'EXS' : 'スキル';
              return `
                <div class="pack-cell ${sel}" data-town="tr-select" data-tid="${tr.id}">
                  <b>${tr.name}</b>
                  <small style="color:#ffd36a;">Lv.${lv} [${badge}]</small>
                </div>
              `;
            }).join('')}
          </div>

          <div class="detail-panel" style="margin-top:10px;">
            ${!selTrig ? `<div class="muted">所持トリガーを選択してください</div>` : `
              <div class="detail-text">
                <b>${selTrig.name} Lv.${selLv}</b>（威力補正: <b>${100 + (selLv - 1) * 20}%</b>）<br>
                <span style="font-size:11px; color:#cbd5e0;">${selTrig.desc}</span>
              </div>
              <div class="detail-actions">
                ${selTrig.slotType === 'normal' ? `
                  <button class="act-btn primary" data-town="tr-set" data-slot="normal">左クリック(通常)にセット</button>
                ` : selTrig.slotType === 'exs' ? `
                  <button class="act-btn primary" data-town="tr-set" data-slot="exs">Zキー(EXS)にセット</button>
                ` : `
                  <button class="mini-btn primary" data-town="tr-set" data-slot="skillE">Eにセット</button>
                  <button class="mini-btn primary" data-town="tr-set" data-slot="skillQ">Q/右にセット</button>
                  <button class="mini-btn primary" data-town="tr-set" data-slot="opt1">1にセット</button>
                  <button class="mini-btn primary" data-town="tr-set" data-slot="opt2">2にセット</button>
                  <button class="mini-btn primary" data-town="tr-set" data-slot="opt3">3にセット</button>
                `}
              </div>
            `}
          </div>
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
        } else if (act === 'tr-select') {
          this.selectedTriggerId = el.dataset.tid;
        } else if (act === 'tr-set') {
          const slotKey = el.dataset.slot;
          const tr = TRIGGER_LIST[this.selectedTriggerId];
          if (tr) {
            TRIGGER_SLOTS[slotKey] = tr.id;
            this.onToast(`💠 【${tr.name}】をセットしました！`);
          }
        } else if (act === 'tr-clear') {
          const slotKey = el.dataset.slot;
          TRIGGER_SLOTS[slotKey] = null;
          this.onToast('スロットを解除しました');
        } else if (act === 'take-storage') {
          const idx = Number(el.dataset.idx);
          const it = STORAGE[idx];
          if (it && addToPack(it)) {
            STORAGE[idx] = null;
            this.onToast('バッグへ取り出しました');
          } else {
            this.onToast('バッグがいっぱいです');
          }
        } else if (act === 'gacha') {
          const pool = el.dataset.pool;
          const count = Number(el.dataset.count);
          const cost = count === 5 ? 4500 : 1000;
          if (!spendGold(cost)) return this.onToast('ゴールド不足です');
          this.runGacha(pool, count, floor);
        } else if (act === 'equip-exs') {
          state.equippedExsId = el.dataset.id;
          this.onToast(`⚡ ExS【${EXS_LIST[state.equippedExsId].name}】を装備！`);
        } else if (act === 'sb-select-pack') {
          this.selectedPackIdx = Number(el.dataset.pack);
        } else if (act === 'sb-set-pack') {
          const idx = Number(el.dataset.idx);
          const src = BACKPACK[this.selectedPackIdx];
          if (src && src.skill) {
            const prevSlot = SPELLBOOK_SLOTS[idx];
            BACKPACK[this.selectedPackIdx] = prevSlot && prevSlot.weaponItem ? prevSlot.weaponItem : null;
            SPELLBOOK_SLOTS[idx] = {
              weaponType: src.type,
              weaponName: src.name,
              skillName: src.skill.name,
              cd: src.skill.cd * 2,
              weaponItem: src
            };
            this.onToast(`📖 スロット${idx + 1}に【${src.skill.name}】を登録！`);
          }
        } else if (act === 'sb-set-item') {
          const idx = Number(el.dataset.idx);
          const wType = el.dataset.wtype;
          const src = [state.weapon, EQUIPPED.sub_weapon].find((it) => it && it.type === wType);
          if (src && src.skill) {
            SPELLBOOK_SLOTS[idx] = {
              weaponType: src.type,
              weaponName: src.name,
              skillName: src.skill.name,
              cd: src.skill.cd * 2
            };
            this.onToast(`📖 スロット${idx + 1}に【${src.skill.name}】を登録！`);
          }
        } else if (act === 'sb-clear') {
          const idx = Number(el.dataset.idx);
          const sl = SPELLBOOK_SLOTS[idx];
          if (!sl) return;

          if (sl.weaponItem) {
            if (!addToPack(sl.weaponItem)) {
              return this.onToast('バッグがいっぱいで武器を戻せません！');
            }
          }
          SPELLBOOK_SLOTS[idx] = null;
          this.onToast(`📖 スロット${idx + 1}を解除し、武器をバッグに戻しました`);
        } else if (act === 'expand-storage') {
          const cost = Number(el.dataset.cost);
          if (STORAGE.length >= STORAGE_MAX) return;
          if (!spendGold(cost)) return this.onToast('ゴールド不足です');
          for (let i = 0; i < 10; i++) STORAGE.push(null);
          this.onToast(`📦 倉庫が ${STORAGE.length}枠 に拡張されました！`);
        } else if (act === 'take-storage') {
          const idx = Number(el.dataset.idx);
          const it = STORAGE[idx];
          if (it && addToPack(it)) {
            STORAGE[idx] = null;
            this.onToast('バッグへ取り出しました');
          } else {
            this.onToast('バッグがいっぱいです');
          }
        }

        saveGame();
        this.render();
      });
    });
    // 倉庫アイテムの右クリック直接売却
    this.modalBody.querySelectorAll('[data-town="take-storage"]').forEach((el) => {
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const idx = Number(el.dataset.idx);
        const it = STORAGE[idx];
        if (!it || isRestrictedLegend(it)) return this.onToast('Legend武器は売却できません');
        const gain = this.calcSellPrice(it);
        PLAYER.gold += gain;
        STORAGE[idx] = null;
        this.onToast(`💰 倉庫から直接売却 +${gain}G`);
        saveGame();
        this.render();
      });
    });
  }

  runGacha(pool, count, floor) {
    const results = [];
    const triggerKeys = Object.keys(TRIGGER_LIST);

    for (let i = 0; i < count; i++) {
      const r = Math.random();

      if (pool === 'weapon') {
        // ① 武器ガチャ
        if (r < 0.22) {
          const legs = ['mubi', 'apocalypse', 'astral_orb', 'chronos_bow', 'inferno_scythe'];
          const w = rollWeapon(legs[Math.floor(Math.random() * legs.length)], floor);
          if (addToPack(w)) results.push(`★Legend武器【${w.name}】`);
          else results.push(`★Legend武器【${w.name}】(バッグ満杯)`);
        } else if (r < 0.45) {
          const exsKeys = Object.keys(EXS_LIST);
          const pick = exsKeys[Math.floor(Math.random() * exsKeys.length)];
          state.ownedExs[pick] = 1;
          results.push(`⚡ExS【${EXS_LIST[pick].name}】`);
        } else if (r < 0.75) {
          const normals = ['sword', 'dual', 'bow', 'greatsword', 'spear', 'spellbook'];
          const w = rollWeapon(normals[Math.floor(Math.random() * normals.length)], floor);
          if (addToPack(w)) results.push(`⚔️武器【${w.name}】`);
          else results.push(`⚔️武器【${w.name}】(バッグ満杯)`);
        } else {
          const pot = createPotion('full', 1);
          addToPack(pot);
          results.push('🧪全回復ポーション');
        }
      } else if (pool === 'motif') {
        // ② モチーフ遺物ガチャ
        if (r < 0.25) {
          const motifs = ['motif_mubi', 'motif_apo', 'motif_astral', 'motif_chronos'];
          const art = rollLegendArtifact(motifs[Math.floor(Math.random() * motifs.length)]);
          if (art && addToPack(art)) results.push(`★モチーフ遺物【${art.name}】`);
          else if (art) results.push(`★モチーフ遺物【${art.name}】(バッグ満杯)`);
        } else if (r < 0.75) {
          const art = rollArtifact();
          if (addToPack(art)) results.push(`🔮遺物【${art.name}】`);
          else results.push(`🔮遺物【${art.name}】(バッグ満杯)`);
        } else {
          const pot = createPotion('full', 1);
          addToPack(pot);
          results.push('🧪全回復ポーション');
        }
      } else if (pool === 'trigger') {
        // ③ トリガーガチャ（開発室倉庫へ直接登録＆重複でLvUP）
        // レア枠（アイビス・フルアタック）は少し低め、その他トリガーは均等排出
        const rareTriggers = ['ibis', 'full_attack'];
        const normalTriggers = triggerKeys.filter((k) => !rareTriggers.includes(k));
        const pickId = r < 0.15
          ? rareTriggers[Math.floor(Math.random() * rareTriggers.length)]
          : normalTriggers[Math.floor(Math.random() * normalTriggers.length)];

        const trDef = TRIGGER_LIST[pickId];
        const prevLv = state.ownedTriggers[pickId] || 0;
        state.ownedTriggers[pickId] = prevLv + 1;

        if (prevLv === 0) {
          results.push(`💠新規【${trDef.name}】`);
        } else {
          results.push(`💠【${trDef.name}】Lv.${prevLv + 1}に強化！`);
        }
      }
    }

    this.onToast(`🎰 召喚結果: ${results.join(' / ')}`);
  }
  // ==========================================
  // ポーズメニュー画面 [Tab]
  // ==========================================
  renderPauseScreen(showFloorList = false) {
    const maxCleared = SAVE.cleared || 0;
    const nextChallengeFloor = maxCleared + 1;

    if (!showFloorList) {
      this.modalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; min-height:400px; padding:16px;">
          <!-- 上部ヘッダーバー -->
          <div style="background:rgba(30, 38, 52, 0.92); border:1px solid #4a5568; padding:10px 28px; font-size:16px; font-weight:bold; color:#cbd5e0; letter-spacing:0.5px; margin-bottom:6px;">
            ポーズ中 攻略済み最高: ${maxCleared > 0 ? `${maxCleared}.5F` : 'なし'} (Tabで再開)
          </div>

          <button class="pause-btn" style="width:auto; min-width:250px; margin:0; padding:11px 24px; font-size:15px; font-weight:bold; background:#252d3d; border:1px solid #4a5568;" data-pause="latest">
            ⚡ 最新の挑戦階へ (${nextChallengeFloor}F)
          </button>

          <button class="pause-btn" style="width:auto; min-width:130px; margin:0; padding:11px 24px; font-size:15px; font-weight:bold; background:#252d3d; border:1px solid #4a5568;" data-pause="town">
            町へ戻る
          </button>

          <button class="pause-btn" style="width:auto; min-width:270px; margin:0; padding:11px 24px; font-size:15px; font-weight:bold; background:#252d3d; border:1px solid #4a5568;" data-pause="floors" ${maxCleared === 0 ? 'disabled' : ''}>
            攻略済みの階層一覧から選ぶ
          </button>

          <button class="pause-btn" style="width:auto; min-width:250px; margin:0; padding:11px 24px; font-size:15px; font-weight:bold; background:#252d3d; border:1px solid #4a5568;" data-pause="auto-dismantle" ${PLAYER.lv < 200 ? 'disabled' : ''}>
            ♻️ 弱防具の自動分解: ${PLAYER.lv < 200 ? 'Lv200解放' : (SAVE.autoDismantle ? 'ON' : 'OFF')}
          </button>

          <button class="pause-btn" style="width:auto; min-width:140px; margin:0; padding:11px 24px; font-size:15px; font-weight:bold; background:#252d3d; border:1px solid #4a5568;" data-pause="save">
            手動セーブ
          </button>

          <button class="pause-btn" style="width:auto; min-width:160px; margin:0; padding:11px 24px; font-size:15px; font-weight:bold; background:#252d3d; border:1px solid #4a5568;" data-pause="resume">
            ゲームに戻る
          </button>
        </div>
      `;
    } else {
      // 1ページ5階層ずつ降順表示（左: ボス階 .5F / 右: 通常階 F）
      const perPage = 5;
      const totalPages = Math.max(1, Math.ceil(maxCleared / perPage));
      if (this.floorPage === undefined) this.floorPage = 0;
      this.floorPage = Math.max(0, Math.min(totalPages - 1, this.floorPage));

      const startFloor = maxCleared - this.floorPage * perPage;
      const endFloor = Math.max(1, startFloor - perPage + 1);
      const floors = [];
      for (let f = startFloor; f >= endFloor; f--) floors.push(f);

      this.modalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:space-between; min-height:400px; padding:12px;">
          <!-- 上部ヘッダーバー -->
          <div style="background:rgba(30, 38, 52, 0.92); border:1px solid #4a5568; padding:10px 28px; font-size:16px; font-weight:bold; color:#cbd5e0; letter-spacing:0.5px;">
            ポーズ中 攻略済み最高: ${maxCleared}.5F (Tabで再開)
          </div>

          <!-- 中央2列グリッド（左: ボス階 .5F / 右: 通常階 F） -->
          <div style="display:grid; grid-template-columns:160px 160px; column-gap:90px; row-gap:14px; margin:22px 0;">
            ${floors.map((f) => `
              <button class="pause-btn" style="margin:0; padding:11px 0; font-size:15px; font-weight:bold; background:#252d3d; border:1px solid #4a5568;" data-warp="${f}" data-boss="1">
                ${f}.5F
              </button>
              <button class="pause-btn" style="margin:0; padding:11px 0; font-size:15px; font-weight:bold; background:#252d3d; border:1px solid #4a5568;" data-warp="${f}" data-boss="0">
                ${f}F
              </button>
            `).join('')}
          </div>

          <!-- ページネーション（← 前のページ / 次のページ →） -->
          <div style="display:flex; gap:110px; margin-bottom:18px;">
            <button class="pause-btn" style="width:165px; margin:0; padding:10px 0; font-weight:bold; background:#252d3d; border:1px solid #4a5568;" data-pause="prev-page" ${this.floorPage <= 0 ? 'disabled' : ''}>
              ← 前のページ
            </button>
            <button class="pause-btn" style="width:165px; margin:0; padding:10px 0; font-weight:bold; background:#252d3d; border:1px solid #4a5568;" data-pause="next-page" ${this.floorPage >= totalPages - 1 ? 'disabled' : ''}>
              次のページ →
            </button>
          </div>

          <!-- 最下部：戻るボタン -->
          <button class="pause-btn" style="width:110px; margin:0; padding:10px 0; font-weight:bold; background:#252d3d; border:1px solid #4a5568;" data-pause="back">
            戻る
          </button>
        </div>
      `;
    }

    this.modalBody.querySelectorAll('[data-pause]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.pause;
        if (act === 'resume') {
          this.closeModal();
        } else if (act === 'latest') {
          this.closeModal();
          window.dispatchEvent(new CustomEvent('warp-floor', { detail: { floor: nextChallengeFloor, isBoss: false } }));
        } else if (act === 'town') {
          this.closeModal();
          window.dispatchEvent(new CustomEvent('warp-floor', { detail: { floor: 0, isBoss: false } }));
        } else if (act === 'floors') {
          this.floorPage = 0;
          this.renderPauseScreen(true);
        } else if (act === 'prev-page') {
          this.floorPage = Math.max(0, (this.floorPage || 0) - 1);
          this.renderPauseScreen(true);
        } else if (act === 'next-page') {
          this.floorPage = (this.floorPage || 0) + 1;
          this.renderPauseScreen(true);
        } else if (act === 'back') {
          this.renderPauseScreen(false);
        } else if (act === 'auto-dismantle') {
          if (PLAYER.lv >= 200) {
            SAVE.autoDismantle = !SAVE.autoDismantle;
            saveGame();
            this.renderPauseScreen(false);
          }
        } else if (act === 'save') {
          saveGame();
          this.onToast('💾 セーブデータを保存しました！');
        }
      });
    });

    this.modalBody.querySelectorAll('[data-warp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const f = Number(btn.dataset.warp);
        const isBoss = btn.dataset.boss === '1';
        this.closeModal();
        window.dispatchEvent(new CustomEvent('warp-floor', { detail: { floor: f, isBoss } }));
      });
    });
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
    const gx = Math.round(pPos.x / 4.5);
    const gz = Math.round(pPos.z / 4.5);
    if (this.player.radarUntil > performance.now()) {
      for (let rx = -22; rx <= 22; rx++) {
        for (let rz = -22; rz <= 22; rz++) {
          this.exploredSet.add(`${rx},${rz}`);
        }
      }
    }
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        this.exploredSet.add(`${gx + dx},${gz + dz}`);
      }
    }

    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const scale = 1.65; // 広大ダンジョンを見渡しやすく調整
    const cx = w / 2;
    const cy = h / 2;

    // 探索済みエリア
    ctx.fillStyle = 'rgba(45, 55, 72, 0.72)';
    for (const key of this.exploredSet) {
      const [ex, ez] = key.split(',').map(Number);
      const sx = cx + (ex * 4.5 - pPos.x) * scale;
      const sy = cy + (ez * 4.5 - pPos.z) * scale;
      if (sx < -12 || sx > w + 12 || sy < -12 || sy > h + 12) continue;
      ctx.fillRect(sx - 3.8, sy - 3.8, 7.6, 7.6);
    }

    // 周囲の壁
    ctx.fillStyle = '#718096';
    for (const wall of this.world.walls) {
      if (wall.userData.destructible) continue;
      const sx = cx + (wall.position.x - pPos.x) * scale;
      const sy = cy + (wall.position.z - pPos.z) * scale;
      if (sx < -12 || sx > w + 12 || sy < -12 || sy > h + 12) continue;
      ctx.fillRect(sx - 3.6, sy - 3.6, 7.2, 7.2);
    }

    // 宝箱（金色）＆回復の泉（緑色）
    for (const item of this.world.interactables) {
      if ((item.type === 'chest' && item.opened) || (item.type === 'fountain' && item.used)) continue;
      const ix = cx + (item.pos.x - pPos.x) * scale;
      const iy = cy + (item.pos.z - pPos.z) * scale;
      if (ix < 0 || ix > w || iy < 0 || iy > h) continue;
      ctx.fillStyle = item.type === 'chest' ? '#ffd36a' : '#48bb78';
      ctx.fillRect(ix - 3, iy - 3, 6, 6);
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
