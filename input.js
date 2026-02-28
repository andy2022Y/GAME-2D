(function(){
  "use strict";
  const AE = window.AE = window.AE || {};
  const keys = new Set();
  const mouse = { x:0, y:0, down:false, clicked:false };

  function bind(canvas, container){
    function setFocus(){ container.focus({ preventScroll:true }); }
    container.addEventListener("pointerdown", () => { setFocus(); mouse.down = true; mouse.clicked = true; });
    window.addEventListener("pointerup", () => { mouse.down = false; });

    container.addEventListener("pointermove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      mouse.x = (e.clientX - rect.left) * sx;
      mouse.y = (e.clientY - rect.top) * sy;
    });

    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (["arrowup","arrowdown","arrowleft","arrowright"," ","w","a","s","d"].includes(k)) e.preventDefault();
      keys.add(k);
    }, { passive:false });

    window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
    setTimeout(setFocus, 0);
  }

  AE.Input = { keys, mouse, bind };
})();