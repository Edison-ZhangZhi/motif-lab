/* ============================================================
 * rules.js — 作曲规则器（生成后、调度前的检测与修正层）
 * 依据 8 秒 MIDI 尸检报告的五条规则实现，纯逻辑、不依赖音源：
 *   1. 调性约束器：强拍=和弦音，弱拍=调内音阶，变化音级进解决
 *   2. 鼓密度预算：每风格小节鼓数上限 + 军鼓白名单 + kick≥90ms
 *   3. 力度塑形：力度绑定节拍位置（正拍+/弱拍−/乐句尾渐弱）
 *   4. kick-贝斯互锁：v15 起删除（与 app.js interlockPass 吸合语义互搏，保留吸合）
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
/* 限幅 snap：只在 ±lim 半音内微调，找不到则返回 null（>lim 的"纠正"视为设计意图，不动） */
const snapMidiLim = (midi, pool, lim) => {
  const pc = nearestPc(((midi % 12) + 12) % 12, pool);
  let best = null, bd = lim + 1;
  for (let m = midi - lim; m <= midi + lim; m++) {
    if (((m % 12) + 12) % 12 === pc && Math.abs(m - midi) < bd) { bd = Math.abs(m - midi); best = m; }
  }
  return best;
};

/* ---- 1. 调性约束 ---- */
function ruleTonality() {
  const scalePCs = MODES[state.mode].offsets.map(o => (state.keyRoot + o) % 12);
  /* 旋律：强拍→和弦音；弱拍→调内；调外音→最近调内音
     v16 优先级：设计意图 > 修正——_designSus(问句悬停)/_blue(蓝调音) 跳过；
     snap 只移动 ≤2 半音，>2 半音的偏差视为设计意图不动 */
  for (const e of melodyEvents) {
    if (e._designSus || e._blue) continue;
    const bar = Math.floor(e.beat / 4);
    const ch = chordAtBar(bar);
    const strong = Math.round(e.beat * 4) % 4 === 0;
    const pc = ((e.midi % 12) + 12) % 12;
    if (strong && !ch.pcs.includes(pc)) {
      const s = snapMidiLim(e.midi, ch.pcs, 2);
      if (s !== null) e.midi = s;
    } else if (!scalePCs.includes(pc)) {
      /* 半音经过音豁免：级进解决到下一音则保留（参考曲 31% 半音连接） */
      const nx = melodyEvents.find(x => x.beat > e.beat);
      const resolves = nx && Math.abs(nx.midi - e.midi) <= 2;
      if (!resolves) { const s = snapMidiLim(e.midi, scalePCs, 2); if (s !== null) e.midi = s; }
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
    /* 爵士概率 comping 军鼓（genDrums：step 3/7/11/14 的应答语汇）豁免白名单——
       它们是爵士 comping 的核心，不该被 backbeat 白名单裁掉 */
    if (st === 'jazz' && [3, 7, 11, 14].includes(Math.round(e.step16) % 16)) continue;
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
    /* 保粘合剂：shekere/shaker/ghost 是律动胶水——先删骨架装饰（hat/ride/ohat/crash 等），
       按 2 骨架 : 1 粘合剂 的配比才轮到粘合剂；骨架删完仍超限才兜底删粘合剂 */
    const isGlue = e => e.inst === 'shekere' || e.inst === 'shaker' || (e.inst === 'snare' && e.vel < 0.5);
    const isCore = e => e.inst === 'kick' || (e.inst === 'snare' && e.vel >= 0.5); /* 保骨架 */
    const skeleton = evs.filter(e => !isGlue(e) && !isCore(e)).sort((a, b) => a.vel - b.vel);
    const glue = evs.filter(isGlue).sort((a, b) => a.vel - b.vel);
    let over = evs.length - Math.floor(budget);
    let si = 0, gi = 0;
    while (over > 0 && si < skeleton.length) {
      for (let k = 0; k < 2 && over > 0 && si < skeleton.length; k++) { skeleton[si++]._drop = true; over--; }
      if (over > 0 && gi < glue.length) { glue[gi++]._drop = true; over--; }
    }
    while (over > 0 && gi < glue.length) { glue[gi++]._drop = true; over--; } /* 骨架用尽，粘合剂兜底 */
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
    if (e.inst === 'hat' || e.inst === 'shaker') e.vel = clamp(e.vel, 0.25, 1.0); /* v15：上限 0.8→1.0，不再压平生成层的正拍重音 */
  }
}

/* ---- 4. kick-贝斯互锁：已删除（v15） ----
   旧 ruleKickBassInterlock 把贝斯推离 kick，与 app.js interlockPass（贝斯吸合到 kick）直接互搏。
   保留吸合语义：互锁统一由 interlockPass 在调度前处理。 */

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
  ruleStagger();
}
