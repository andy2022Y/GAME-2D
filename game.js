(function(){
  "use strict";
  const AE = window.AE = window.AE || {};
  const { clamp, dist2, rand, randInt, id, now } = AE.Utils;
  const { TILE, ClassDefs, EnemyDefs, Items, QuestDefs, Zones, xpToNext } = AE.Data;

  const VIEW_W = 960, VIEW_H = 540;

  // DOM
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const minimap = document.getElementById("minimap");
  const mctx = minimap.getContext("2d");
  const gameEl = document.getElementById("game");

  const classSel = document.getElementById("classSel");
  const newBtn = document.getElementById("newBtn");
  const saveBtn = document.getElementById("saveBtn");
  const resetBtn = document.getElementById("resetBtn");
  const debugBtn = document.getElementById("debugBtn");

  // UI helper
  const { ui, logMsg, toggle, hideAllPanels } = AE.UI.init();

  // Input
  AE.Input.bind(cv, gameEl);
  const keys = AE.Input.keys;
  const mouse = AE.Input.mouse;

  let debug = false;
  let paused = false;
  let showMinimap = true;

  // ============ Inventory helpers ============
  function newInventory(){ return { slots: [] }; }
  function addItem(inv, itemId, qty){
    qty = Math.max(1, qty|0);
    for (const s of inv.slots){
      if (s && s.itemId === itemId){ s.qty += qty; return true; }
    }
    inv.slots.push({ itemId, qty });
    return true;
  }
  function removeItem(inv, itemId, qty){
    qty = Math.max(1, qty|0);
    for (let i=0;i<inv.slots.length;i++){
      const s = inv.slots[i];
      if (!s || s.itemId !== itemId) continue;
      if (s.qty < qty) return false;
      s.qty -= qty;
      if (s.qty === 0) inv.slots.splice(i,1);
      return true;
    }
    return false;
  }
  function countItem(inv, itemId){
    let n=0;
    for (const s of inv.slots) if (s?.itemId === itemId) n += s.qty;
    return n;
  }

  // ============ Game State ============
  function freshState(classId){
    const cd = ClassDefs[classId] ?? ClassDefs.WARRIOR;
    const p = {
      classId,
      x: Zones.HUB.spawn.x,
      y: Zones.HUB.spawn.y,
      hp: cd.baseMaxHP,
      mp: cd.baseMaxMP,
      maxHP: cd.baseMaxHP,
      maxMP: cd.baseMaxMP,
      level: 1,
      xp: 0,
      gold: 0,

      speed: cd.baseSpeed,
      atk: cd.atk,
      def: cd.def,

      critChanceRaw: 0,
      critDmgRaw: 0,
      critChance: 0,
      critDmg: 0,

      invulnT: 0,
      inCombatT: 0,
      atkCD: 0,
      skill1CD: 0,
      skill2CD: 0,

      potions: { hp: 2, mp: 1 },
    };

    const qs = {};
    for (const qid of Object.keys(QuestDefs)){
      qs[qid] = { state:"NOT_STARTED", progress:0, flags:{} };
    }

    return {
      version: AE.Save.SAVE_VERSION,
      zoneId: "HUB",
      time: 0,

      player: p,
      inv: newInventory(),
      equipment: { weapon:null, armor:null },
      quests: qs,

      enemies: [],
      projectiles: [],
      drops: [],
      pickups: [],

      _dirty: true,
      _saveCooldown: 0,
      _autosaveT: 0,
    };
  }

  let state = null;

  function ensureDerivedStats(){
    const p = state.player;
    const cd = ClassDefs[p.classId];

    // speed +3% per level up to 100
    const lvForSpeed = Math.min(100, p.level);
    p.speed = cd.baseSpeed * (1 + 0.03*(lvForSpeed-1));

    // crit +2% per 20 levels (raw)
    const steps = Math.floor(p.level / 20);
    p.critChanceRaw = steps * 2.0;
    p.critDmgRaw = steps * 2.0;

    // effective caps to avoid breaking
    p.critChance = Math.min(95, p.critChanceRaw);
    p.critDmg = Math.min(400, p.critDmgRaw);

    // base scaling
    p.atk = cd.atk + Math.floor(p.level * 0.6);
    p.def = cd.def + Math.floor(p.level * 0.35);

    // equipment
    if (state.equipment.weapon){
      const it = Items[state.equipment.weapon];
      if (it?.atk) p.atk += it.atk;
    }
    if (state.equipment.armor){
      const it = Items[state.equipment.armor];
      if (it?.def) p.def += it.def;
    }

    p.maxHP = cd.baseMaxHP + (p.level-1)*8;
    p.maxMP = cd.baseMaxMP + (p.level-1)*6;
    p.hp = clamp(p.hp, 0, p.maxHP);
    p.mp = clamp(p.mp, 0, p.maxMP);
  }

  // ============ Map / Collision ============
  function isSolid(zone, tx, ty){
    const row = zone.map[ty];
    if (!row) return true;
    const ch = row[tx];
    return ch === "#" || ch === undefined;
  }
  function tileAt(zone, x, y){
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    return { tx, ty, ch: zone.map[ty]?.[tx] ?? "#" };
  }
  function tryMove(entity, nx, ny, zone){
    const w=18, h=18, halfW=w/2, halfH=h/2;
    let x=entity.x, y=entity.y;

    // X
    let tx1 = Math.floor((nx-halfW)/TILE), tx2 = Math.floor((nx+halfW)/TILE);
    let ty1 = Math.floor((y-halfH)/TILE),  ty2 = Math.floor((y+halfH)/TILE);
    if (!isSolid(zone, tx1,ty1) && !isSolid(zone, tx2,ty1) && !isSolid(zone, tx1,ty2) && !isSolid(zone, tx2,ty2)) x = nx;

    // Y
    tx1 = Math.floor((x-halfW)/TILE); tx2 = Math.floor((x+halfW)/TILE);
    ty1 = Math.floor((ny-halfH)/TILE); ty2 = Math.floor((ny+halfH)/TILE);
    if (!isSolid(zone, tx1,ty1) && !isSolid(zone, tx2,ty1) && !isSolid(zone, tx1,ty2) && !isSolid(zone, tx2,ty2)) y = ny;

    entity.x=x; entity.y=y;
  }

  // ============ Zone load / spawns ============
  function spawnPickupsForZone(zone){
    state.pickups = [];
    for (let ty=0; ty<zone.map.length; ty++){
      const row = zone.map[ty];
      for (let tx=0; tx<row.length; tx++){
        const ch = row[tx];
        if (ch === "H"){
          state.pickups.push({ id:id(), type:"HERB", x: tx*TILE+TILE/2, y: ty*TILE+TILE/2 });
        }
        if (ch === "L"){
          const q3 = state.quests.Q3;
          if (q3?.state === "IN_PROGRESS" && !q3.flags.gotLetter){
            state.pickups.push({ id:id(), type:"LETTER", x: tx*TILE+TILE/2, y: ty*TILE+TILE/2 });
          }
        }
      }
    }
  }

  function loadZone(zoneId, fromPortal=null){
    const z = Zones[zoneId];
    if (!z) return;
    state.zoneId = zoneId;

    if (fromPortal){
      state.player.x = fromPortal.toX*TILE + TILE/2;
      state.player.y = fromPortal.toY*TILE + TILE/2;
    } else {
      state.player.x = z.spawn.x;
      state.player.y = z.spawn.y;
    }

    state.enemies = [];
    state.projectiles = [];
    state.drops = [];

    for (const pack of z.enemies){
      for (let i=0;i<pack.count;i++){
        const ex = (pack.x + rand()*3) * TILE + TILE/2;
        const ey = (pack.y + rand()*3) * TILE + TILE/2;
        const def = EnemyDefs[pack.type];
        state.enemies.push({
          id:id(), type:pack.type,
          x:ex, y:ey, vx:0, vy:0,
          hp:def.maxHP, maxHP:def.maxHP,
          aiT:0, atkCD:0, homeX:ex, homeY:ey
        });
      }
    }

    spawnPickupsForZone(z);
    AE.Save.markDirty(state);
    logMsg(`🗺️ Entrou em ${z.name}`);
  }

  // ============ Combat ============
  function dmgAfterDef(base, def){
    const reduced = base - def*1.2;
    return Math.max(1, Math.floor(reduced));
  }
  function rollCrit(){
    const p = state.player;
    const r = rand()*100;
    if (r < p.critChance){
      const mult = 1 + (p.critDmg/100);
      return { crit:true, mult };
    }
    return { crit:false, mult:1 };
  }
  function grantXP(xp){
    const p = state.player;
    p.xp += xp;
    logMsg(`+${xp} XP`);
    let need = xpToNext(p.level);
    while (p.xp >= need){
      p.xp -= need;
      p.level += 1;
      ensureDerivedStats();
      p.hp = p.maxHP;
      p.mp = p.maxMP;
      logMsg(`✨ Level up! Agora Lv ${p.level}`);
      need = xpToNext(p.level);
      AE.Save.markDirty(state);
    }
  }
  function dropLoot(enemy){
    const def = EnemyDefs[enemy.type];
    const gold = randInt(def.goldMin, def.goldMax);
    state.drops.push({ id:id(), type:"GOLD", amount:gold, x:enemy.x, y:enemy.y });
    if (rand() < def.dropPotionChance){
      const potion = rand() < 0.5 ? "HP_POT" : "MP_POT";
      state.drops.push({ id:id(), type:potion, amount:1, x:enemy.x+10, y:enemy.y-8 });
    }
  }
  function hurtPlayer(amount){
    const p = state.player;
    if (p.invulnT > 0) return;
    p.hp -= amount;
    p.invulnT = 0.35;
    p.inCombatT = 2.0;
    logMsg(`-${amount} HP`);
    if (p.hp <= 0){
      p.hp = p.maxHP;
      p.mp = p.maxMP;
      const lost = Math.floor(p.gold * 0.25);
      p.gold -= lost;
      logMsg(`💀 Você caiu! Perdeu ${lost} gold e voltou ao início da zona.`);
      loadZone(state.zoneId, null);
    }
    AE.Save.markDirty(state);
  }

  function advanceQuestOnKill(enemyType){
    const q1 = state.quests.Q1;
    if (q1.state === "IN_PROGRESS" && QuestDefs.Q1.target === enemyType){
      q1.progress = Math.min(QuestDefs.Q1.goal, (q1.progress|0)+1);
      q1.progressText = `Progresso: ${q1.progress}/${QuestDefs.Q1.goal}`;
      logMsg(`Quest Q1: ${q1.progress}/${QuestDefs.Q1.goal}`);
      if (q1.progress >= QuestDefs.Q1.goal){
        q1.state = "COMPLETED";
        logMsg("🎯 Q1 concluída! Volte ao Guardião no HUB.");
      }
      AE.Save.markDirty(state);
    }
  }

  function hurtEnemy(enemy, baseDmg){
    const ed = EnemyDefs[enemy.type];
    const dmg = dmgAfterDef(baseDmg, ed.def);
    const c = rollCrit();
    const finalDmg = Math.max(1, Math.floor(dmg * c.mult));
    enemy.hp -= finalDmg;
    state.player.inCombatT = 2.0;

    if (c.crit) logMsg(`💥 CRÍTICO! -${finalDmg}`);
    else logMsg(`-${finalDmg}`);

    if (enemy.hp <= 0){
      enemy.hp = 0;
      grantXP(ed.xp);
      dropLoot(enemy);
      advanceQuestOnKill(enemy.type);
      state.enemies = state.enemies.filter(e => e.id !== enemy.id);
      logMsg(`✅ ${ed.name} derrotado`);
    }
    AE.Save.markDirty(state);
  }

  function basicAttack(){
    const p = state.player;
    if (p.atkCD > 0) return;
    const base = 0.38;
    const speedBoost = (p.level >= 100) ? 0.70 : 1.0;
    p.atkCD = base * speedBoost;

    const dx = mouse.x - VIEW_W/2;
    const dy = mouse.y - VIEW_H/2;
    const len = Math.hypot(dx,dy) || 1;
    const dirX = dx/len, dirY = dy/len;

    if (p.classId === "WARRIOR"){
      const range = ClassDefs.WARRIOR.range;
      let best=null, bestD2=1e18;
      for (const e of state.enemies){
        const vx = e.x - p.x, vy = e.y - p.y;
        const d = Math.hypot(vx,vy);
        if (d > range) continue;
        const dot = (vx/d)*dirX + (vy/d)*dirY;
        if (dot < 0.35) continue;
        const d2 = vx*vx+vy*vy;
        if (d2 < bestD2){ bestD2=d2; best=e; }
      }
      if (best) hurtEnemy(best, p.atk);
    } else {
      const speed = 420;
      state.projectiles.push({ id:id(), from:"PLAYER", kind: (p.classId==="ARCHER")?"ARROW":"BOLT",
        x:p.x, y:p.y, vx:dirX*speed, vy:dirY*speed, dmg:p.atk, life:0.9 });
    }
  }

  function skill1(){
    const p = state.player;
    if (p.skill1CD > 0) return;
    const speedBoost = (p.level >= 100) ? 0.70 : 1.0;

    if (p.classId === "WARRIOR"){
      p.skill1CD = 2.2 * speedBoost;
      const dx = mouse.x - VIEW_W/2, dy = mouse.y - VIEW_H/2;
      const len = Math.hypot(dx,dy) || 1;
      const dirX = dx/len, dirY = dy/len;
      const dash = 110;
      tryMove(p, p.x + dirX*dash, p.y + dirY*dash, Zones[state.zoneId]);
      for (const e of state.enemies) if (dist2(p.x,p.y,e.x,e.y) < 60*60) hurtEnemy(e, p.atk + 8);
      logMsg("🛡️ Investida!");
    } else if (p.classId === "ARCHER"){
      p.skill1CD = 2.8 * speedBoost;
      const dx = mouse.x - VIEW_W/2, dy = mouse.y - VIEW_H/2;
      const baseAng = Math.atan2(dy,dx);
      for (const off of [-0.18,0,0.18]){
        const ang = baseAng + off;
        const vx = Math.cos(ang)*520, vy = Math.sin(ang)*520;
        state.projectiles.push({ id:id(), from:"PLAYER", kind:"ARROW", x:p.x, y:p.y, vx, vy, dmg:p.atk+4, life:0.65 });
      }
      logMsg("🏹 Rajada tripla!");
    } else {
      const cost = 24;
      if (p.mp < cost){ logMsg("⚠️ Mana insuficiente."); return; }
      p.mp -= cost;
      p.skill1CD = 3.2 * speedBoost;
      const dx = mouse.x - VIEW_W/2, dy = mouse.y - VIEW_H/2;
      const len = Math.hypot(dx,dy) || 1;
      const dirX = dx/len, dirY = dy/len;
      state.projectiles.push({ id:id(), from:"PLAYER", kind:"FIREBOLT", x:p.x, y:p.y, vx:dirX*430, vy:dirY*430,
        dmg:p.atk+14, life:0.85, splash:46 });
      logMsg("🔥 Orbe de Fogo!");
    }
    p.inCombatT = 1.8;
    AE.Save.markDirty(state);
  }

  function skill2(){
    const p = state.player;
    if (p.skill2CD > 0) return;
    const cost = 22;
    if (p.mp < cost){ logMsg("⚠️ Mana insuficiente."); return; }
    p.mp -= cost;
    const speedBoost = (p.level >= 100) ? 0.70 : 1.0;
    p.skill2CD = 4.5 * speedBoost;
    const heal = 55;
    p.hp = Math.min(p.maxHP, p.hp + heal);
    logMsg(`✨ Cura +${heal} HP`);
    AE.Save.markDirty(state);
  }

  function usePotion(kind){
    const p = state.player;
    if (kind === "HP"){
      if (p.potions.hp <= 0){ logMsg("⚠️ Sem poção de vida."); return; }
      p.potions.hp--;
      p.hp = Math.min(p.maxHP, p.hp + Items.HP_POT.healHP);
      logMsg(`🧪 +${Items.HP_POT.healHP} HP`);
    } else {
      if (p.potions.mp <= 0){ logMsg("⚠️ Sem poção de mana."); return; }
      p.potions.mp--;
      p.mp = Math.min(p.maxMP, p.mp + Items.MP_POT.healMP);
      logMsg(`🧪 +${Items.MP_POT.healMP} MP`);
    }
    AE.Save.markDirty(state);
  }

  // ============ NPC / Shop / Quests ============
  function listNPCsInZone(){
    const z = Zones[state.zoneId];
    return z.npcs || [];
  }
  function npcWorldPos(npc){
    return { x: npc.x*TILE + TILE/2, y: npc.y*TILE + TILE/2 };
  }
  function nearestNPC(){
    const p = state.player;
    let best=null, bestD2=1e18;
    for (const npc of listNPCsInZone()){
      const pos = npcWorldPos(npc);
      const d2 = dist2(pos.x,pos.y,p.x,p.y);
      if (d2 < bestD2){ bestD2=d2; best=npc; }
    }
    return (best && bestD2 < 70*70) ? best : null;
  }

  function startQuest(qid){
    const q = state.quests[qid];
    if (!q || q.state !== "NOT_STARTED") return;
    q.state = "IN_PROGRESS";
    q.progress = 0;
    q.flags = q.flags || {};
    q.progressText = "Em andamento.";
    logMsg(`📜 Quest iniciada: ${QuestDefs[qid].title}`);
    AE.Save.markDirty(state);

    if (qid === "Q3" && state.zoneId === "FOREST"){
      spawnPickupsForZone(Zones.FOREST);
    }
  }

  function tryTurnInQuest(qid){
    const q = state.quests[qid];
    if (!q || q.state !== "COMPLETED") return false;
    const rw = QuestDefs[qid].reward;
    if (rw.gold) state.player.gold += rw.gold;
    if (rw.xp) grantXP(rw.xp);
    if (rw.hpPot) state.player.potions.hp += rw.hpPot;
    if (rw.mpPot) state.player.potions.mp += rw.mpPot;
    if (rw.itemId) addItem(state.inv, rw.itemId, 1);
    q.state = "TURNED_IN";
    logMsg(`✅ Quest entregue: ${QuestDefs[qid].title}`);
    AE.Save.markDirty(state);
    return true;
  }

  function updateQuestQ2Progress(){
    const q2 = state.quests.Q2;
    if (q2.state !== "IN_PROGRESS") return;
    const have = countItem(state.inv, "HERB");
    q2.progress = Math.min(QuestDefs.Q2.goal, have);
    q2.progressText = `Progresso: ${q2.progress}/${QuestDefs.Q2.goal}`;
    if (q2.progress >= QuestDefs.Q2.goal){
      q2.state = "COMPLETED";
      logMsg("🎯 Q2 concluída! Volte ao Curandeiro.");
    }
    AE.Save.markDirty(state);
  }

  function updateQuestQ3Progress(){
    const q3 = state.quests.Q3;
    if (q3.state !== "IN_PROGRESS") return;
    if (countItem(state.inv, "LETTER") > 0){
      q3.flags.gotLetter = true;
      q3.progressText = "Entregue a Carta ao Mercador no HUB.";
      q3.state = "COMPLETED";
      logMsg("📩 Você recuperou a Carta! Volte ao Mercador.");
      AE.Save.markDirty(state);
    } else {
      q3.progressText = "Procure a Carta na Floresta (marcada).";
    }
  }

  function interactNPC(npc){
    if (!npc) return;

    if (npc.id === "GUARDIAN"){
      const q1 = state.quests.Q1;
      if (q1.state === "NOT_STARTED") startQuest("Q1");
      else if (q1.state === "COMPLETED") tryTurnInQuest("Q1");
      else logMsg("🗣️ Guardião: Proteja Aetheris.");
    }

    if (npc.id === "HEALER"){
      const q2 = state.quests.Q2;
      if (q2.state === "NOT_STARTED") startQuest("Q2");
      else if (q2.state === "COMPLETED"){
        const need = QuestDefs.Q2.goal;
        if (countItem(state.inv, "HERB") >= need){
          removeItem(state.inv, "HERB", need);
          tryTurnInQuest("Q2");
        } else logMsg("⚠️ Você não tem ervas suficientes.");
      } else logMsg("🗣️ Curandeiro: Traga ervas para poções.");
    }

    if (npc.id === "EXPLORER"){
      const q3 = state.quests.Q3;
      if (q3.state === "NOT_STARTED") startQuest("Q3");
      else logMsg("🗺️ Explorador: A carta sumiu na floresta...");
    }

    if (npc.id === "MERCHANT"){
      const q3 = state.quests.Q3;
      if (q3.state === "COMPLETED" && countItem(state.inv, "LETTER") > 0){
        removeItem(state.inv, "LETTER", 1);
        tryTurnInQuest("Q3");
      } else logMsg("🛒 Mercador: Veja minhas mercadorias.");
      AE.UI.renderShop(ui, state);
      toggle(ui.shopPanel, true);
    }

    refreshAllUI();
  }

  function buy(itemId){
    const stock = AE.Data.ShopStock.find(s => s.itemId === itemId);
    if (!stock) return;
    if (state.player.gold < stock.buy){ logMsg("⚠️ Gold insuficiente."); return; }
    state.player.gold -= stock.buy;
    if (itemId === "HP_POT") state.player.potions.hp += 1;
    else if (itemId === "MP_POT") state.player.potions.mp += 1;
    else addItem(state.inv, itemId, 1);
    logMsg(`🛒 Comprou ${Items[itemId].name}`);
    AE.Save.markDirty(state);
  }

  function sell(itemId){
    const stock = AE.Data.ShopStock.find(s => s.itemId === itemId);
    if (!stock) return;
    if (itemId === "LETTER"){ logMsg("⚠️ Não é possível vender isso."); return; }

    if (itemId === "HP_POT"){
      if (state.player.potions.hp <= 0){ logMsg("⚠️ Você não tem poção HP."); return; }
      state.player.potions.hp--; state.player.gold += stock.sell;
      logMsg("💰 Vendeu Poção de Vida");
    } else if (itemId === "MP_POT"){
      if (state.player.potions.mp <= 0){ logMsg("⚠️ Você não tem poção MP."); return; }
      state.player.potions.mp--; state.player.gold += stock.sell;
      logMsg("💰 Vendeu Poção de Mana");
    } else {
      if (!removeItem(state.inv, itemId, 1)){ logMsg("⚠️ Você não tem esse item."); return; }
      state.player.gold += stock.sell;
      logMsg(`💰 Vendeu ${Items[itemId].name}`);
    }
    AE.Save.markDirty(state);
  }

  // ============ Update / Draw ============
  function update(dt){
    const p = state.player;
    const z = Zones[state.zoneId];
    state.time += dt;

    // timers
    p.invulnT = Math.max(0, p.invulnT - dt);
    p.inCombatT = Math.max(0, p.inCombatT - dt);
    p.atkCD = Math.max(0, p.atkCD - dt);
    p.skill1CD = Math.max(0, p.skill1CD - dt);
    p.skill2CD = Math.max(0, p.skill2CD - dt);

    // regen
    if (p.inCombatT <= 0){
      p.hp = Math.min(p.maxHP, p.hp + 3.0*dt);
      p.mp = Math.min(p.maxMP, p.mp + 6.0*dt);
    }

    // movement
    let ix=0, iy=0;
    if (keys.has("w") || keys.has("arrowup")) iy -= 1;
    if (keys.has("s") || keys.has("arrowdown")) iy += 1;
    if (keys.has("a") || keys.has("arrowleft")) ix -= 1;
    if (keys.has("d") || keys.has("arrowright")) ix += 1;
    if (ix || iy){ const l = Math.hypot(ix,iy); ix/=l; iy/=l; }
    tryMove(p, p.x + ix*p.speed*dt, p.y + iy*p.speed*dt, z);

    // portals
    const t = tileAt(z, p.x, p.y);
    if (t.ch === "P"){
      const portal = z.portals.find(pp => pp.x === t.tx && pp.y === t.ty);
      if (portal) loadZone(portal.to, portal);
    }

    // AI
    for (const e of state.enemies){
      const ed = EnemyDefs[e.type];
      e.aiT -= dt;
      e.atkCD = Math.max(0, e.atkCD - dt);

      const d2p = dist2(e.x,e.y,p.x,p.y);
      const chase = d2p < 220*220;
      const attackRange = ed.boss ? 55 : 40;
      const canAttack = d2p < attackRange*attackRange;

      if (canAttack){
        if (e.atkCD <= 0){
          e.atkCD = ed.boss ? 1.0 : 1.25;
          hurtPlayer(dmgAfterDef(ed.atk, p.def));
        }
      } else if (chase){
        const dx = p.x - e.x, dy = p.y - e.y;
        const l = Math.hypot(dx,dy) || 1;
        tryMove(e, e.x + (dx/l)*ed.speed*dt, e.y + (dy/l)*ed.speed*dt, z);
      } else {
        if (e.aiT <= 0){
          e.aiT = 0.8 + rand()*1.2;
          const ang = rand()*Math.PI*2;
          e.vx = Math.cos(ang) * (ed.speed*0.4);
          e.vy = Math.sin(ang) * (ed.speed*0.4);
        }
        tryMove(e, e.x + e.vx*dt, e.y + e.vy*dt, z);
      }
    }

    // projectiles
    for (const pr of state.projectiles){
      pr.life -= dt;
      pr.x += pr.vx*dt;
      pr.y += pr.vy*dt;

      if (tileAt(z, pr.x, pr.y).ch === "#") pr.life = 0;

      if (pr.from === "PLAYER"){
        for (const e of state.enemies){
          if (dist2(pr.x,pr.y,e.x,e.y) < 18*18){
            if (pr.kind === "FIREBOLT" && pr.splash){
              for (const ee of state.enemies){
                if (dist2(pr.x,pr.y,ee.x,ee.y) < pr.splash*pr.splash) hurtEnemy(ee, pr.dmg);
              }
            } else {
              hurtEnemy(e, pr.dmg);
            }
            pr.life = 0;
            break;
          }
        }
      }
    }
    state.projectiles = state.projectiles.filter(pj => pj.life > 0);

    // drops pickup
    for (const d of state.drops){
      if (dist2(d.x,d.y,p.x,p.y) < 26*26){
        if (d.type === "GOLD"){ p.gold += d.amount; logMsg(`💰 +${d.amount} gold`); }
        if (d.type === "HP_POT"){ p.potions.hp += d.amount; logMsg(`🧪 +${d.amount} poção HP`); }
        if (d.type === "MP_POT"){ p.potions.mp += d.amount; logMsg(`🧪 +${d.amount} poção MP`); }
        AE.Save.markDirty(state);
        d._picked = true;
      }
    }
    state.drops = state.drops.filter(d => !d._picked);

    // pickups
    for (const pu of state.pickups){
      if (dist2(pu.x,pu.y,p.x,p.y) < 28*28){
        if (pu.type === "HERB"){
          addItem(state.inv, "HERB", 1);
          logMsg("🌿 +1 Erva");
          updateQuestQ2Progress();
        } else if (pu.type === "LETTER"){
          addItem(state.inv, "LETTER", 1);
          logMsg("📩 Você pegou a Carta");
          updateQuestQ3Progress();
          spawnPickupsForZone(z);
        }
        pu._picked = true;
        AE.Save.markDirty(state);
      }
    }
    state.pickups = state.pickups.filter(x => !x._picked);

    updateQuestQ3Progress();

    // click: interact NPC if near, else attack
    if (mouse.clicked){
      const npc = nearestNPC();
      if (npc) interactNPC(npc);
      else basicAttack();
      mouse.clicked = false;
    }

    AE.Save.tickAutosave(state, dt, logMsg);
  }

  function drawMinimap(){
    if (!showMinimap) return;
    const z = Zones[state.zoneId];
    const p = state.player;

    const mw = minimap.width, mh = minimap.height;
    mctx.clearRect(0,0,mw,mh);

    const mapW = z.map[0].length;
    const mapH = z.map.length;
    const sx = mw / mapW;
    const sy = mh / mapH;

    for (let y=0;y<mapH;y++){
      for (let x=0;x<mapW;x++){
        const ch = z.map[y][x];
        if (ch === "#") mctx.fillStyle = "rgba(255,255,255,.10)";
        else if (ch === "P") mctx.fillStyle = "rgba(120,180,255,.35)";
        else mctx.fillStyle = "rgba(255,255,255,.04)";
        mctx.fillRect(x*sx, y*sy, sx, sy);
      }
    }

    const tx = p.x / TILE;
    const ty = p.y / TILE;
    mctx.fillStyle = "rgba(255,255,255,.85)";
    mctx.beginPath(); mctx.arc(tx*sx, ty*sy, 3, 0, Math.PI*2); mctx.fill();
  }

  function draw(){
    const p = state.player;
    const z = Zones[state.zoneId];
    const camX = p.x - VIEW_W/2;
    const camY = p.y - VIEW_H/2;

    ctx.clearRect(0,0,VIEW_W,VIEW_H);

    const startTx = Math.floor(camX / TILE) - 1;
    const startTy = Math.floor(camY / TILE) - 1;
    const endTx = startTx + Math.ceil(VIEW_W / TILE) + 3;
    const endTy = startTy + Math.ceil(VIEW_H / TILE) + 3;

    for (let ty=startTy; ty<=endTy; ty++){
      for (let tx=startTx; tx<=endTx; tx++){
        const ch = z.map[ty]?.[tx] ?? "#";
        const x = tx*TILE - camX;
        const y = ty*TILE - camY;

        if (ch === "#"){
          ctx.fillStyle = "#121a24";
          ctx.fillRect(x,y,TILE,TILE);
          ctx.fillStyle = "#0b0f14";
          ctx.fillRect(x+3,y+3,TILE-6,TILE-6);
        } else {
          const noise = ((tx*928371 + ty*1237) % 7);
          ctx.fillStyle = noise < 2 ? "#0f1724" : noise < 4 ? "#0f1520" : "#101826";
          ctx.fillRect(x,y,TILE,TILE);

          if (ch === "P"){
            ctx.fillStyle = "rgba(120,180,255,.18)";
            ctx.fillRect(x+6,y+6,TILE-12,TILE-12);
          }
          if (ch === "H"){
            ctx.fillStyle = "rgba(120,255,170,.12)";
            ctx.beginPath(); ctx.arc(x+TILE/2,y+TILE/2,10,0,Math.PI*2); ctx.fill();
          }
          if (ch === "L"){
            ctx.fillStyle = "rgba(255,220,120,.10)";
            ctx.beginPath(); ctx.arc(x+TILE/2,y+TILE/2,10,0,Math.PI*2); ctx.fill();
          }
        }
      }
    }

    // NPCs
    for (const npc of listNPCsInZone()){
      const wx = npc.x*TILE + TILE/2;
      const wy = npc.y*TILE + TILE/2;
      const x = wx - camX, y = wy - camY;
      ctx.fillStyle = "#88c0ff";
      ctx.fillRect(x-10, y-14, 20, 28);
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.fillText("!", x-2, y-20);
      if (debug){
        ctx.strokeStyle = "rgba(255,255,255,.25)";
        ctx.strokeRect(x-14, y-18, 28, 36);
      }
    }

    // pickups
    for (const pu of state.pickups){
      const x = pu.x - camX, y = pu.y - camY;
      if (pu.type === "HERB"){
        ctx.fillStyle = "rgba(120,255,170,.85)";
        ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill();
      } else if (pu.type === "LETTER"){
        ctx.fillStyle = "rgba(255,220,120,.9)";
        ctx.fillRect(x-6,y-5,12,10);
      }
    }

    // drops
    for (const d of state.drops){
      const x = d.x - camX, y = d.y - camY;
      if (d.type === "GOLD"){
        ctx.fillStyle = "#ffd36a";
        ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill();
      } else if (d.type === "HP_POT"){
        ctx.fillStyle = "#ff6a6a";
        ctx.fillRect(x-5,y-7,10,14);
      } else if (d.type === "MP_POT"){
        ctx.fillStyle = "#6aa8ff";
        ctx.fillRect(x-5,y-7,10,14);
      }
    }

    // enemies
    for (const e of state.enemies){
      const ed = EnemyDefs[e.type];
      const x = e.x - camX, y = e.y - camY;
      ctx.fillStyle = ed.boss ? "#b07cff" : "#7cff95";
      ctx.beginPath(); ctx.arc(x, y-6, 8, 0, Math.PI*2); ctx.fill();
      ctx.fillRect(x-10, y-6, 20, 18);

      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fillRect(x-16, y-26, 32, 4);
      ctx.fillStyle = "#ff4d4d";
      ctx.fillRect(x-16, y-26, 32*(e.hp/e.maxHP), 4);

      if (debug){
        ctx.strokeStyle = "rgba(255,255,255,.25)";
        ctx.strokeRect(x-9, y-9, 18, 18);
      }
    }

    // projectiles
    for (const pr of state.projectiles){
      const x = pr.x - camX, y = pr.y - camY;
      ctx.fillStyle = pr.kind === "ARROW" ? "#d7e2f0" : pr.kind === "FIREBOLT" ? "#ffb84d" : "#8ad1ff";
      ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill();
    }

    // player
    const px = p.x - camX, py = p.y - camY;
    ctx.fillStyle = p.classId === "WARRIOR" ? "#ff6a6a" : p.classId === "ARCHER" ? "#6affc8" : "#6aa8ff";
    ctx.beginPath(); ctx.arc(px, py-6, 8, 0, Math.PI*2); ctx.fill();
    ctx.fillRect(px-10, py-6, 20, 18);

    if (p.invulnT > 0){
      ctx.strokeStyle = "rgba(255,255,255,.5)";
      ctx.strokeRect(px-14, py-18, 28, 36);
    }
    if (debug){
      ctx.strokeStyle = "rgba(255,255,255,.25)";
      ctx.strokeRect(px-9, py-9, 18, 18);
    }

    // aim
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 10, 0, Math.PI*2); ctx.stroke();

    drawMinimap();
  }

  // ============ UI wiring ============
  function refreshAllUI(){
    ensureDerivedStats();
    AE.UI.renderHUD(ui, state);
    AE.UI.renderInventory(ui, state);
    AE.UI.renderQuests(ui, state);
    AE.UI.renderStats(ui, state);
    AE.UI.renderShop(ui, state);
  }

  function bindUI(){
    debugBtn.addEventListener("click", () => {
      debug = !debug;
      debugBtn.textContent = `Debug: ${debug ? "on" : "off"}`;
      ui.debugPanel.style.display = debug ? "block" : "none";
    });

    saveBtn.addEventListener("click", () => AE.Save.saveNow(state, logMsg));
    resetBtn.addEventListener("click", () => AE.Save.reset(logMsg));

    newBtn.addEventListener("click", () => {
      state = freshState(classSel.value);
      loadZone("HUB", null);
      ensureDerivedStats();
      logMsg(`🎮 Novo jogo (${ClassDefs[state.player.classId].name})`);
      AE.Save.saveNow(state, logMsg);
      refreshAllUI();
    });

    ui.shopPanel.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.getAttribute("data-act");
      const item = btn.getAttribute("data-item");
      if (act === "buy") buy(item);
      if (act === "sell") sell(item);
      refreshAllUI();
    });

    ui.invPanel.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.getAttribute("data-act");
      if (act === "use_hp") usePotion("HP");
      if (act === "use_mp") usePotion("MP");
      refreshAllUI();
    });

    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();

      if (k === "escape"){
        paused = !paused;
        if (paused){
          hideAllPanels();
          toggle(ui.pausePanel, true);
        } else {
          toggle(ui.pausePanel, false);
        }
      }

      if (k === " " && !paused) basicAttack();
      if (k === "q" && !paused) skill1();
      if (k === "e" && !paused) skill2();
      if (k === "z" && !paused) usePotion("HP");
      if (k === "x" && !paused) usePotion("MP");

      if (k === "i") toggle(ui.invPanel);
      if (k === "l") toggle(ui.questPanel);
      if (k === "c") toggle(ui.statsPanel);
      if (k === "b") toggle(ui.shopPanel);

      if (k === "m"){
        showMinimap = !showMinimap;
        ui.minimapWrap.style.display = showMinimap ? "block" : "none";
      }

      refreshAllUI();
    }, { passive:false });

    window.addEventListener("error", (e) => {
      console.error(e.error || e.message);
      logMsg("❌ Erro capturado (veja o console).");
    });
  }

  // ============ Main loop ============
  let lastT = now();
  let fpsAcc = 0, fpsCount = 0, fps = 0;

  function frame(){
    const t = now();
    let dt = (t - lastT)/1000;
    lastT = t;
    dt = clamp(dt, 0, 0.05);

    if (!paused) update(dt);
    draw();

    fpsAcc += dt; fpsCount++;
    if (fpsAcc >= 0.5){
      fps = Math.round(fpsCount / fpsAcc);
      fpsAcc = 0; fpsCount = 0;
      refreshAllUI();

      if (debug){
        const p = state.player;
        ui.debugBody.textContent =
`FPS: ${fps}
Zone: ${state.zoneId}
Pos: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}
HP/MP: ${p.hp.toFixed(1)}/${p.maxHP} • ${p.mp.toFixed(1)}/${p.maxMP}
CD atk: ${p.atkCD.toFixed(2)} • Q: ${p.skill1CD.toFixed(2)} • E: ${p.skill2CD.toFixed(2)}
Enemies: ${state.enemies.length} • Projectiles: ${state.projectiles.length} • Drops: ${state.drops.length} • Pickups: ${state.pickups.length}`;
      }
    }

    requestAnimationFrame(frame);
  }

  // ============ Boot ============
  function boot(){
    const loaded = AE.Save.load();
    if (loaded){
      state = loaded;
      state.inv = state.inv || newInventory();
      state.equipment = state.equipment || { weapon:null, armor:null };
      state.quests = state.quests || {};
      for (const qid of Object.keys(QuestDefs)){
        state.quests[qid] = state.quests[qid] || { state:"NOT_STARTED", progress:0, flags:{} };
      }
      state._dirty = false;
      state._saveCooldown = 0;
      state._autosaveT = 0;
      loadZone(state.zoneId, null);
      logMsg("📦 Save carregado.");
    } else {
      state = freshState(classSel.value);
      loadZone("HUB", null);
      logMsg("🆕 Save novo criado.");
      AE.Save.saveNow(state, logMsg);
    }

    ensureDerivedStats();
    bindUI();
    refreshAllUI();
    requestAnimationFrame(frame);
  }

  boot();
})();