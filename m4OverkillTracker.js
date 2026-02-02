// M4OverkillTracker - CT 1.8.9 (Hypixel SkyBlock M4)
// Robust Overkill tracking:
// - Window ON: (7,77,34) coal -> sea_lantern (30 kills reached)
// - Window OFF + summary: sea_lantern -> coal (bear dead/reset)
// - Kill only if: seen "§e0§c❤" (as "$e0$c❤") THEN entity disappears within 80-900ms
// - Despawn w/o 0❤ in last 1000ms => LOST (not kill)
// - Spirit Bear excluded always
//
// Commands: /m4ok, /m4dbg, /m4dbg dump, /m4test, /m4reset

let modEnabled = true;
let debugEnabled = false;

const LAST_BLOCK = { x: 7, y: 77, z: 34 };

let capReached = false;
let lastBlockState = null;

const CONFIRM_MIN_MS = 80;
const CONFIRM_MAX_MS = 900;
const LOST_WINDOW_MS = 1000;

// counts (per phase)
let totalOverkills = 0;
let lostCount = 0;
let uncertainCount = 0;

const counts = {
  Bat: 0,
  Bull: 0,
  Chicken: 0,
  Rabbit: 0,
  Sheep: 0,
  Wolf: 0,
};

function resetCounters() {
  totalOverkills = 0;
  lostCount = 0;
  uncertainCount = 0;
  for (const k in counts) counts[k] = 0;
}

function dbg(msg) {
  if (!debugEnabled) return;
  ChatLib.chat(`&6[M4DBG]&r ${msg}`);
}

function getBlockRegName(x, y, z) {
  try {
    const b = World.getBlockAt(x, y, z);
    return b?.type?.registryName ?? "";
  } catch (e) {
    return "";
  }
}

function printSummary() {
  ChatLib.chat(
    `&7M4 Overkills: total=${totalOverkills} | bats=${counts.Bat} | cows=${counts.Bull} | chickens=${counts.Chicken} | rabbits=${counts.Rabbit} | sheep=${counts.Sheep} | wolves=${counts.Wolf} | lost=${lostCount} | uncertainDeaths=${uncertainCount}`
  );
}

function hasZeroHeart(name) {
  return /§e0§c❤$/.test(name);
}

// --- Your proven matching approach ---
const animalsMap = {
  "spirit bat": "Bat",
  "spirit bull": "Bull",
  "spirit wolf": "Wolf",
  "spirit rabbit": "Rabbit",
  "spirit sheep": "Sheep",
  "spirit chicken": "Chicken",
};

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildColoredRegex(phrase) {
  const color = "(?:§.)*";
  const parts = phrase.split(" ");
  const charPattern = (segment) => segment
    .split("")
    .map((ch) => `${color}${escapeRegex(ch)}`)
    .join("");
  return new RegExp(
    parts.map((segment) => `${charPattern(segment)}${color}`).join(`${color}\\s+${color}`),
    "i"
  );
}

const animalsPatterns = Object.keys(animalsMap).map((phrase) => ({
  phrase,
  mobType: animalsMap[phrase],
  regex: buildColoredRegex(phrase),
}));

const spiritBearRegex = buildColoredRegex("spirit bear");

// tracked entities keyed by entityId
// id -> { mobType, lastSeenMs, deathSeenMs }
let tracked = {};

// ring coords (for /m4test killcount)
const ringCoordList = [
  [-2, 77, 33], [-7, 77, 32], [-13, 77, 28], [-17, 77, 24], [-21, 77, 18],
  [-23, 77, 13], [-24, 77, 7], [-24, 77, 2], [-23, 77, -4], [-21, 77, -9],
  [-17, 77, -14], [-12, 77, -19], [-6, 77, -22], [-1, 77, -23], [5, 77, -24],
  [10, 77, -24], [16, 77, -22], [21, 77, -19], [27, 77, -15], [30, 77, -10],
  [32, 77, -5], [34, 77, 1], [34, 77, 7], [33, 77, 12], [31, 77, 18],
  [28, 77, 23], [23, 77, 28], [18, 77, 31], [12, 77, 33], [7, 77, 34],
];
const maxKills = ringCoordList.length;

function getRingKillCount() {
  let k = 0;
  for (let i = 0; i < ringCoordList.length; i++) {
    const [x, y, z] = ringCoordList[i];
    if (getBlockRegName(x, y, z) === "minecraft:sea_lantern") k++;
  }
  return k;
}

// -----------------------
// State machine (tick)
// -----------------------
register("tick", () => {
  if (!modEnabled) return;

  const nowBlock = getBlockRegName(LAST_BLOCK.x, LAST_BLOCK.y, LAST_BLOCK.z);

  if (lastBlockState === null) {
    lastBlockState = nowBlock;
    if (nowBlock === "minecraft:sea_lantern") capReached = true; // loaded mid-window
    return;
  }

  // COAL -> SEA_LANTERN : start window
  if (!capReached && lastBlockState === "minecraft:coal_block" && nowBlock === "minecraft:sea_lantern") {
    capReached = true;
    dbg("CAP reached (30). Overkill window ON. Resetting counters/tracking.");
    resetCounters();
    tracked = {};
  }

  // SEA_LANTERN -> COAL : end window + summary
  if (capReached && lastBlockState === "minecraft:sea_lantern" && nowBlock === "minecraft:coal_block") {
    dbg("Reset detected (bear dead). Printing summary.");
    printSummary();
    capReached = false;
    resetCounters();
    tracked = {};
  }

  lastBlockState = nowBlock;
});

