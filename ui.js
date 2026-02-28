(function(){
  "use strict";
  const AE = window.AE = window.AE || {};
  const { clamp, formatCompact } = AE.Utils;

  function init(){
    const ui = {
      zoneName: document.getElementById("zoneName"),
      hpTxt: document.getElementById("hpTxt"),
      mpTxt: document.getElementById("mpTxt"),
      lvTxt: document.getElementById("lvTxt"),
      xpTxt: document.getElementById("xpTxt"),
      goldTxt: document.getElementById("goldTxt"),
      hpPotTxt: document.getElementById("hpPotTxt"),
      mpPotTxt: document.getElementById("mpPotTxt"),
      hpBar: document.getElementById("hpBar"),
      mpBar: document.getElementById("mpBar"),
      log: document.getElementById("log"),

      pausePanel: document.getElementById("pausePanel"),
      invPanel: document.getElementById("invPanel"),
      questPanel: document.getElementById("questPanel"),
      statsPanel: document.getElementById("statsPanel"),
      shopPanel: document.getElementById("shopPanel"),
      debugPanel: document.getElementById("debugPanel"),
      debugBody: document.getElementById("debugBody"),

      invBody: document.getElementById("invBody"),
      questBody: document.getElementById("questBody"),
      statsBody: document.getElementById("statsBody"),
      shopBody: document.getElementById("shopBody"),

      minimapWrap: document.getElementById("minimapWrap"),
      minimap: document.getElementById("minimap"),
    };

    function logMsg(s){
      const div = document.createElement("div");
      div.textContent = s;
      ui.log.prepend(div);
      while (ui.log.childNodes.length > 8) ui.log.removeChild(ui.log.lastChild);
    }

    function toggle(panel, force){
      const cur = panel.style.display !== "none" && panel.style.display !== "";
      const on = (force !== undefined) ? force : !cur;
      panel.style.display = on ? "block" : "none";
    }

    function hideAllPanels(){
      ui.pausePanel.style.display = "none";
      ui.invPanel.style.display = "none";
      ui.questPanel.style.display = "none";
      ui.statsPanel.style.display = "none";
      ui.shopPanel.style.display = "none";
    }

    return { ui, logMsg, toggle, hideAllPanels };
  }

  function renderHUD(ui, state){
    const p = state.player;
    const z = AE.Data.Zones[state.zoneId];
    ui.zoneName.textContent = z?.name ?? "";
    ui.hpTxt.textContent = `${Math.ceil(p.hp)}/${p.maxHP}`;
    ui.mpTxt.textContent = `${Math.ceil(p.mp)}/${p.maxMP}`;
    ui.lvTxt.textContent = `${p.level}`;
    ui.xpTxt.textContent = `${formatCompact(p.xp)}/${formatCompact(AE.Data.xpToNext(p.level))}`;
    ui.goldTxt.textContent = `${formatCompact(p.gold)}`;
    ui.hpPotTxt.textContent = `${p.potions.hp}`;
    ui.mpPotTxt.textContent = `${p.potions.mp}`;
    ui.hpBar.style.width = `${clamp((p.hp/p.maxHP)*100,0,100)}%`;
    ui.mpBar.style.width = `${clamp((p.mp/p.maxMP)*100,0,100)}%`;
  }

  function card(title, bodyHtml, actionHtml){
    return `<div class="card"><div class="grid2"><div><strong>${title}</strong><div style="margin-top:4px">${bodyHtml}</div></div><div>${actionHtml||""}</div></div></div>`;
  }
  function actionBtn(text, act){ return `<button data-act="${act}">${text}</button>`; }

  function renderInventory(ui, state){
    const { Items } = AE.Data;
    const rows = [];
    rows.push(card(`Poção de Vida`, `Qtd: ${state.player.potions.hp}`, actionBtn("Usar (Z)", "use_hp")));
    rows.push(card(`Poção de Mana`, `Qtd: ${state.player.potions.mp}`, actionBtn("Usar (X)", "use_mp")));
    for (const slot of state.inv.slots){
      if (!slot) continue;
      const it = Items[slot.itemId];
      rows.push(card(it?.name ?? slot.itemId, `Qtd: ${slot.qty}`, ""));
    }
    ui.invBody.innerHTML = rows.join("");
  }

  function renderQuests(ui, state){
    const { QuestDefs } = AE.Data;
    const cards = [];
    for (const qid of Object.keys(QuestDefs)){
      const def = QuestDefs[qid];
      const q = state.quests[qid];
      const st = q?.state ?? "NOT_STARTED";
      let extra = "";
      if (st === "NOT_STARTED") extra = "Ainda não iniciada.";
      if (st === "IN_PROGRESS") extra = q.progressText ?? "Em andamento.";
      if (st === "COMPLETED") extra = "Concluída! Volte ao NPC.";
      if (st === "TURNED_IN") extra = "Entregue.";
      cards.push(card(def.title, `<div class="muted">${def.desc}</div><div style="margin-top:6px">Status: <strong>${st}</strong></div><div class="muted" style="margin-top:6px">${extra}</div>`, ""));
    }
    ui.questBody.innerHTML = cards.join("");
  }

  function renderStats(ui, state){
    const p = state.player;
    const rows = [
      card("Classe", `${AE.Data.ClassDefs[p.classId].name}`, ""),
      card("Level", `${p.level}`, ""),
      card("Velocidade", `${p.speed.toFixed(1)} (cap no 100)`, ""),
      card("ATK / DEF", `${p.atk} / ${p.def}`, ""),
      card("Crítico", `Chance (bruta/efetiva): ${p.critChanceRaw.toFixed(1)}% / ${p.critChance.toFixed(1)}%<br>Dano crítico (bruto/efetivo): ${p.critDmgRaw.toFixed(1)}% / ${p.critDmg.toFixed(1)}%`, ""),
    ];
    ui.statsBody.innerHTML = rows.join("");
  }

  function renderShop(ui, state){
    const { ShopStock, Items } = AE.Data;
    const rows = [];
    rows.push(`<div class="card"><div class="muted">Gold atual: <strong>${formatCompact(state.player.gold)}</strong></div></div>`);
    for (const s of ShopStock){
      const it = Items[s.itemId];
      rows.push(`<div class="card"><div class="grid3"><div><strong>${it.name}</strong><div class="muted">Comprar: ${s.buy} • Vender: ${s.sell}</div></div><button data-act="buy" data-item="${s.itemId}">Comprar</button><button data-act="sell" data-item="${s.itemId}">Vender</button></div></div>`);
    }
    ui.shopBody.innerHTML = rows.join("");
  }

  AE.UI = { init, renderHUD, renderInventory, renderQuests, renderStats, renderShop };
})();