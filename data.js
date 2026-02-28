(function(){
  "use strict";
  const AE = window.AE = window.AE || {};
  const TILE = 32;

  const ClassDefs = {
    WARRIOR: { name:"Guerreiro", baseMaxHP:140, baseMaxMP:40, baseSpeed:155, atk:18, def:8, range:42 },
    ARCHER:  { name:"Arqueiro",  baseMaxHP:95,  baseMaxMP:55, baseSpeed:175, atk:14, def:4, range:280 },
    MAGE:    { name:"Mago",      baseMaxHP:80,  baseMaxMP:120,baseSpeed:160, atk:12, def:3, range:320 },
  };

  const EnemyDefs = {
    RAT:   { name:"Rato", maxHP:26,  speed:92,  atk:6,  def:0, xp:10, goldMin:1, goldMax:3,  dropPotionChance:0.28 },
    SLIME: { name:"Slime", maxHP:35, speed:85,  atk:8,  def:1, xp:12, goldMin:1, goldMax:4,  dropPotionChance:0.30 },
    WOLF:  { name:"Lobo Sombrio", maxHP:60, speed:110, atk:12, def:2, xp:22, goldMin:3, goldMax:8, dropPotionChance:0.25 },
    PLANT: { name:"Planta Cortante", maxHP:55, speed:70, atk:14, def:3, xp:20, goldMin:2, goldMax:7, dropPotionChance:0.28 },
    BOSS_ROOT: { name:"Guardião das Raízes", maxHP:260, speed:75, atk:22, def:5, xp:120, goldMin:25, goldMax:45, dropPotionChance:0.85, boss:true },
  };

  const Items = {
    HP_POT: { id:"HP_POT", name:"Poção de Vida", type:"consumable", healHP:60, price:12 },
    MP_POT: { id:"MP_POT", name:"Poção de Mana", type:"consumable", healMP:60, price:12 },
    SHORT_SWORD: { id:"SHORT_SWORD", name:"Espada Curta", type:"weapon", atk:6, price:45 },
    WOOD_BOW: { id:"WOOD_BOW", name:"Arco Simples", type:"weapon", atk:5, price:45 },
    WORN_STAFF: { id:"WORN_STAFF", name:"Cajado Gasto", type:"weapon", atk:5, price:45 },
    CLOTH_ARMOR: { id:"CLOTH_ARMOR", name:"Armadura de Tecido", type:"armor", def:3, price:40 },
    HERB: { id:"HERB", name:"Erva", type:"material", price:3 },
    LETTER: { id:"LETTER", name:"Carta", type:"quest", price:0 },
  };

  const ShopStock = [
    { itemId:"HP_POT", buy:12, sell:6 },
    { itemId:"MP_POT", buy:12, sell:6 },
    { itemId:"SHORT_SWORD", buy:45, sell:20 },
    { itemId:"WOOD_BOW", buy:45, sell:20 },
    { itemId:"WORN_STAFF", buy:45, sell:20 },
    { itemId:"CLOTH_ARMOR", buy:40, sell:18 },
  ];

  const QuestDefs = {
    Q1: { id:"Q1", title:"Ratos na Adega", desc:"Elimine 6 ratos e volte ao Guardião no HUB.",
      type:"KILL", target:"RAT", goal:6, reward:{ xp:70, gold:20, hpPot:1 } },
    Q2: { id:"Q2", title:"Ervas do Curandeiro", desc:"Colete 5 ervas na Floresta e entregue ao Curandeiro.",
      type:"FETCH", targetItem:"HERB", goal:5, reward:{ xp:80, gold:10, mpPot:1 } },
    Q3: { id:"Q3", title:"Carta Perdida", desc:"Converse com o Explorador, recupere a Carta na Floresta e entregue ao Mercador.",
      type:"DELIVERY", pickup:"LETTER", reward:{ xp:90, gold:25, itemId:"SHORT_SWORD" } },
  };

  function xpToNext(level){
    return Math.floor(60 + level*40 + level*level*10);
  }

  const Zones = {
    HUB: {
      id:"HUB", name:"• Santuário Partido",
      map: [
        "############################",
        "#............#.............#",
        "#............#.............#",
        "#..####......#.............#",
        "#..#..#......#.............#",
        "#..####......#.............#",
        "#............#.............#",
        "#............#.............#",
        "#............#.............#",
        "#............#.............#",
        "#............#.............#",
        "#............#.............#",
        "#............#.............#",
        "#............#.............#",
        "#............#.......P.....#",
        "############################",
      ],
      spawn: { x: 3*TILE, y: 3*TILE },
      portals: [{ x:22, y:14, to:"FOREST", toX:2, toY:2 }],
      enemies: [],
      npcs: [
        { id:"GUARDIAN", name:"Guardião", role:"QUEST_GIVER", x:6,  y:6 },
        { id:"HEALER",   name:"Curandeiro", role:"QUEST_HEALER", x:10, y:6 },
        { id:"MERCHANT", name:"Mercador", role:"SHOP", x:14, y:6 },
        { id:"EXPLORER", name:"Explorador", role:"QUEST_PICKUP", x:18, y:6 },
      ],
    },
    FOREST: {
      id:"FOREST", name:"• Floresta Arcana",
      map: [
        "############################",
        "#............#.............#",
        "#..####......#....#####....#",
        "#..#..#...........#...#....#",
        "#..#..#....H......#...#....#",
        "#..####...........#####....#",
        "#......H...................#",
        "#...........####...........#",
        "#...........#..#...........#",
        "#...........#..#.....L.....#",
        "#...........####...........#",
        "#..........................#",
        "#....#####........#####....#",
        "#....#...#........#...#....#",
        "#....#####....P...#####....#",
        "############################",
      ],
      spawn: { x: 2*TILE, y: 2*TILE },
      portals: [{ x:15, y:14, to:"HUB", toX:20, toY:14 }],
      enemies: [
        { type:"RAT", x:6, y:10, count:6 },
        { type:"SLIME", x:8, y:6, count:4 },
        { type:"WOLF", x:18, y:9, count:3 },
        { type:"PLANT", x:10, y:12, count:3 },
        { type:"BOSS_ROOT", x:22, y:5, count:1 },
      ],
      npcs: [],
    }
  };

  AE.Data = { TILE, ClassDefs, EnemyDefs, Items, ShopStock, QuestDefs, Zones, xpToNext };
})();