/* ============================================================
 * rules.js — 作曲规则器（生成后、调度前的检测与修正层）
 * 依据 8 秒 MIDI 尸检报告的五条规则实现，纯逻辑、不依赖音源：
 *   1. 调性约束器：强拍=和弦音，弱拍=调内音阶，变化音级进解决
 *   2. 鼓密度预算：每风格小节鼓数上限 + 军鼓白名单 + kick≥90ms
 *   3. 力度塑形：力度绑定节拍位置（正拍+/弱拍−/乐句尾渐弱）
 *   4. kick-贝斯互锁：<30ms 的贝斯 onset 后移或休止
 *   5. 织体错峰：前奏/尾奏键盘退出只留 Pad；Pad 换和弦延迟跟进
 * ============================================================ */
'use strict';

/* ---- 工具 ---- */
const nearestPc = (pc, pool) => {
  let best = pool[0], bd = 99;
  for (const c of pool) {
    const d = Math.min(Math.abs(c - pc), 12 - Math.abs(c - pc));
    if (d < bd) { bd = d; best = c; }
  }
  return best;
};
const snapMidi = (midi, pool) => {
  const pc = nearestPc(((midi % 12) + 12) % 12, pool);
  let best = midi, bd = 99;
  for (let m = midi - 6; m <= midi + 6; m++) {
    if (((m % 12) + 12) % 12 === pc && Math.abs(m - midi) < bd) { bd = Math.abs(m - midi); best = m; }
  }
  return best;
};

/* ---- 1. 调性约束 ---- */
function ruleTonality() {
  const scalePCs = MODES[state.mode].offsets.map(o => (state.keyRoot + o) % 12);
  /* 旋律：强拍→和弦音；弱拍→调内；调外音→最近调内音 */
  for (const e of melodyEvents) {
    const bar = Math.floor(e.beat / 4);
    const ch = chordAtBar(bar);
    const strong = Math.round(e.beat * 4) % 4 === 0;
    const pc = ((e.midi % 12) + 12) % 12;
    if (strong && !ch.pcs.includes(pc)) {
      e.midi = snapMidi(e.midi, ch.pcs);
    } else if (!scalePCs.includes(pc)) {
      /* 半音经过音豁免：级进解决到下一音则保留（参考曲 31% 半音连接） */
      const nx = melodyEvents.find(x => x.beat > e.beat);
      const resolves = nx && Math.abs(nx.midi - e.midi) <= 2;
      if (!resolves) e.midi = snapMidi(e.midi, scalePCs);
    }
  }
  /* 贝斯：变化音（调外）只允许级进解决到和弦音，否则修正为和弦音 */
  for (let i = 0; i < bassEvents.length; i++) {
    const e = bassEvents[i];
    const pc = ((e.midi % 12) + 12) % 12;
    if (scalePCs.includes(pc)) continue;
    const ch = chordAtBar(Math.floor(e.beat / 4));
    const next = bassEvents[i + 1];
    const resolves = next && Math.abs(next.midi - e.midi) <= 2 && ch.pcs.includes(((next.midi % 12) + 12) % 12);
    if (!resolves) e.midi = snapMidi(e.midi, ch.pcs);
  }
}

/* ---- 2. 鼓密度预算 ---- */
const DRUM_BUDGET = { rnb: 24, jazz: 16, rock: 22, bossa: 20, afro: 44, hiphop: 26, funk: 26, soul: 20, reggae: 16, afrobeats: 30 }; /* v4：afro 实测密度高（Fela busy kick+perc），trap hat 滚奏需要余量 */
const SNARE_WHITELIST = { rnb: [4, 8, 12], jazz: [4, 12], rock: [4, 7, 12], bossa: [3, 4, 6, 8, 11, 12, 14], afro: null, hiphop: [8], funk: [4, 12], soul: [4, 12], reggae: [8], afrobeats: [4, 12] }; /* v4：rnb 现代变体军鼓上 3；rock 副歌军鼓切分 */
function ruleDrumBudget() {
  const bars = totalBars();
  const minKickGapSteps = Math.max(1, Math.round(0.09 / secPer16())); /* kick ≥90ms 去连击 */
  /* kick 最小间隔 */
  const kicks = drumEvents.filter(e => e.inst === 'kick').sort((a, b) => a.step16 - b.step16);
  let last = -99;
  for (const e of kicks) {
    if (e.step16 - last < minKickGapSteps) e._drop = true;
    else last = e.step16;
  }
  /* 军鼓白名单（Afro 的 clave 声部豁免） */
  for (const e of drumEvents) {
    if (e.inst !== 'snare' || e.vel < 0.45) continue;
    const st = state.styles.length > 1 ? state.styles[Math.floor(e.step16 / 16) % state.styles.length] : state.styles[0];
    const wl = SNARE_WHITELIST[st];
    if (wl && e.kit && e.kit.snare !== 'clave' && !wl.includes(e.step16 % 16)) e._drop = true;
  }
  drumEvents = drumEvents.filter(e => !e._drop);
  /* 每小节预算 */
  for (let bar = 0; bar < bars; bar++) {
    const st = state.styles.length > 1 ? state.styles[bar % state.styles.length] : state.styles[0];
    const budget = (DRUM_BUDGET[st] || 22) * (state.structure === 'song' ? sectionAt(bar).energy * 0.6 + 0.5 : 1);
    let evs = drumEvents.filter(e => Math.floor(e.step16 / 16) === bar);
    if (evs.length <= budget) continue;
    evs = evs.sort((a, b) => a.vel - b.vel);
    let over = evs.length - Math.floor(budget);
    for (const e of evs) {
      if (over <= 0) break;
      if (e.inst === 'kick' || (e.inst === 'snare' && e.vel > 0.5)) continue; /* 保骨架 */
      e._drop = true; over--;
    }
  }
  drumEvents = drumEvents.filter(e => !e._drop);
}

