(function(){
  "use strict";
  const AE = window.AE = window.AE || {};
  const { clamp } = AE.Utils;

  const SAVE_KEY = "aetheris_save_codex_v1";
  const SAVE_VERSION = 1;

  function safeParse(raw){ try { return JSON.parse(raw); } catch { return null; } }
  function validate(obj){
    if (!obj || obj.version !== SAVE_VERSION) return false;
    if (!obj.player || !obj.zoneId) return false;
    if (!obj.inv || !obj.quests) return false;
    return true;
  }

  function load(){
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const obj = safeParse(raw);
    if (!validate(obj)) return null;
    return obj;
  }

  function saveNow(state, uiLog){
    try{
      const snapshot = structuredClone(state);
      delete snapshot._dirty;
      delete snapshot._saveCooldown;
      delete snapshot._autosaveT;
      localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
      if (uiLog) uiLog("✅ Jogo salvo.");
      state._dirty = false;
    }catch(e){
      console.error(e);
      if (uiLog) uiLog("⚠️ Falha ao salvar (sem travar).");
    }
  }

  function reset(uiLog){
    localStorage.removeItem(SAVE_KEY);
    if (uiLog) uiLog("🧹 Save resetado.");
  }

  function markDirty(state){
    state._dirty = true;
    state._saveCooldown = 0.4;
  }

  function tickAutosave(state, dt, uiLog){
    state._autosaveT = (state._autosaveT ?? 0) + dt;
    if (state._autosaveT >= 20){
      state._autosaveT = 0;
      saveNow(state, uiLog);
      return;
    }
    if (state._dirty){
      state._saveCooldown = clamp((state._saveCooldown ?? 0) - dt, 0, 999);
      if (state._saveCooldown <= 0) saveNow(state, uiLog);
    }
  }

  AE.Save = { SAVE_VERSION, load, saveNow, reset, markDirty, tickAutosave };
})();