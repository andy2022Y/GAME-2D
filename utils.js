(function(){
  "use strict";
  const AE = window.AE = window.AE || {};
  AE.Utils = {
    clamp(v,a,b){ return Math.max(a, Math.min(b,v)); },
    dist2(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; },
    now(){ return performance.now(); },
    randInt(min,max){ return min + Math.floor(Math.random()*(max-min+1)); },
    rand(){ return Math.random(); },
    id(){
      if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
      return (Date.now().toString(36) + Math.random().toString(36).slice(2));
    },
    formatCompact(n){
      if (!Number.isFinite(n)) return "∞";
      const abs = Math.abs(n);
      if (abs < 1000) return String(Math.floor(n));
      const units = ["K","M","B","T","Qa","Qi"];
      let u=-1, v=abs;
      while (v >= 1000 && u < units.length-1){ v/=1000; u++; }
      const sign = n < 0 ? "-" : "";
      return sign + v.toFixed(v>=100?0:v>=10?1:2) + units[u];
    }
  };
})();