/* ---- 3. 力度塑形（绑定节拍位置 + 乐句曲线） ---- */
function ruleVelocity() {
  for (const e of melodyEvents) {
    const s16 = Math.round(e.beat * 4);
    let v = e.vel;
    if (s16 % 8 === 0) v += 0.1;            /* 正拍重 */
    else if (s16 % 4 === 0) v += 0.05;      /* 次强拍 */
    else v *= 0.88;                          /* 弱拍轻 */
    const phraseTail = (e.beat % 16) > 14;  /* 乐句尾渐弱 */
    if (phraseTail) v *= 0.9;
    e.vel = clamp(v, 0.3, 1.0);
  }
  for (const e of bassEvents) {
    const s16 = Math.round(e.beat * 4);
    e.vel = clamp(e.vel * (s16 % 4 === 0 ? 1.0 : 0.8), 0.3, 1.0);
  }
  for (const e of keysEvents) {
    const s16 = Math.round(e.beat * 4);
    e.vel = clamp(e.vel * (s16 % 4 === 0 ? 1.08 : 0.85), 0.2, 0.9);
  }
  for (const e of drumEvents) {
    if (e.inst === 'snare' && e.vel < 0.5) e.vel = Math.min(e.vel, 0.38); /* 幽灵音量化 */
    if (e.inst === 'hat' || e.inst === 'shaker') e.vel = clamp(e.vel, 0.25, 0.8);
  }
}

/* ---- 4. kick-贝斯互锁：<30ms 后移（±2 步找空位），找不到则让位 ---- */
function ruleKickBassInterlock() {
  const gapSteps = Math.max(1, Math.round(0.03 / secPer16()));
  const kickSteps = new Set(drumEvents.filter(e => e.inst === 'kick').map(e => e.step16));
  const occupied = new Set(bassEvents.map(e => Math.round(e.beat * 4)));
  const nearKick = s => { for (let k = s - gapSteps; k <= s + gapSteps; k++) if (kickSteps.has(k)) return true; return false; };
  for (const e of bassEvents) {
    const s = Math.round(e.beat * 4);
    if (e.b808 && e.slideTo !== undefined) continue; /* 808 抢拍滑音是有意为之，不被互锁挪走 */
    if (!nearKick(s)) continue;
    let placed = false;
    for (const cand of [s + 1, s + 2, s - 1, s - 2]) {
      if (cand < 0) continue;
      if (!nearKick(cand) && !occupied.has(cand) && (cand % 16) < 15) {
        occupied.delete(s); e.beat = cand / 4; occupied.add(cand);
        placed = true; break;
      }
    }
    if (!placed) e.vel *= 0.5; /* 无空位则让位（配合调度期 ducking） */
  }
  bassEvents.sort((a, b) => a.beat - b.beat);
}

/* ---- 5. 织体错峰：低能量段键盘退出；Pad 换和弦延迟跟进 ---- */
function ruleStagger() {
  const bars = totalBars();
  for (let bar = 0; bar < bars; bar++) {
    const en = sectionAt(bar).energy;
    if (en < 0.4) {
      /* 前奏/尾奏：键盘 comping 退出，只留 Pad 长音 */
      keysEvents = keysEvents.filter(e => Math.floor(e.beat / 4) !== bar);
      synthEvents.forEach(e => { if (Math.floor(e.beat / 4) === bar) e.vel = Math.min(e.vel, 0.3); });
    }
  }
  /* Pad 换和弦延迟 0.06s 跟进键盘（和声乐器不再齐换和弦） */
  for (const e of synthEvents) {
    if (Math.abs(e.beat % 4) < 0.01) e.padLag = 0.06;
  }
}

/* ---- 总入口 ---- */
function applyCompositionRules() {
  ruleTonality();
  ruleDrumBudget();
  ruleVelocity();
  ruleKickBassInterlock();
  ruleStagger();
}