// ------------------------------------------
// Main scan loop (packetReceived like yours)
// ------------------------------------------
register("packetReceived", () => {
  if (!modEnabled) return;

  const now = Date.now();
  const entities = World.getAllEntities() || [];
  const seen = new Set();

  // small debug counters
  let matchedSpirit = 0;
  let sawDeadTail = 0;

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const name = e.getName();
    if (!name) continue;

    // exclude Spirit Bear always
    if (spiritBearRegex.test(name)) continue;

    let mobType = null;
    for (let j = 0; j < animalsPatterns.length; j++) {
      const pattern = animalsPatterns[j];
      if (pattern.regex.test(name)) {
        mobType = pattern.mobType;
        break;
      }
    }
    if (!mobType) continue;

    matchedSpirit++;

    // stable key
    const id = e.getEntity().getEntityId();
    seen.add(id);

    if (!tracked[id]) {
      tracked[id] = { mobType, lastSeenMs: now, deathSeenMs: 0 };
    } else {
      tracked[id].lastSeenMs = now;
    }

    // DeathCandidate EXACT like yours
    if (hasZeroHeart(name)) {
      sawDeadTail++;
      if (tracked[id].deathSeenMs === 0) tracked[id].deathSeenMs = now;
    }
  }

  // Process disappeared entities (confirmation / lost)
  for (const idStr in tracked) {
    const id = Number(idStr);
    if (seen.has(id)) continue;

    const t = tracked[id];
    const dt = t.deathSeenMs ? (now - t.deathSeenMs) : null;

    if (t.deathSeenMs && dt >= CONFIRM_MIN_MS && dt <= CONFIRM_MAX_MS) {
      if (capReached) {
        totalOverkills++;
        counts[t.mobType]++;
      }
      if (debugEnabled) dbg(`CONFIRMED ${t.mobType} id=${id} dt=${dt}ms cap=${capReached}`);
    } else if (t.deathSeenMs && dt < LOST_WINDOW_MS) {
      if (capReached) uncertainCount++;
      if (debugEnabled) dbg(`UNCERTAIN ${t.mobType} id=${id} dt=${dt}ms cap=${capReached}`);
    } else {
      if (capReached) lostCount++;
      if (debugEnabled) dbg(`LOST ${t.mobType} id=${id} cap=${capReached}`);
    }

    delete tracked[id];
  }

  if (debugEnabled) {
    dbg(`scan: entities=${entities.length} matchedSpirit=${matchedSpirit} deadTailSeen=${sawDeadTail} trackedNow=${Object.keys(tracked).length} cap=${capReached}`);
  }
}).setPacketClass(net.minecraft.network.play.server.S32PacketConfirmTransaction);

// -----------------------
// Commands
// -----------------------
register("command", (arg) => {
  const a = (arg ?? "").toLowerCase();
  if (a === "on") modEnabled = true;
  else if (a === "off") modEnabled = false;
  else modEnabled = !modEnabled;
  ChatLib.chat(`&7M4OverkillTracker: ${modEnabled ? "&aON" : "&cOFF"}`);
}).setName("m4ok");

register("command", (sub) => {
  const s = (sub ?? "").toLowerCase();
  if (s === "on") debugEnabled = true;
  else if (s === "off") debugEnabled = false;
  else if (s === "dump") {
    const blk = getBlockRegName(LAST_BLOCK.x, LAST_BLOCK.y, LAST_BLOCK.z) || "(unloaded)";
    const kills = getRingKillCount();
    ChatLib.chat(
      `&6[M4DBG]&r block(7,77,34)=${blk} | kills=${kills}/${maxKills} | capReached=${capReached} | tracked=${Object.keys(tracked).length} | enabled=${modEnabled}`
    );
    return;
  } else {
    debugEnabled = !debugEnabled;
  }
  ChatLib.chat(`&7Debug: ${debugEnabled ? "&aON" : "&cOFF"}`);
}).setName("m4dbg");

register("command", () => {
  const blk = getBlockRegName(LAST_BLOCK.x, LAST_BLOCK.y, LAST_BLOCK.z) || "(unloaded)";
  const kills = getRingKillCount();
  ChatLib.chat(`&7M4Test: block=${blk} | kills=${kills}/${maxKills} | capReached=${capReached} | tracked=${Object.keys(tracked).length}`);
}).setName("m4test");

register("command", () => {
  capReached = false;
  lastBlockState = null;
  tracked = {};
  resetCounters();
  ChatLib.chat("&eM4OverkillTracker reset.");
}).setName("m4reset");

ChatLib.chat(`&7M4OverkillTracker loaded. /m4ok ${modEnabled ? "&aON" : "&cOFF"}&7, /m4dbg to debug.`);
