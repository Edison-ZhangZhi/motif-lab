/* ============================================================
 * app.js — 状态 / 生成算法 / 音频引擎 / UI
 * ============================================================ */
'use strict';

/* ================= 工具 ================= */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/* ================= 全局状态 ================= */
const state = {
  styles: ['rnb'],
  keyRoot: 9,            // 默认 A
  mode: 'major',
  bpm: 92, swing: 0.18, master: 0.8,
  presetId: 'rnb-1625',
  slots: [],             // { d, acc, q }
  motiveText: '',
  seedSalt: 0,
  layers: {
    guitar: { on: true, vol: 0.8, patch: 'crunch' },
    keys:   { on: true, vol: 0.55, patch: 'comp' },
    bass:   { on: true, vol: 0.7, patch: 'auto' },
    drums:  { on: true, vol: 0.8, patch: 'auto' },
    synth:  { on: true, vol: 0.45, patch: 'halo' },
  },
  playing: false,
  audioReady: false,
  melodyEdited: false,
  sfBase: (typeof localStorage !== 'undefined' && localStorage.getItem('motif_sf')) || 'soundfont2',
  perf: (typeof localStorage !== 'undefined' && localStorage.getItem('motif_perf') === '1'),
  structure: 'loop',
  tone: (typeof localStorage !== 'undefined' && JSON.parse(localStorage.getItem('motif_tone') || '{}')) || {},
  toneCustom: (typeof localStorage !== 'undefined' && JSON.parse(localStorage.getItem('motif_tonecustom') || '{}')) || {},
};

/* 派生数据 */
let chordTimeline = [];   // 每小节: { rootPC, rootMidi, qKey, name, roman, ext, iv[], pcs[], tonesMidi[], scalePCs[] }
let melodyEvents = [];    // { beat, midi, dur, vel }
let bassEvents = [];
let keysEvents = [];      // { beat, notes:[midi], dur, vel }
let synthEvents = [];     // 合成器 Pad { beat, notes:[midi], dur, vel }
let drumEvents = [];      // { step16, inst, vel }
let curSeed = 1;

/* ================= 和弦计算 ================= */
function autoQualityFor(slot, styleKeys, rng) {
  if (slot.q && slot.q !== 'auto') return slot.q;
  const base = MODES[state.mode].degQ[slot.d - 1];
  const grp = CHORDS[base].grp;
  /* 融合：按风格随机取延伸音色彩 */
  const styleKey = styleKeys[Math.floor(rng() * styleKeys.length)];
  const extTable = STYLES[styleKey].ext;
  const opts = extTable[grp] || [base];
  return opts.includes(base) && rng() < 0.25 ? base : pick(rng, opts);
}

function buildChordTimeline() {
  const rng = mulberry32(hashStr('chords' + state.presetId + state.keyRoot + state.mode));
  chordTimeline = state.slots.map(slot => {
    const qKey = autoQualityFor(slot, state.styles, rng);
    const rootPC = slotRootPC(slot, state.keyRoot, state.mode);
    const c = CHORDS[qKey];
    const pcs = c.iv.map(iv => (rootPC + iv) % 12);
    const tonesMidi = c.iv.map(iv => 48 + ((rootPC + iv) % 12) + 12 * Math.floor((rootPC + iv) / 12));
    const { roman, ext } = romanNumeral(slot, qKey);
    const rootMidi = 36 + ((rootPC - state.keyRoot) % 12 + 12) % 12; // 靠近 C2 区的根音参考
    return {
      slot, rootPC, qKey, iv: c.iv, pcs, tonesMidi, roman, ext,
      name: ((slot.acc || 0) < 0 ? pcNameFlat(rootPC) : pcName(rootPC)) + c.sym,
      scalePCs: scalePCsForChord(rootPC, qKey, state.keyRoot, state.mode),
      func: (DEG_FUNCTION[state.mode] || DEG_FUNCTION.major)[slot.d] || '',
    };
  });
}

/* ================= 动机文本解析 ================= */
function parseMotiveText(text) {
  const t = (text || '').toLowerCase();
  const p = {
    dir: 'wave', stepP: 0.62, density: 0.5, regLo: 62, regHi: 84,
    durBias: 0.5, rep: 0.5, blue: false, synco: 0.5, maxLeap: 7, _set: new Set(),
  };
  const has = (...words) => words.some(w => t.includes(w));
  const set = (k, v) => { p[k] = v; p._set.add(k); };
  if (has('上行', '上升', '向上', '攀升', '爬升', 'up', 'ascend', 'climb', 'rise')) p.dir = 'up';
  if (has('下行', '下降', '向下', '坠落', '下滑', 'down', 'descend', 'fall')) p.dir = 'down';
  if (has('波浪', '起伏', '迂回', 'wave', 'arch', 'swell')) p.dir = 'wave';
  if (has('环绕', '盘旋', '绕回', 'hover', 'orbit')) p.dir = 'orbit';
  if (has('级进', '平稳', '平滑', '连贯', 'step', 'smooth', 'legato', 'flow')) { set('stepP', 0.85); p.maxLeap = 4; p._set.add('maxLeap'); }
  if (has('跳进', '跳跃', '大跳', 'leap', 'jump', 'arpeggio', 'arp')) { set('stepP', 0.3); p.maxLeap = 12; p._set.add('maxLeap'); }
  if (has('密集', '急促', '紧张', 'busy', 'dense', 'fast', 'run', '冲刺')) set('density', 0.85);
  if (has('稀疏', '舒缓', '松弛', '平静', '呼吸感', 'sparse', 'slow', 'calm', 'airy', 'space')) set('density', 0.25);
  if (has('高音', '高亢', '嘹亮', '尖', 'high', 'bright', 'soar')) { set('regLo', 67); set('regHi', 88); }
  if (has('低音', '低沉', '低吟', '闷', 'low', 'deep', 'dark', 'mellow')) { set('regLo', 55); set('regHi', 76); }
  if (has('长音', '绵延', '拖沓', '拖长', 'long', 'sustain', 'hold', 'pad')) set('durBias', 0.8);
  if (has('短促', '碎', '断奏', '干脆', 'short', 'staccato', 'choppy', 'stab')) set('durBias', 0.15);
  if (has('忧郁', '悲伤', '蓝调', '苦涩', 'sad', 'blue', 'melancholy', 'cry')) set('blue', true);
  if (has('明亮', '欢快', '阳光', 'uplift', 'happy', 'shine')) { set('blue', false); p.stepP = Math.min(0.9, p.stepP + 0.1); }
  if (has('律动', '放克', '摇摆', 'funk', 'groove', 'swing', 'bounce')) set('synco', 0.85);
  if (has('重复', '执拗', '顽固', 'loop', 'repeat', 'insist', 'ostinato', 'riff')) set('rep', 0.85);
  if (has('自由', '多变', '漫游', 'varied', 'wander', 'explore')) set('rep', 0.15);
  if (has('宽广', '宽', 'wide', 'broad')) { p.regLo -= 4; p.regHi += 4; p.maxLeap = Math.max(p.maxLeap, 9); }
  if (has('窄', '集中', 'narrow', 'tight')) { p.regLo += 3; p.regHi -= 3; p.maxLeap = Math.min(p.maxLeap, 5); }
  return p;
}
function motiveSeed() {
  const chordHash = state.slots.map(s => s.d + ':' + (s.acc || 0) + ':' + (s.q || 'auto')).join('|');
  return hashStr(state.motiveText + '|' + state.seedSalt + '|' + state.styles.join(',') + '|' + state.keyRoot + state.mode + '|' + chordHash);
}

/* ================= 旋律生成 ================= */
function midiPool(pcs, lo, hi) {
  const out = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(m % 12)) out.push(m);
  return out;
}

function genMelody() {
  const baseParams = parseMotiveText(state.motiveText);
  const rng = mulberry32(motiveSeed());
  /* 模板 RNG 不含和弦哈希：改和弦时动机轮廓保持稳定，仅音高适配 */
  const cellRng = mulberry32(hashStr('cell' + state.motiveText + '|' + state.seedSalt + '|' + state.styles.join(',') + '|' + state.keyRoot + state.mode));
  curSeed = motiveSeed();
  const bars = totalBars();
  const events = [];
  const mergeDna = (styleKey, p) => {
    const dna = STYLES[styleKey].mel;
    const out = Object.assign({}, p);
    for (const k of Object.keys(dna)) if (!p._set.has(k)) out[k] = dna[k];
    return out;
  };
  const firstStyle = state.styles.length > 1 ? state.styles[0] : state.styles[0];
  const firstParams = mergeDna(firstStyle, baseParams);

  /* 动机细胞作曲：2 小节一个乐句组，A A' B A'' */
  const GROUP = 2;
  const groups = Math.ceil(bars / GROUP);
  let lastCell = null;
  let prev = null;

  const chordAnchor = (chord, near, strongPref) => {
    const opts = chord.pcs.slice();
    let best = null, bd = 99;
    for (const pc of opts) {
      for (let m = firstParams.regLo; m <= firstParams.regHi; m++) {
        if (m % 12 !== pc) continue;
        const d = Math.abs(m - near) + (strongPref && (pc === chord.rootPC) ? -1.5 : 0);
        if (d < bd) { bd = d; best = m; }
      }
    }
    return best === null ? near : best;
  };

  for (let g = 0; g < groups; g++) {
    const bar0 = g * GROUP;
    if (bar0 >= bars) break;
    const styleKey = state.styles.length > 1 ? state.styles[bar0 % state.styles.length] : state.styles[0];
    const energy = sectionAt(bar0).energy;
    const params = mergeDna(styleKey, baseParams);
    const isAfro = styleKey === 'afro';

    /* 选细胞：复用(重复/呼应)或新选 */
    let cell;
    const reuse = lastCell && (isAfro ? (g % 2 === 1) : (cellRng() < params.rep));
    if (reuse && lastCell) {
      cell = { r: lastCell.r.slice(), iv: lastCell.iv.slice() };
      if (isAfro || rng() < 0.5) { /* 呼应：反向或变尾 */
        if (isAfro && g % 2 === 1) cell.iv = cell.iv.map(v => -v);
        else if (cellRng() < 0.6) cell.iv[cell.iv.length - 1] += (cellRng() < 0.5 ? 2 : -2);
      }
    } else {
      let pool = (CELL_LIB[styleKey] || CELL_LIB.rnb).slice();
      /* 文本偏好过滤：级进/跳进 */
      if (baseParams._set.has('stepP')) {
        const avg = c => c.iv.reduce((a, b) => a + Math.abs(b), 0) / c.iv.length;
        const wanted = baseParams.stepP > 0.7 ? pool.filter(c => avg(c) <= 3.5)
          : baseParams.stepP < 0.45 ? pool.filter(c => avg(c) >= 3) : pool;
        if (wanted.length) pool = wanted;
      }
      /* 密度限制 onset 数 */
      const maxOn = params.density > 0.6 ? 6 : params.density < 0.3 ? 2 : 4;
      const fit = pool.filter(c => c.r.length <= maxOn + 1);
      if (fit.length) pool = fit;
      /* 走向偏好 */
      const dirUp = baseParams.dir === 'up' ? 1 : baseParams.dir === 'down' ? -1 : 0;
      let tw = pool.map(c => {
        let w = c.w;
        const s = c.iv[c.iv.length - 1];
        if (dirUp > 0) w *= s >= 0 ? 1.8 : 0.6;
        if (dirUp < 0) w *= s <= 0 ? 1.8 : 0.6;
        return { c, w };
      });
      let sum = tw.reduce((a, b) => a + b.w, 0), pickV = cellRng() * sum;
      cell = tw[0].c;
      for (const t of tw) { pickV -= t.w; if (pickV <= 0) { cell = t.c; break; } }
      cell = { r: cell.r.slice(), iv: cell.iv.slice() };
    }
    lastCell = cell;

    /* 实例化：锚到本组和弦 */
    const ch0 = chordAtBar(bar0);
    const near = prev === null ? (params.regLo + params.regHi) / 2 : prev;
    const anchor = chordAnchor(ch0, near, true);
    if (prev === null) prev = anchor;

    /* 逐音放置 + 逐小节和弦重映射（保持音程轮廓，贴合新和弦） */
    const placed = [];
    cell.r.forEach((on16, i) => {
      const bar = bar0 + Math.floor(on16 / 16);
      if (bar >= bars) return;
      const on = on16 % 16;
      const chord = chordAtBar(bar);
      const rel = (anchor % 12) + cell.iv[i] - ch0.rootPC;   // 相对原和弦根
      let pc = ((chord.rootPC + rel) % 12 + 12) % 12;
      const strong = on % 4 === 0;
      if (!strong && !chord.scalePCs.includes(pc)) {
        /* 弱拍也要落在调式音阶内：跨和弦平移只保音程不保调性，
           小和弦的和弦音平移到主和弦可能变调外音（如 F#m 的 A → Amaj9 的 C） */
        let bestPc = pc, bd2 = 99;
        for (const spc of chord.scalePCs) {
          const d = Math.min(Math.abs(spc - pc), 12 - Math.abs(spc - pc));
          if (d < bd2) { bd2 = d; bestPc = spc; }
        }
        pc = bestPc;
      }
      if (strong && !chord.pcs.includes(pc)) {
        /* 强拍 snap 到最近和弦音 */
        let bestPc = pc, bd = 99;
        for (const cpc of chord.pcs) {
          const d = Math.min(Math.abs(cpc - pc), 12 - Math.abs(cpc - pc));
          if (d < bd) { bd = d; bestPc = cpc; }
        }
        pc = bestPc;
      }
      let m = null, bd2 = 99;
      for (let mm = params.regLo; mm <= params.regHi; mm++) {
        if (mm % 12 !== pc) continue;
        const d = Math.abs(mm - prev);
        if (d < bd2) { bd2 = d; m = mm; }
      }
      if (m === null) m = prev + cell.iv[i];
      placed.push({ beat: bar * 4 + on / 4, on16: on, midi: m, i });
      prev = m;
    });

    /* 加花（密度高时在和弦音间插经过音） */
    if (params.density > 0.55 && placed.length >= 2 && rng() < 0.6) {
      const a = placed[Math.floor(rng() * (placed.length - 1))];
      const b2 = placed[placed.indexOf(a) + 1];
      if (b2 && b2.beat - a.beat >= 0.75) {
        const midBeat = a.beat + (b2.beat - a.beat) / 2;
        const chord = chordAtBar(Math.floor(midBeat / 4));
        const pool2 = midiPool(chord.scalePCs, params.regLo, params.regHi);
        let best = null, bd3 = 99;
        for (const cand of pool2) { const d = Math.abs(cand - (a.midi + b2.midi) / 2); if (d < bd3) { bd3 = d; best = cand; } }
        if (best !== null) events.push({ beat: midBeat, midi: best, dur: 0.25, vel: 0.5, ghost: true });
      }
    }

    /* 高密度：组内二次陈述（整体+1小节，变化尾音），达成 4±0.5 音/小节 */
    if (params.density > 0.6 && placed.length) {
      cell.r.forEach((on16b, i) => {
        const bar = bar0 + Math.floor((on16b + 16) / 16);
        if (bar >= bars) return;
        const on = (on16b + 16) % 16;
        const chord = chordAtBar(bar);
        const rel = (anchor % 12) + cell.iv[i] - ch0.rootPC;
        let pc = ((chord.rootPC + rel) % 12 + 12) % 12;
        if (on % 4 === 0 && !chord.pcs.includes(pc)) pc = nearestPc(pc, chord.pcs);
        else if (on % 4 !== 0 && !chord.scalePCs.includes(pc)) pc = nearestPc(pc, chord.scalePCs);
        let m = null, bd2 = 99;
        for (let mm = params.regLo; mm <= params.regHi; mm++) {
          if (mm % 12 !== pc) continue;
          const d = Math.abs(mm - prev); if (d < bd2) { bd2 = d; m = mm; }
        }
        if (m !== null) { placed.push({ beat: bar * 4 + on / 4, on16: on, midi: m, i }); prev = m; }
      });
      placed.sort((a, b) => a.beat - b.beat);
    }
    /* 写入事件：句尾长音 + 分风格力度 */
    const isLastGroup = g === groups - 1;
    placed.forEach((p, idx) => {
      const strong = p.on16 % 4 === 0;
      const lastOfCell = idx === placed.length - 1;
      let dur16 = 2;
      if (lastOfCell) dur16 = isLastGroup ? Math.max(6, 16 - p.on16 - 4) : (params.durBias > 0.55 ? 6 : 4);
      if (params.durBias < 0.3) dur16 = Math.min(dur16, 2);
      dur16 = clamp(dur16, 1, 16 - p.on16);
      let vel = (strong ? 0.82 : 0.62) + rng() * 0.14;
      if (styleKey === 'rock') vel = strong ? 0.9 + rng() * 0.08 : vel * 0.82;
      else if (styleKey === 'bossa') vel *= 0.88 + 0.24 * (p.on16 / 16);
      else if (styleKey === 'rnb') vel *= 0.85 + 0.25 * (p.on16 / 16);
      if (idx === 0) vel += 0.06; // 动机头重音
      events.push({ beat: p.beat, midi: p.midi, dur: dur16 / 4, vel });
    });
  }

  /* 排序 + 终止：尾音落最后和弦根/三/五 */
  events.sort((a, b) => a.beat - b.beat);
  if (events.length) {
    const lastChord = chordAtBar(bars - 1);
    const final = events[events.length - 1];
    const options = lastChord.pcs.filter(pc => [0, 4, 7].some(iv2 => (lastChord.rootPC + iv2) % 12 === pc));
    const targetPCs = options.length ? options : lastChord.pcs;
    let best = final.midi, bd = 99;
    for (let m = final.midi - 6; m <= final.midi + 6; m++) {
      if (targetPCs.includes(m % 12) && Math.abs(m - final.midi) < bd) { bd = Math.abs(m - final.midi); best = m; }
    }
    final.midi = best;
  }
  melodyEvents = events;
  state._params = firstParams;
}

/* ================= 贝斯生成 ================= */
function genBass() {
  const rng = mulberry32(curSeed ^ 0xBEEF);
  const bars = totalBars();
  const ev = [];
  const styleKeys = state.styles;
  for (let bar = 0; bar < bars; bar++) {
    const chord = chordAtBar(bar);
    const nextChord = chordAtBar(bar + 1);
    const styleKey = styleKeys.length > 1 ? styleKeys[bar % styleKeys.length] : styleKeys[0];
    let pat = state.layers.bass.patch;
    if (pat === 'auto') pat = STYLES[styleKey].bass;
    const rootLo = 28 + ((chord.rootPC + 12 - 4) % 12); // E1 附近
    const r = rootLo, fifth = r + 7, oct = r + 12;
    const nextRoot = 28 + ((nextChord.rootPC + 12 - 4) % 12);
    const approach = nextRoot + (rng() < 0.5 ? -1 : 1) + (nextRoot + 1 > 43 ? -12 : 0);
    const push = (beat, midi, dur, vel) => ev.push({ beat: bar * 4 + beat, midi, dur, vel });

    if (pat === 'walk') {
      const third = r + (CHORDS[chord.qKey].iv[1] || 4);
      push(0, r, 0.95, 0.85);
      push(1, third, 0.95, 0.7);
      push(2, r + pick(rng, [4, 5, 9]), 0.95, 0.7);
      push(3, approach, 0.95, 0.75);
    } else if (pat === 'eighth') {
      for (let i = 0; i < 8; i++) {
      const bn = i * 0.5;
        const n = i % 4 === 2 ? fifth : (i % 8 === 6 ? oct : r);
        push(bn, n, 0.45, i % 2 === 0 ? 0.8 : 0.6);
      }
    } else if (pat === 'groove') {
      push(0, r, 0.9, 0.9);
      push(1.5, r, 0.4, 0.7);
      push(2.25, oct, 0.3, 0.65);
      push(3, fifth, 0.4, 0.7);
      push(3.75, r, 0.2, 0.5);
    } else if (pat === 'bossa') {
      push(0, r, 1.4, 0.85);
      push(1.5, fifth, 0.45, 0.7);
      push(2, oct, 0.9, 0.75);
      push(3.5, fifth, 0.45, 0.7);
    } else if (pat === 'riff' || state.layers.drums.patch === 'beach') {
      /* 沙滩 riff：附点固定音型反复（全曲律动来源） */
      push(0, r, 0.45, 0.85);
      push(0.75, r + 7, 0.2, 0.6);
      push(1.5, r, 0.35, 0.7);
      push(2.25, r + 12, 0.2, 0.55);
      push(3, r, 0.4, 0.7);
      push(3.5, r + 10, 0.25, 0.5);
    } else if (pat === 'hiphop') {
      /* 半速 808：第1拍长音 + 第3拍后滑向下一和弦根 */
      const nextChord = chordAtBar(bar + 1);
      const nextRoot = 28 + ((nextChord.rootPC + 12 - 4) % 12);
      push(0, r + 12, 1.9, 0.95);
      push(2.5, r + 19, 1.1, 0.7);
      ev[ev.length - 2].b808 = true;
      ev[ev.length - 1].b808 = true;
      ev[ev.length - 1].slideTo = clamp(nextRoot + 12, 30, 50);
      if (rng() < 0.4) { /* Future 式 3.75 拍抢拍 808 滑音 */
        push(3.75, r + 12, 0.2, 0.5);
        ev[ev.length - 1].b808 = true;
        ev[ev.length - 1].slideTo = clamp(nextRoot + 12, 30, 50);
      }
    } else { /* afro：弹性 16 分 Vamp */
      push(0, r, 0.4, 0.85);
      push(0.75, oct, 0.2, 0.55);
      push(1.5, r, 0.4, 0.7);
      push(2, fifth, 0.4, 0.7);
      push(2.5, r, 0.4, 0.65);
      push(3, r, 0.4, 0.7);
      push(3.75, oct, 0.2, 0.55);
    }
  }
  bassEvents = ev;
}

/* ================= 电钢琴生成 ================= */
function chooseVoicing(pcs, prevNotes) {
  /* 候选：各种转位 × 八度（音域 C3–C5），最小化声部移动 */
  const candidates = [];
  const uniq = Array.from(new Set(pcs));
  for (let rot = 0; rot < uniq.length; rot++) {
    const base = uniq.slice(rot).concat(uniq.slice(0, rot));
    for (let oct = 48; oct <= 60; oct += 12) {
      const notes = [];
      let prev = -1;
      for (const pc of base) {
        let m = oct + pc;
        while (m <= prev) m += 12;
        notes.push(m); prev = m;
      }
      if (notes[notes.length - 1] <= 81) candidates.push(notes);
    }
  }
  const cap = state.perf ? 3 : 4;
  if (!prevNotes) { const c = candidates[Math.floor(candidates.length / 2)] || candidates[0]; return c.slice(0, cap); }
  let best = candidates[0], bd = 1e9;
  for (const c of candidates) {
    const d = c.reduce((s, n, i) => s + Math.abs(n - (prevNotes[i] !== undefined ? prevNotes[i] : n)), 0);
    if (d < bd) { bd = d; best = c; }
  }
  return best.slice(0, cap);
}

/* 风格化 voicing：RnB 去根音保 3-7-9-13；Jazz shell(3-7)+延伸 */
function styleVoicingPcs(pcs, styleKey) {
  if (styleKey === 'rnb' && pcs.length > 4) {
    const noFifth = pcs.filter((pc, i) => i !== 2);
    return noFifth.length >= 3 ? noFifth : pcs;
  }
  if (styleKey === 'jazz') {
    const rest = pcs.slice(1);
    return rest.length >= 2 ? rest.slice(0, 4) : pcs;
  }
  return pcs;
}
function genKeys() {
  const rng = mulberry32(curSeed ^ 0xF00D);
  const bars = totalBars();
  const ev = [];
  const styleKeys = state.styles;
  let prevVoicing = null;
  const COMP_PATTERNS = [
    [[1, 2], [3, 2]], [[2, 2], [3.5, 1.5]], [[1.5, 2], [3, 2]],
    [[2, 4], [3.5, 1]], [[0.5, 2], [2.5, 2]], [[1, 1.5], [2.5, 2], [3.5, 1]],
  ];
  const BOSSA_KEYS = [[0, 2], [1.5, 2], [2.5, 2], [3, 2], [3.75, 1]];
  for (let bar = 0; bar < bars; bar++) {
    const chord = chordAtBar(bar);
    const keyForVoicing = state.styles.length > 1 ? state.styles[bar % state.styles.length] : state.styles[0];
    let voicing = chooseVoicing(styleVoicingPcs(chord.pcs, keyForVoicing), prevVoicing);
    prevVoicing = voicing;
    let patch = state.layers.keys.patch;
    const styleKey = styleKeys.length > 1 ? styleKeys[bar % styleKeys.length] : styleKeys[0];
    /* 跟随风格：伴奏乐器随风格切换（Rock 闷音刷弦 / Bossa 尼龙 batida / Afro 清音 chop） */
    if (patch === 'auto') {
      if (styleKey === 'rock') {
        const rootMidi = 40 + ((chord.rootPC + 3) % 12);
        const power = [rootMidi, rootMidi + 7, rootMidi + 12];
        for (let i = 0; i < 8; i++) {
          ev.push({ beat: bar * 4 + i * 0.5, notes: power, dur: 0.28, vel: i % 2 === 0 ? 0.62 : 0.48, inst: 'guitar:muted' });
        }
      } else if (styleKey === 'bossa') {
        for (const [b, d] of BOSSA_KEYS) ev.push({ beat: bar * 4 + b, notes: voicing, dur: Math.min(d, 4 - b), vel: 0.5 + rng() * 0.1, inst: 'guitar:nylon' });
      } else if (styleKey === 'afro') {
        const stabs = [[2, 1.5], [6, 1.5], [10, 1.5], [13, 1], [14, 2]];
        for (const [b, d] of stabs) ev.push({ beat: bar * 4 + b / 4, notes: voicing, dur: d / 4, vel: 0.42 + rng() * 0.14, inst: 'guitar:clean' });
      } else {
        for (const [b, d] of pick(rng, COMP_PATTERNS)) ev.push({ beat: bar * 4 + b, notes: voicing, dur: Math.min(d, 4 - b), vel: 0.5 + rng() * 0.15, inst: 'keys' });
      }
    } else if (patch === 'afro') {
      /* Fela 式交错 chop：反拍十六分 + 第4拍&的抢拍 */
      const stabs = [[2, 1.5], [6, 1.5], [10, 1.5], [13, 1], [14, 2]];
      for (const [b, d] of stabs) ev.push({ beat: bar * 4 + b / 4, notes: voicing, dur: d / 4, vel: 0.42 + rng() * 0.14, inst: 'keys' });
    } else if (patch === 'bossa' || (patch === 'comp' && styleKey === 'bossa' && rng() < 0.5)) {
      for (const [b, d] of BOSSA_KEYS) ev.push({ beat: bar * 4 + b, notes: voicing, dur: Math.min(d, 4 - b), vel: 0.55 + rng() * 0.1, inst: 'keys' });
    } else if (patch === 'pad') {
      ev.push({ beat: bar * 4, notes: voicing, dur: 3.8, vel: 0.42, inst: 'keys' });
    } else {
      for (const [b, d] of pick(rng, COMP_PATTERNS)) ev.push({ beat: bar * 4 + b, notes: voicing, dur: Math.min(d, 4 - b), vel: 0.5 + rng() * 0.15, inst: 'keys' });
    }
  }
  keysEvents = ev;
}

/* ================= 合成器 Pad 生成 ================= */
function genSynthPad() {
  const rng = mulberry32(curSeed ^ 0x5EED);
  const bars = totalBars();
  const ev = [];
  let prevVoicing = null;
  const patch = state.layers.synth.patch;
  for (let bar = 0; bar < bars; bar++) {
    const chord = chordAtBar(bar);
    const keyForVoicing = state.styles.length > 1 ? state.styles[bar % state.styles.length] : state.styles[0];
    const voicing = chooseVoicing(styleVoicingPcs(chord.pcs, keyForVoicing), prevVoicing);
    prevVoicing = voicing;
    if (patch === 'sweep') {
      /* Rock：隔小节低音铺底，给失真吉他让位 */
      if (bar % 2 === 0) ev.push({ beat: bar * 4, notes: voicing.slice(0, 2), dur: 7.6, vel: 0.32 + rng() * 0.06 });
    } else if (patch === 'warm') {
      /* Jazz/Bossa：2+2 呼吸式短铺，留出 walking bass 的空间 */
      ev.push({ beat: bar * 4, notes: voicing, dur: 1.85, vel: 0.28 + rng() * 0.06 });
      if (rng() < 0.6) ev.push({ beat: bar * 4 + 2, notes: voicing, dur: 1.7, vel: 0.24 + rng() * 0.05 });
    } else if (patch === 'halo') {
      /* Afro/Hip-Hop：长铺但减力减花，黑暗空间感 */
      ev.push({ beat: bar * 4, notes: voicing, dur: 3.9, vel: 0.22 + rng() * 0.05 });
      if (rng() < 0.12) ev.push({ beat: bar * 4 + 2, notes: voicing.map(n => Math.min(n + 12, 96)), dur: 0.5, vel: 0.12 });
    } else {
      /* choir 等：长音铺底，八度点缀降为 20% */
      ev.push({ beat: bar * 4, notes: voicing, dur: 3.9, vel: 0.3 + rng() * 0.08 });
      if (rng() < 0.2) ev.push({ beat: bar * 4 + 2, notes: voicing.map(n => Math.min(n + 12, 96)), dur: 0.5, vel: 0.15 });
    }
  }
  synthEvents = ev;
}

/* ================= 鼓生成 ================= */
function genDrums() {
  const rng = mulberry32((curSeed ^ 0xD00D) >>> 0);
  const bars = totalBars();
  const ev = [];
  const styleKeys = state.styles;
  for (let bar = 0; bar < bars; bar++) {
    const styleKey = styleKeys.length > 1 ? styleKeys[bar % styleKeys.length] : styleKeys[0];
    const energy = sectionAt(bar).energy;
    let patName = state.layers.drums.patch;
    if (patName === 'auto' || patName === '808') patName = STYLES[styleKey].drums;
    const P = DRUM_PATTERNS[patName] || DRUM_PATTERNS.rnb;
    const density = state.layers.drums.patch;
    const kit = DRUM_KITS[state.layers.drums.patch === '808' ? 's808' : state.layers.drums.patch === 'beach' ? 'beach' : styleKey] || DRUM_KITS.rnb;
    for (let s = 0; s < 16; s++) {
      const push = (inst, vel) => {
        const essential = inst === 'kick' || inst === 'snare';
        if (!essential && rng() > energy + 0.35) return; /* 低能量段裁掉装饰音 */
        ev.push({ step16: bar * 16 + s, inst, vel: vel * (0.65 + energy * 0.45), kit });
      };
      if (P.kick && P.kick[s]) push('kick', patName === 'jazz' ? 0.3 : (patName === 'bossa' ? 0.55 : (patName === 'afro' ? 0.7 : 1)));
      if (patName === 'jazz') {
        /* 爵士军鼓 = 反拍应答 comping，不是摇滚式 backbeat */
        if (P.snare && P.snare[s] && rng() < 0.35) push('snare', 0.5);
        if ((s === 3 || s === 7 || s === 11 || s === 14) && rng() < 0.22) push('snare', 0.32);
      } else if (P.snare && P.snare[s]) {
        push('snare', patName === 'bossa' ? 0.45 : 0.9);
      }
      if (P.ghost && P.ghost[s] && rng() < 0.5) push('snare', 0.38);
      if (P.hat && P.hat[s]) {
        if (density === 'lite' && s % 4 !== 0) continue;
        if (density === 'drive' && rng() < 0.3) { push('hat', 0.5); continue; }
        const hatBase = patName === 'beach' ? (s % 4 === 0 ? 0.62 : 0.4 + rng() * 0.18) : (s % 4 === 0 ? 0.85 : 0.6); /* 律动载体站出来 */
        push('hat', hatBase);
      }
      if (P.ohat && P.ohat[s] && density !== 'lite') push('ohat', 0.6);
      if (P.ride && P.ride[s]) push('ride', s % 4 === 0 ? 0.8 : 0.5);
      if (P.crash && P.crash[s] && (bar % 4 === 0 || (styleKey === 'rock' && energy > 0.55))) push('crash', styleKey === 'rock' ? 0.5 : 0.7);
      if (P.congaH && P.congaH[s]) push('congaH', 0.7);
      if (P.congaL && P.congaL[s]) push('congaL', 0.65);
      if (P.bell && P.bell[s]) push('bell', s % 4 === 0 ? 0.55 : 0.4);
      /* Fela 式 break：每 16 小节最后一拍全停 */
      if (styleKey === 'afro' && bar % 16 === 15 && s >= 12) {
        ev.filter(x => x.step16 === bar * 16 + s).forEach(x => { x._drop = true; });
      }
    }
    /* Rock：每 4 小节末加花进下一段（Nirvana/GNR 式） */
    if (styleKey === 'rock' && bar % 4 === 3 && bar !== bars - 1 && energy > 0.45) {
      for (let s = 12; s < 16; s++) ev.push({ step16: bar * 16 + s, inst: 'snare', vel: 0.45 + (s - 12) * 0.15, kit });
    }
    /* 结尾加花（Afro break 小节不加） */
    if (bar === bars - 1 && !(styleKey === 'afro' && bar % 16 === 15)) {
      for (let s = 12; s < 16; s++) ev.push({ step16: bar * 16 + s, inst: s % 2 ? 'snare' : 'hat', vel: 0.5 + (s - 12) * 0.12, kit });
    }
    /* Hip-Hop：32 分 hat 滚奏（每 2 小节随机一整拍）+ 偶发 16 分三连音顿奏 */
    if (styleKey === 'hiphop') {
      if (bar % 2 === 1) {
        const rollBeat = 4 * Math.floor(rng() * 4);
        for (let k = 0; k < 8; k++) ev.push({ step16: bar * 16 + rollBeat + k * 0.5, inst: 'hat', vel: 0.45 + k * 0.045, kit });
      }
      if (bar % 8 === 7 && rng() < 0.6) {
        for (let k = 0; k < 6; k++) ev.push({ step16: bar * 16 + 8 + k * (2 / 3), inst: 'hat', vel: 0.4 + k * 0.05, kit });
      }
    }
    /* 风格打击乐层：Afro 全十六分 shekere + 反拍 clap（力量鼓点）；Bossa/RnB 沙锤八分 */
    if (styleKey === 'afro') {
      for (let s = 0; s < 16; s++) {
        if (state.perf && s % 2 === 1) continue; /* 性能模式：shekere 减半 */
        if (bar % 16 === 15 && s >= 12) continue; /* Fela break：shekere 同停 */
        ev.push({ step16: bar * 16 + s, inst: 'shekere', vel: s % 4 === 0 ? 0.7 : 0.45, kit });
      }
      if (bar % 16 !== 15) {
        ev.push({ step16: bar * 16 + 4,  inst: 'clap', vel: 0.8, kit });
        ev.push({ step16: bar * 16 + 12, inst: 'clap', vel: 0.85, kit });
      }
    } else if (styleKey === 'bossa' || styleKey === 'rnb') {
      for (let s = 0; s < 16; s += 2) ev.push({ step16: bar * 16 + s, inst: 'shaker', vel: s % 4 === 0 ? 0.5 : 0.38, kit });
    }
  }
  drumEvents = ev.filter(x => !x._drop);
}

/* ============================================================
 * 音频引擎（Tone.js）
 * ============================================================ */
const AE = { ready: false, nodes: {} };

/* --- 效果器曲线与箱体脉冲响应 --- */
function driveCurve(amount) {
  const n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
function makeCabIR(dur = 0.22, decay = 5) {
  const ctx = Tone.getContext();
  const rate = ctx.sampleRate, len = Math.floor(rate * dur);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function buildAudio() {
  if (AE.ready) return;
  AE.master = new Tone.Volume(-2).connect(new Tone.Limiter(-1).toDestination());
  AE.masterMeter = new Tone.Meter({ normalRange: false, smoothing: 0.85 });
  AE.limiterRef = new Tone.Limiter(-1);
  /* master → meter 监听（并联，不影响信号链） */
  setTimeout(() => { try { AE.master.connect(AE.masterMeter); } catch (e) {} }, 0);
  /* 慢速 AGC：每 700ms 看一次均值，向 -14dB 靠拢，范围 ±6dB */
  setInterval(() => {
    if (!state.playing || !AE.masterMeter) return;
    let db = -60;
    try { const v = AE.masterMeter.getValue(); db = typeof v === 'number' ? v : -60; } catch (e) { return; }
    if (db < -45 || db > -3) return;
    const err = -11 - db; /* 瞬态音乐 RMS 目标抬高，鼓才剩得下头 */
    if (Math.abs(err) < 2.5) return;
    const cur = AE.master.volume.value;
    const next = Math.max(-14, Math.min(8, cur + Math.sign(err) * 0.8));
    AE.master.volume.value = next;
  }, 700);

  /* --- 旋律吉他（效果器链路）：
     双锯齿声源 → 电子管波形塑形前级 → 三段 EQ → 箱体 IR 卷积 → 压缩 → 反馈延迟 --- */
  AE.guitarVol = new Tone.Volume(-3).connect(AE.master);
  AE.guitarDelay = new Tone.FeedbackDelay('8n.', 0.28).connect(AE.guitarVol);
  /* 吉他 cab 卷积仅合成回退用：采样为主的时代先旁路省一个卷积器（手机 CPU） */
  AE.guitarComp = new Tone.Compressor(-16, 3).connect(AE.guitarDelay);
  AE.guitarEq = new Tone.EQ3({ low: -1, mid: 0.5, high: 2.5, lowFrequency: 220, highFrequency: 2400 }).connect(AE.guitarComp);
  AE.guitarPre = new Tone.WaveShaper(driveCurve(6), 2048).connect(AE.guitarEq);
  AE.guitar = new Tone.Synth({
    oscillator: { type: 'fatsawtooth', count: 2, spread: 22 },
    envelope: { attack: 0.012, decay: 0.22, sustain: 0.4, release: 0.35 },
    portamento: 0.045,
  }).connect(AE.guitarPre);

  /* --- 电钢琴：三角波 Poly + 颤音 + 合唱 + 混响 --- */
  AE.keysVol = new Tone.Volume(-6).connect(AE.master);
  const keysChorus = new Tone.Chorus(4, 2.5, 0.4).connect(AE.keysVol);
  AE.keysTremolo = new Tone.Tremolo(5, 0.22).connect(keysChorus);
  AE.keysTremolo.start();
  AE.keys = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.01, decay: 0.35, sustain: 0.25, release: 1.1 },
  }).connect(AE.keysTremolo);
  AE.keys.volume.value = -4;

  /* --- 贝斯：Mono 方波 + 低通 --- */
  AE.bassVol = new Tone.Volume(-4).connect(AE.master);
  AE.bass = new Tone.MonoSynth({
    oscillator: { type: 'square' },
    filter: { Q: 2, type: 'lowpass', rolloff: -24 },
    envelope: { attack: 0.008, decay: 0.3, sustain: 0.6, release: 0.2 },
    filterEnvelope: { attack: 0.004, decay: 0.2, sustain: 0.4, baseFrequency: 90, octaves: 2.6 },
  }).connect(AE.bassVol);

  /* --- 鼓组 --- */
  AE.drumsVol = new Tone.Volume(-6); /* 路由在音色链创建后建立 */
  AE.drumsComp = new Tone.Compressor(-14, 4); /* 力量感：鼓总线压缩 */
  AE.kick = new Tone.MembraneSynth({
    pitchDecay: 0.045, octaves: 6,
    envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.1 },
  }).connect(AE.drumsVol);
  AE.snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.17, sustain: 0 },
  }).connect(AE.drumsVol);
  AE.snareBody = new Tone.MembraneSynth({
    pitchDecay: 0.02, octaves: 3,
    envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
  }).connect(AE.drumsVol);
  AE.hat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.05, release: 0.02 },
    harmonicity: 5.1, modulationIndex: 24, resonance: 5000, octaves: 1.2,
  }).connect(AE.drumsVol);
  AE.hat.volume.value = -6; /* 兜底也要听得见 */
  AE.ride = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.35, release: 0.05 },
    harmonicity: 5.1, modulationIndex: 18, resonance: 3200, octaves: 1,
  }).connect(AE.drumsVol);
  AE.ride.volume.value = -8;
  AE.conga = new Tone.MembraneSynth({
    pitchDecay: 0.02, octaves: 3,
    envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
  }).connect(AE.drumsVol);
  AE.crash = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.8, release: 0.1 },
    harmonicity: 5.1, modulationIndex: 30, resonance: 4000, octaves: 1.5,
  }).connect(AE.drumsVol);
  AE.crash.volume.value = -8;

  /* --- 合成器 Pad 兜底链（采样未就绪时用）：锯齿波 → 移相器 → 大混响 --- */
  AE.synthVol = new Tone.Volume(-9).connect(AE.master);
  AE.padPhaser = new Tone.Phaser(0.4, 4, 400);
  AE.synthPad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.6, decay: 1.5, sustain: 0.5, release: 2.5 },
  }).connect(AE.padPhaser);

  /* --- 引擎 v2：全链仅 1 个混响 + 廉价双二阶滤波；卷积从 4 降到 1 --- */
  AE.masterVerb = new Tone.Reverb({ decay: 2.2, wet: 0.3 }).connect(AE.master);
  /* 吉他/键盘：失真→EQ→主总线 */
  AE.toneEqGuitar = new Tone.EQ3({ low: 0, mid: 0, high: 3 }).connect(AE.master);
  AE.toneDistGuitar = new Tone.Distortion(0).connect(AE.toneEqGuitar);
  AE.toneEqKeys = new Tone.EQ3({ low: 0, mid: 0, high: 2 }).connect(AE.master);
  AE.toneDistKeys = new Tone.Distortion(0).connect(AE.toneEqKeys);
  AE.toneFilterBass = new Tone.Filter(9000, 'lowpass').connect(AE.master);
  /* Pad：移相→EQ→主总线 */
  AE.toneEqPad = new Tone.EQ3({ low: 0, mid: 0, high: 0 }).connect(AE.master);
  AE.padPhaser.connect(AE.toneEqPad);
  /* 鼓：失真(轻饱和)→EQ→主总线 */
  AE.toneEqDrums = new Tone.EQ3({ low: 0, mid: 0, high: 2 }).connect(AE.master);
  AE.toneDistDrums = new Tone.Distortion(0).connect(AE.toneEqDrums);
  /* 各层空间发送（共享唯一混响） */
  AE.sendGuitar = new Tone.Gain(0.3).connect(AE.masterVerb);
  AE.sendKeys = new Tone.Gain(0.3).connect(AE.masterVerb);
  AE.sendBass = new Tone.Gain(0.05).connect(AE.masterVerb);
  AE.sendPad = new Tone.Gain(0.12).connect(AE.masterVerb);
  AE.sendDrums = new Tone.Gain(0.12).connect(AE.masterVerb);
  /* --- 爵士颤音琴：FM 金属音色 + 长释放（jazz 风格键盘专用） --- */
  AE.keysVibes = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.01, modulationIndex: 12,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.002, decay: 0.9, sustain: 0.12, release: 2.0 },
    modulation: { type: 'sine' },
    modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0.3, release: 0.5 },
  }).connect(nativeInputOf(AE.toneDistKeys));
  AE.keysVibes.volume.value = -4;
  AE.drumsVol.connect(AE.drumsComp);
  AE.drumsComp.connect(AE.toneDistDrums);
  /* 鼓房间声：0.45s 短混响 send（kick/snare 的"房间麦"，鼓机→真鼓） */
  AE.drumRoom = new Tone.Reverb({ decay: 0.45, wet: 1 }).connect(AE.master);
  AE.drumRoomSend = new Tone.Gain(0.16).connect(AE.drumRoom);
  AE.drumsComp.connect(AE.drumRoomSend);

  /* --- 808 鼓组（经典 TR-808 合成复刻，808 本身就是合成鼓机） --- */
  AE.kick808 = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 1.5, sustain: 0, release: 0.2 },
  }).connect(AE.drumsVol);
  AE.snare808 = new Tone.MembraneSynth({
    pitchDecay: 0.02, octaves: 1.5,
    envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.1 },
  }).connect(AE.drumsVol);
  AE.clap808 = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.002, decay: 0.16, sustain: 0 },
  }).connect(AE.drumsVol);
  AE.hat808 = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.045, release: 0.02 },
    harmonicity: 5.1, modulationIndex: 26, resonance: 7000, octaves: 1.2,
  }).connect(AE.drumsVol);
  AE.hat808.volume.value = -13;
  AE.ohat808 = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.35, release: 0.05 },
    harmonicity: 5.1, modulationIndex: 20, resonance: 5200, octaves: 1,
  }).connect(AE.drumsVol);
  AE.ohat808.volume.value = -15;
  AE.rim808 = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.03, release: 0.02 },
    harmonicity: 5.1, modulationIndex: 30, resonance: 9000, octaves: 1,
  }).connect(AE.drumsVol);
  AE.rim808.volume.value = -12;
  AE.cowbell808 = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.5, release: 0.1 },
    harmonicity: 5.1, modulationIndex: 40, resonance: 780, octaves: 1,
  }).connect(AE.drumsVol);
  AE.cowbell808.volume.value = -14;
  AE.tom808 = new Tone.MembraneSynth({
    pitchDecay: 0.08, octaves: 2,
    envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.2 },
  }).connect(AE.drumsVol);
  AE.crash808 = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 1.4, release: 0.2 },
    harmonicity: 5.1, modulationIndex: 32, resonance: 3800, octaves: 1.5,
  }).connect(AE.drumsVol);
  AE.crash808.volume.value = -15;

  AE.ready = true;
  applyStyleFx(state.styles.length === 1 ? state.styles[0] : 'rnb');
  applyStyleTone(state.styles.length === 1 ? state.styles[0] : 'rnb');
  for (const layer of ['guitar', 'keys', 'bass', 'pad', 'drums']) applyTone(layer);
  document.querySelectorAll('.tone-slider').forEach(sl => {
    const cur = state.tone[sl.dataset.layer];
    if (cur && cur[sl.dataset.param] !== undefined) sl.value = Math.round(cur[sl.dataset.param] * 100);
  });
  applyMix();
}

/* ================= 真实电吉他采样引擎（Freesound CC0 单音录制） =================
 * 解决 SoundFont 吉他"像合成器"的问题：真实琴体采样 + 就近取音 + 微随机 + 滑音 */
const GUITAR_SAMP = { buffers: {}, started: false };
/* tonejs-instruments 真实采样（电吉他=Karoryfer, 木吉他=Iowa），音名 s=升号 */
const GUITAR_SETS = {
  electric: ['E2','Fs2','Cs2','A2','C3','Ds3','Fs3','A3','C4','Ds4','Fs4','A4','C5','Ds5','Fs5','A5','C6'],
  acoustic: ['A2','As2','B2','C3','Cs3','D3','Ds3','E3','F3','Fs3','G3','Gs3','A3','As3','B3','C4','A4'],
};
const GUITAR_PATCH_MAP = { clean:'electric', crunch:'electric', dist:'electric', jazz:'electric', muted:'electric', harmonics:'electric', delay:'electric', steel:'acoustic', nylon:'acoustic' };
/* 按 patch 的音色塑造：真实采样只有两套库，风格差异靠效果链分家。
   drive→线路失真量, lpf→低通, gate→音门（闷音）, vol→音量补偿 */
const GUITAR_PATCH_FX = {
  clean:    { drive: 0,   lpf: 20000, gate: 1.00, vol: 1.00 },
  delay:    { drive: 0,   lpf: 20000, gate: 1.00, vol: 1.00 },
  harmonics:{ drive: 0,   lpf: 16000, gate: 0.70, vol: 0.55 },
  jazz:     { drive: 2,   lpf: 10500, gate: 1.00, vol: 0.90 },
  crunch:   { drive: 8,   lpf: 9000,  gate: 1.00, vol: 1.00 },
  dist:     { drive: 30,  lpf: 7200,  gate: 1.00, vol: 1.00 },
  muted:    { drive: 3,   lpf: 5000,  gate: 0.35, vol: 0.90 },
};
const GUITAR_FX_CHAINS = {};
function guitarFxChain(patch, raw) {
  const fx = GUITAR_PATCH_FX[patch] || GUITAR_PATCH_FX.clean;
  if (fx.drive === 0 && fx.lpf >= 20000 && fx.gate === 1 && fx.vol === 1) return SAMP.busByRole.guitar;
  let head = GUITAR_FX_CHAINS[patch];
  if (!head) {
    const shaper = raw.createWaveShaper();
    shaper.curve = driveCurve(fx.drive);
    shaper.oversample = '2x';
    const lpf = raw.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = fx.lpf; lpf.Q.value = 0.7;
    const vol = raw.createGain(); vol.gain.value = fx.vol;
    shaper.connect(lpf); lpf.connect(vol); vol.connect(SAMP.busByRole.guitar);
    head = shaper;
    GUITAR_FX_CHAINS[patch] = head;
  }
  return head;
}
function noteNameToMidi(name) {
  const m = name.match(/^([A-G])(s?)(-?\d)$/);
  if (!m) return 40;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  return (parseInt(m[3]) + 1) * 12 + base + (m[2] ? 1 : 0);
}
function loadGuitarSamples() {
  if (GUITAR_SAMP.started) return;
  GUITAR_SAMP.started = true;
  const raw = Tone.getContext().rawContext;
  for (const set of ['electric', 'acoustic']) {
    GUITAR_SAMP.buffers[set] = {};
    for (const note of GUITAR_SETS[set]) {
      fetch('guitar2/' + set + '/' + note + '.mp3')
        .then(r => r.ok ? r.arrayBuffer() : Promise.reject())
        .then(ab => raw.decodeAudioData(ab))
        .then(buf => { GUITAR_SAMP.buffers[set][noteNameToMidi(note)] = buf; })
        .catch(() => {});
    }
  }
}
function playGuitarReal(patch, midi, t, dur, vel) {
  const set = GUITAR_PATCH_MAP[patch] || 'electric';
  const bank = GUITAR_SAMP.buffers[set] || {};
  const keys = Object.keys(bank).map(Number);
  if (!keys.length) return false;
  let best = keys[0], bd = 99;
  for (const k of keys) { const d = Math.abs(k - midi); if (d < bd) { bd = d; best = k; } }
  if (bd > 7) return false; /* 缺音区交还 SoundFont */
  const fx = GUITAR_PATCH_FX[patch] || GUITAR_PATCH_FX.clean;
  const out = guitarFxChain(patch, Tone.getContext().rawContext);
  if (fx.gate < 1) dur = Math.max(0.07, Math.min(dur, 0.08 + dur * fx.gate));
  const raw = Tone.getContext().rawContext;
  const src = raw.createBufferSource();
  src.buffer = bank[best];
  src.playbackRate.value = Math.pow(2, (midi - best) / 12) * (1 + (Math.random() * 0.01 - 0.005));
  const g = raw.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(vel, 0.05), t + 0.012);
  g.gain.setValueAtTime(Math.max(vel, 0.05), t + Math.max(0.05, dur - 0.1));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
  src.connect(g); g.connect(out);
  src.start(t); src.stop(t + dur + 0.4);
  /* 双轨录制：厚度>0.5 时叠第二轨（±声像/微延迟/微失谐） */
  const th = state.tone.guitar ? state.tone.guitar.t : 0.2;
  if (th > 0.5) {
    const raw2 = Tone.getContext().rawContext;
    const src2 = raw2.createBufferSource();
    src2.buffer = bank[best];
    src2.playbackRate.value = Math.pow(2, (midi - best) / 12) * 1.006;
    const g2 = raw2.createGain();
    const v2 = vel * 0.55;
    g2.gain.setValueAtTime(0.0001, t + 0.012);
    g2.gain.exponentialRampToValueAtTime(Math.max(v2, 0.03), t + 0.024);
    g2.gain.setValueAtTime(Math.max(v2, 0.03), t + Math.max(0.05, dur - 0.1));
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    const pan = raw2.createStereoPanner ? raw2.createStereoPanner() : null;
    if (pan) { pan.pan.value = 0.45; g2.connect(pan); pan.connect(out); }
    else g2.connect(out);
    src2.connect(g2);
    src2.start(t + 0.012); src2.stop(t + dur + 0.45);
  }
  return true;
}

/* Trap 808 贝斯：kick_808 采样按音高变速 + 长衰减 + 句尾滑音 */
function play808(midi, t, dur, vel, slideTo) {
  const buf = DRUM_SAMP.buffers.kick_808;
  if (!buf || !DRUM_SAMP.bus) return false;
  const raw = Tone.getContext().rawContext;
  const src = raw.createBufferSource();
  src.buffer = buf;
  src.playbackRate.setValueAtTime(Math.pow(2, (midi - 36) / 12), t);
  if (slideTo) src.playbackRate.exponentialRampToValueAtTime(Math.pow(2, (slideTo - 36) / 12), t + dur);
  const g = raw.createGain();
  const v = vel * 1.25;
  g.gain.setValueAtTime(v, t);
  g.gain.setValueAtTime(v, t + dur * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(g); g.connect(DRUM_SAMP.bus);
  src.start(t); src.stop(t + dur + 0.1);
  return true;
}

/* 808 底鼓：正弦波 150Hz→40Hz 快速下滑（经典 808 低音炮） */
function trig808kick(t, vel) {
  const o = AE.kick808.oscillator;
  o.frequency.cancelScheduledValues(t);
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.1);
  AE.kick808.triggerAttackRelease('A1', 1.1, t, vel);
}

/* ============================================================
 * 真实鼓/打击乐采样（Freesound CC0）——风格辨识度的地基
 * ============================================================ */
const DRUM_SAMP = { buffers: {}, started: false, bus: null };
const DRUM_FILES = ['kick_room','snare_room','hat_closed','crash','brush_snare','rim_click',
  'shaker','shekere','conga_h','conga_l','clave','kick_808','snap','hat_808','clap'];
/* 每风格鼓件映射：值=采样名，null=用合成鼓回退 */
const DRUM_KITS = {
  rock:  { kick:'kick_room', snare:'snare_room', hat:'hat_closed', ohat:'hat_closed', ride:'hat_closed', crash:'crash', congaH:null, congaL:null, ghost:'snare_room' },
  jazz:  { kick:null, snare:'brush_snare', hat:null, ohat:'hat_closed', ride:null, crash:'crash', congaH:null, congaL:null, ghost:'brush_snare' },
  bossa: { kick:null, snare:'rim_click', hat:'shaker', ohat:'shaker', ride:'shaker', crash:'crash', congaH:null, congaL:null, ghost:'rim_click' },
  afro:  { kick:'kick_room', snare:'clave', hat:'shekere', ohat:'shekere', ride:'shekere', bell:'clave', crash:null, congaH:'conga_h', congaL:'conga_l', ghost:null },
  rnb:   { kick:'kick_808', snare:'snap', hat:'hat_808', ohat:'hat_808', ride:'hat_808', crash:'crash', congaH:null, congaL:null, ghost:'snap' },
  s808:  { kick:'kick_808', snare:null, hat:'hat_808', ohat:'hat_808', ride:'hat_808', crash:'crash', congaH:null, congaL:null, ghost:null },
  hiphop:{ kick:'kick_808', snare:'clap', hat:'hat_808', ohat:'hat_808', ride:null, crash:'crash', congaH:null, congaL:null, ghost:null },
  beach: { kick:null, snare:'rim_click', hat:'shaker', ohat:'shaker', ride:null, crash:null, congaH:null, congaL:null, ghost:null },
};
function loadDrumSamples(isRetry) {
  if ((!isRetry && DRUM_SAMP.started) || DRUM_SAMP.loading || !AE.ready) return;
  DRUM_SAMP.started = true; DRUM_SAMP.loading = true;
  const raw = Tone.getContext().rawContext;
  DRUM_SAMP.bus = raw.createGain();
  DRUM_SAMP.bus.gain.value = 1;
  DRUM_SAMP.bus.connect(nativeInputOf(AE.drumsVol));
  /* 单次击打最大时长（秒）：防止把 loop/长采样整段叠放 */
  const DRUM_MAXDUR = { hat_closed: 0.8, hat_808: 1.2, shaker: 2.2, shekere: 2.0, snare_room: 1.5, snap: 1.0, rim_click: 1.0, clap: 1.3, brush_snare: 1.8, kick_room: 1.1, kick_808: 1.6, crash: 2.8, conga_h: 1.6, conga_l: 1.6, clave: 1.0 };
  DRUM_FILES.forEach(name => {
    fetch('drums/' + name + '.mp3')
      .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error('404')))
      .then(ab => raw.decodeAudioData(ab))
      .then(buf => {
        const max = DRUM_MAXDUR[name] || 1.5;
        if (buf.duration > max) {
          const n = Math.floor(raw.sampleRate * max);
          const nb = raw.createBuffer(buf.numberOfChannels, n, raw.sampleRate);
          for (let ch = 0; ch < buf.numberOfChannels; ch++) nb.getChannelData(ch).set(buf.getChannelData(ch).subarray(0, n));
          buf = nb;
        }
        DRUM_SAMP.buffers[name] = buf;
      })
      .catch(() => { DRUM_SAMP.fail = (DRUM_SAMP.fail || 0) + 1; });
  });
  /* 6s 后清点：缺失自动重试一次，仍失败明确提示（网络差时鼓会无声，必须可见） */
  setTimeout(() => {
    DRUM_SAMP.loading = false;
    const missing = DRUM_FILES.filter(n => !DRUM_SAMP.buffers[n]).length;
    if (missing && !DRUM_SAMP.retried) {
      DRUM_SAMP.retried = true;
      sampStatus('鼓采样 ' + missing + '/15 未加载，重试中…');
      loadDrumSamples(true);
    } else if (missing) {
      sampStatus('鼓采样 ' + missing + '/15 加载失败（网络），已用合成鼓兜底');
    }
  }, 6000);
}
const DRUM_GAIN = { shekere: 1.3, shaker: 0.9, snap: 1.1, clap: 1.3, hat_808: 0.9, kick_808: 1.25, crash: 0.95, rim_click: 1.1, kick_room: 1.45, snare_room: 1.2, brush_snare: 1.1, conga_h: 1.25, conga_l: 1.25, clave: 1.2 };
function playDrumSample(name, t, vel) {
  const buf = DRUM_SAMP.buffers[name];
  if (!buf || !DRUM_SAMP.bus) return false;
  const raw = Tone.getContext().rawContext;
  const src = raw.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 1 + (Math.random() * 0.06 - 0.03);
  const g = raw.createGain();
  const v = vel * (DRUM_GAIN[name] || 1);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(buf.duration * 0.85, 1.8));
  src.connect(g);
  if (vel < 0.45 && (name === 'snare_room' || name === 'snare808' || name === 'snap')) {
    /* 幽灵音/轻击：低通变暗 = 真实轻击鼓皮音色（非仅调音量） */
    const lp = raw.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2200;
    g.connect(lp); lp.connect(DRUM_SAMP.bus);
  } else {
    g.connect(DRUM_SAMP.bus);
  }
  src.start(t);
  return true;
}
function silenceSampleBuses() {
  try { if (SAMP.bus) SAMP.bus.gain.value = 0; if (SAMP.padBus) SAMP.padBus.gain.value = 0; if (DRUM_SAMP.bus) DRUM_SAMP.bus.gain.value = 0; } catch (e) {}
}
function restoreSampleBuses() {
  try { if (SAMP.bus) SAMP.bus.gain.value = 1; if (SAMP.padBus) SAMP.padBus.gain.value = 1; if (DRUM_SAMP.bus) DRUM_SAMP.bus.gain.value = 1; } catch (e) {}
}
/* 微时值引擎：每轨独立的 timing profile（真实演奏各声部前后不一）+ 乐句内 rubato */
const TIMING_PROFILE = {
  rnb:   { drums: 0.010, hat: -0.006, bass: 0.012, keys: 0.020, melody: 0.018, pad: 0.008 }, /* 推-拉：鼓抢拍/和声躺（D'Angelo 系） */
  jazz:  { drums: 0.006, hat: -0.004, bass: 0.008, keys: 0.010, melody: 0.016, pad: 0.004 }, /* 独奏在镲后：behind the beat */
  rock:  { drums: -0.002, hat: 0.0, bass: 0.0, keys: 0.0, melody: 0.0, pad: 0.0 },
  bossa: { drums: 0.004, hat: -0.003, bass: 0.006, keys: 0.003, melody: 0.006, pad: 0.002 },
  afro:  { drums: 0.006, hat: 0.002, bass: 0.0, keys: 0.0, melody: 0.004, pad: 0.002 }, /* 论文：Afrobeat 鼓略早于网格 */
  hiphop:{ drums: 0.004, hat: -0.005, bass: 0.0, keys: 0.003, melody: 0.012, pad: 0.003 },
};
function voiceOff(styleKey, voice, beat) {
  const p = TIMING_PROFILE[styleKey];
  if (!p) return 0;
  let off = p[voice] || 0;
  if (voice === 'melody' || voice === 'bass') {
    const phrase = (beat % 16) / 16;
    off *= 1 + phrase * 0.7; /* 乐句尾更拖：rubato */
  }
  return off;
}
const SECTION_DEFS = [
  { name: '前奏', bars: 4, energy: 0.3 },
  { name: '主歌 A', bars: 8, energy: 0.55 },
  { name: '副歌', bars: 8, energy: 1.0 },
  { name: '主歌 B', bars: 8, energy: 0.6 },
  { name: '副歌', bars: 8, energy: 1.0 },
  { name: '尾奏', bars: 4, energy: 0.25 },
];
const SONG_BARS = SECTION_DEFS.reduce((a, x) => a + x.bars, 0);
function totalBars() { return state.structure === 'song' ? SONG_BARS : state.slots.length; }
function sectionAt(bar) {
  if (state.structure !== 'song') return { name: '', energy: 0.75 };
  let acc = 0;
  for (const sec of SECTION_DEFS) { acc += sec.bars; if (bar < acc) return sec; }
  return SECTION_DEFS[SECTION_DEFS.length - 1];
}
function chordAtBar(bar) { return chordTimeline[bar % chordTimeline.length]; }

/* ============================================================
 * 采样音源（真实乐器录音，SoundFont / FluidR3_GM，CC 协议免费库）
 * 按需加载：核心音色立即加载，其余后台预载
 * ============================================================ */
const SAMP = { cache: {}, pending: {}, bus: null, padBus: null,
  roleBank: (typeof localStorage !== 'undefined' && JSON.parse(localStorage.getItem('motif_rolebank') || '{}')) || {} };
const SAMP_GUITAR = {
  clean: 'electric_guitar_clean', crunch: 'overdriven_guitar', dist: 'distortion_guitar',
  jazz: 'electric_guitar_jazz', muted: 'electric_guitar_muted', harmonics: 'guitar_harmonics',
  steel: 'acoustic_guitar_steel', nylon: 'acoustic_guitar_nylon',
};
const SAMP_KEYS = 'electric_piano_1';
/* 键盘按风格分音色：jazz=FM 颤音琴合成器(@vibes)，hiphop=暗黑 polysynth 长铺，其余 Rhodes */
const SAMP_KEYS_BY_STYLE = {
  rnb: SAMP_KEYS, jazz: '@vibes', rock: SAMP_KEYS,
  bossa: SAMP_KEYS, afro: SAMP_KEYS, hiphop: 'pad_3_polysynth',
};
const SAMP_BASS = 'electric_bass_finger';
const SAMP_PAD = {
  halo: 'pad_7_halo', sweep: 'pad_8_sweep', warm: 'pad_2_warm',
  choir: 'pad_4_choir', strings: 'synth_strings_1', polysynth: 'pad_3_polysynth',
};

function sampStatus(txt) {
  const el = document.getElementById('samp-status');
  if (el) el.textContent = txt || '';
}
function nativeInputOf(toneNode) {
  if (!toneNode || !toneNode.input) return toneNode;
  return toneNode.input.input ? toneNode.input.input : toneNode.input;
}
function ensureBuses() {
  if (SAMP.busByRole) return;
  const raw = Tone.getContext().rawContext;
  SAMP.busByRole = {};
  const mk = (role) => { const g = raw.createGain(); g.gain.value = 1; SAMP.busByRole[role] = g; return g; };
  /* 吉他 → 失真→EQ→暖声链；keys → EQ→暖声链；贝斯 → 低通→主总线（不过合唱混响） */
  mk('guitar').connect(nativeInputOf(AE.toneDistGuitar));
  mk('keys').connect(nativeInputOf(AE.toneDistKeys));
  mk('bass').connect(nativeInputOf(AE.toneFilterBass));
  mk('pad').connect(nativeInputOf(AE.padPhaser));
  /* 空间发送（原生 gain → Tone.Gain） */
  const mkSend = (role, send) => { const g = raw.createGain(); g.gain.value = 0.3; g.connect(nativeInputOf(send)); return g; };
  SAMP.sendByRole = {
    guitar: mkSend('guitar', AE.sendGuitar),
    keys: mkSend('keys', AE.sendKeys),
    bass: mkSend('bass', AE.sendBass),
    pad: mkSend('pad', AE.sendPad),
  };
  SAMP.busByRole.guitar.connect(SAMP.sendByRole.guitar);
  SAMP.busByRole.keys.connect(SAMP.sendByRole.keys);
  SAMP.busByRole.bass.connect(SAMP.sendByRole.bass);
  SAMP.busByRole.pad.connect(SAMP.sendByRole.pad);
  /* 兼容旧引用 */
  SAMP.bus = SAMP.busByRole.guitar;
  SAMP.padBus = SAMP.busByRole.pad;
}
function roleOfName(name) {
  if (name === SAMP_KEYS) return 'keys';
  if (name === SAMP_BASS) return 'bass';
  if (name && (name.startsWith('pad_') || name === 'synth_strings_1')) return 'pad';
  return 'guitar';
}
function ensureSample(name) {
  if (!AE.ready) return Promise.resolve(null);
  const key = state.sfBase + ':' + name;
  if (SAMP.cache[key]) return Promise.resolve(SAMP.cache[key]);
  if (!SAMP.pending[key]) {
    if (typeof Soundfont === 'undefined') return Promise.resolve(null);
    ensureBuses();
    const other = state.sfBase === 'soundfont2' ? 'soundfont' : 'soundfont2';
    const tryLoad = (base) => Soundfont.instrument(Tone.getContext(), base + '/' + name + '.js', {
      destination: SAMP.busByRole[roleOfName(name)],
    });
    SAMP.pending[key] = tryLoad(state.sfBase)
      .catch(() => tryLoad(other))
      .then(inst => { SAMP.cache[key] = inst; return inst; })
      .catch(err => { console.warn('采样加载失败 ' + name, err); return null; });
  }
  return SAMP.pending[key];
}
function sampOf(name, role) {
  const bank = (role && SAMP.roleBank[role]) || state.sfBase;
  return SAMP.cache[bank + ':' + name] || SAMP.cache[state.sfBase + ':' + name] || null;
}

/* ================= 音色描述子自动对齐 =================
 * 学术方案（QMUL 音色描述子 / TinySOL 检索）：
 * 频谱质心≈明亮度、尾部能量比≈延音；按风格目标表自动挑选 MusyngKite/FluidR3 */
function _fft(re, im) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cwr = 1, cwi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cwr - im[i + j + len / 2] * cwi;
        const vi = re[i + j + len / 2] * cwi + im[i + j + len / 2] * cwr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr; cwr = nwr;
      }
    }
  }
}
function timbreDescriptors(buf) {
  const d = buf.getChannelData(0), sr = buf.sampleRate, N = 2048;
  const re = new Float32Array(N), im = new Float32Array(N);
  const off = Math.min(Math.floor(d.length * 0.1), Math.max(0, d.length - N));
  for (let i = 0; i < N; i++) re[i] = d[off + i] || 0;
  _fft(re, im);
  let num = 0, den = 0;
  for (let k = 1; k < N / 2; k++) {
    const mag = Math.hypot(re[k], im[k]);
    num += mag * k * sr / N; den += mag;
  }
  const bright = clamp((den ? num / den : 0) / 4500, 0, 1);
  let eAll = 0, eTail = 0;
  for (let i = 0; i < d.length; i++) { const v = d[i] * d[i]; eAll += v; if (i > d.length * 0.7) eTail += v; }
  return { bright, sustain: clamp((eAll ? eTail / eAll : 0) * 2.2, 0, 1) };
}
const STYLE_TIMBRE = {
  rnb:   { guitar:{b:0.30,s:0.80}, keys:{b:0.30,s:0.75}, bass:{b:0.25,s:0.90}, pad:{b:0.25,s:0.95} },
  jazz:  { guitar:{b:0.35,s:0.60}, keys:{b:0.30,s:0.65}, bass:{b:0.30,s:0.60}, pad:{b:0.30,s:0.80} },
  rock:  { guitar:{b:0.62,s:0.45}, keys:{b:0.45,s:0.40}, bass:{b:0.50,s:0.40}, pad:{b:0.40,s:0.50} },
  bossa: { guitar:{b:0.45,s:0.55}, keys:{b:0.35,s:0.50}, bass:{b:0.35,s:0.55}, pad:{b:0.30,s:0.70} },
  afro:  { guitar:{b:0.50,s:0.50}, keys:{b:0.45,s:0.45}, bass:{b:0.40,s:0.60}, pad:{b:0.35,s:0.60} },
  hiphop:{ guitar:{b:0.35,s:0.75}, keys:{b:0.25,s:0.85}, bass:{b:0.20,s:0.95}, pad:{b:0.20,s:0.95} },
};
function ensureSampleBank(name, base) {
  const key = base + ':' + name;
  if (SAMP.cache[key]) return Promise.resolve(SAMP.cache[key]);
  if (!SAMP.pending[key]) {
    if (!AE.ready || typeof Soundfont === 'undefined') return Promise.resolve(null);
    ensureBuses();
    SAMP.pending[key] = Soundfont.instrument(Tone.getContext(), base + '/' + name + '.js', {
      destination: SAMP.busByRole[roleOfName(name)],
    }).then(inst => { SAMP.cache[key] = inst; return inst; }).catch(() => null);
  }
  return SAMP.pending[key];
}
async function autoAlignTimbres(styleKey) {
  const targets = STYLE_TIMBRE[styleKey];
  if (!targets || !AE.ready) return;
  const roles = {
    guitar: SAMP_GUITAR[state.layers.guitar.patch],
    keys: SAMP_KEYS,
    bass: SAMP_BASS,
    pad: SAMP_PAD[state.layers.synth.patch],
  };
  const picks = [];
  SAMP.descCache = SAMP.descCache || {};
  for (const [role, name] of Object.entries(roles)) {
    if (!name || !targets[role]) continue;
    /* 只分析已在缓存中的库：不触发下载/解码，避免播放前二次风暴 */
    const banks = ['soundfont2', 'soundfont'].filter(b => SAMP.cache[b + ':' + name]);
    if (banks.length < 2) continue; /* 只有一个库可对比时不切换 */
    const tg = targets[role];
    let best = SAMP.roleBank[role] || state.sfBase, bd = 1e9;
    for (const base of banks) {
      const ck = base + ':' + name;
      if (!SAMP.descCache[ck]) {
        const inst = SAMP.cache[ck];
        const keyName = inst.buffers['E3'] ? 'E3' : Object.keys(inst.buffers)[Math.floor(Object.keys(inst.buffers).length / 2)];
        SAMP.descCache[ck] = timbreDescriptors(inst.buffers[keyName]);
      }
      const d = Math.abs(SAMP.descCache[ck].bright - tg.b) + Math.abs(SAMP.descCache[ck].sustain - tg.s);
      if (d < bd) { bd = d; best = base; }
    }
    SAMP.roleBank[role] = best;
    picks.push(role + '→' + (best === 'soundfont2' ? 'MK' : 'F3'));
  }
  try { localStorage.setItem('motif_rolebank', JSON.stringify(SAMP.roleBank)); } catch (e) {}
  sampStatus('音色对齐：' + picks.join(' · '));
  reScheduleIfPlaying();
}

function loadInstruments() {
  const ksCore = SAMP_KEYS_BY_STYLE[state.styles.length === 1 ? state.styles[0] : 'rnb'] || SAMP_KEYS;
  const core = [
    SAMP_GUITAR[state.layers.guitar.patch], ksCore === '@vibes' ? SAMP_KEYS : ksCore, SAMP_BASS, SAMP_PAD[state.layers.synth.patch],
  ].filter(Boolean);
  let done = 0;
  sampStatus(`正在加载采样音色 0/${core.length}…`);
  core.forEach(n => ensureSample(n).then(() => {
    done++;
    sampStatus(done < core.length ? `正在加载采样音色 ${done}/${core.length}…` : '✓ 核心采样音色已就绪');
  }));
  /* 后台错峰预载其余吉他（播放中不加载，避免解码风暴导致卡顿） */
  Object.values(SAMP_GUITAR).forEach((n, i) => {
    if (!core.includes(n)) setTimeout(() => { if (!state.playing) ensureSample(n); }, 15000 + i * 6000);
  });
}

function applyGuitarPatch() {
  if (!AE.ready) return;
  const p = state.layers.guitar.patch;
  const g = AE.guitar;
  if (p === 'dist') {         /* 高增益失真：金属/硬摇滚 */
    g.oscillator.type = 'fatsawtooth'; g.oscillator.count = 3; g.oscillator.spread = 35;
    AE.guitarPre.curve = driveCurve(14);
    AE.guitarEq.low.value = 0; AE.guitarEq.mid.value = 2; AE.guitarEq.high.value = 4;
    AE.guitarComp.threshold.value = -20;
    AE.guitarDelay.wet.value = 0.22; AE.guitarDelay.feedback.value = 0.3;
    g.envelope.attack = 0.006; g.envelope.release = 0.28;
    g.portamento = 0.09;
  } else if (p === 'delay') { /* 延迟氛围：清音延迟 */
    g.oscillator.type = 'triangle';
    AE.guitarPre.curve = driveCurve(2.5);
    AE.guitarEq.low.value = -2; AE.guitarEq.mid.value = 0; AE.guitarEq.high.value = 3;
    AE.guitarComp.threshold.value = -18;
    AE.guitarDelay.wet.value = 0.55; AE.guitarDelay.feedback.value = 0.5;
    g.envelope.attack = 0.02; g.envelope.release = 1.2;
    g.portamento = 0.05;
  } else {                    /* 过载 Crunch：经典摇滚 */
    g.oscillator.type = 'fatsawtooth'; g.oscillator.count = 2; g.oscillator.spread = 22;
    AE.guitarPre.curve = driveCurve(6);
    AE.guitarEq.low.value = -1; AE.guitarEq.mid.value = 0.5; AE.guitarEq.high.value = 2.5;
    AE.guitarComp.threshold.value = -16;
    AE.guitarDelay.wet.value = 0.2; AE.guitarDelay.feedback.value = 0.28;
    g.envelope.attack = 0.012; g.envelope.release = 0.35;
    g.portamento = 0.025;
  }
}

function applyMix() {
  if (!AE.ready) return;
  AE.master.volume.value = Tone.gainToDb(state.master * state.master);
  AE.guitarVol.mute = !state.layers.guitar.on;
  AE.keysVol.mute = !state.layers.keys.on;
  AE.bassVol.mute = !state.layers.bass.on;
  AE.drumsVol.mute = !state.layers.drums.on;
  AE.synthVol.mute = !state.layers.synth.on;
  AE.guitarVol.volume.value = Tone.gainToDb(state.layers.guitar.vol * state.layers.guitar.vol) - 3;
  AE.keysVol.volume.value = Tone.gainToDb(state.layers.keys.vol * state.layers.keys.vol) - 6;
  AE.bassVol.volume.value = Tone.gainToDb(state.layers.bass.vol * state.layers.bass.vol) - 4;
  AE.drumsVol.volume.value = Tone.gainToDb(state.layers.drums.vol * state.layers.drums.vol) - 2; /* 鼓要穿透垫底，推子抬高 */
  AE.synthVol.volume.value = Tone.gainToDb(state.layers.synth.vol * state.layers.synth.vol) - 6;
  applyGuitarPatch();
}

function styleOfBar(beat) {
  const bar = Math.floor(beat / 4);
  return state.styles.length > 1 ? state.styles[bar % state.styles.length] : state.styles[0];
}

/* ---------- 走带调度（全部量化到 16 分网格，用 b:b:s 记谱） ---------- */
function t16(total16) {
  const bar = Math.floor(total16 / 16), rem = total16 % 16;
  return `${bar}:${Math.floor(rem / 4)}:${rem % 4}`;
}
const secPer16 = () => 60 / state.bpm / 4;

function scheduleAll() {
  Tone.Transport.cancel(0);
  Tone.Transport.bpm.value = state.bpm;
  Tone.Transport.swing = state.swing;
  Tone.Transport.swingSubdivision = '16n';
  const bars = state.slots.length;

  /* 吉他旋律（优先真实采样，未就绪时回退合成音色） */
  if (state.layers.guitar.on) {
    const instName = SAMP_GUITAR[state.layers.guitar.patch] || null;
    for (const e of melodyEvents) {
      const t = t16(Math.round(e.beat * 4));
      const dur = Math.max(1, Math.round(e.dur * 4)) * secPer16() * 0.95;
      const toff = voiceOff(styleOfBar(e.beat), 'melody', e.beat);
      Tone.Transport.schedule(tt => {
        if (playGuitarReal(state.layers.guitar.patch, e.midi, tt + toff, dur, e.vel * 1.05)) return;
        const inst = instName && sampOf(instName, 'guitar');
        if (inst) inst.play(e.midi, tt + toff, { duration: dur, gain: e.vel * 1.1 });
        else AE.guitar.triggerAttackRelease(midiName(e.midi), dur, tt + toff, e.vel);
      }, t);
    }
  }
  /* 键盘（按风格分音色：Rhodes/颤音琴/暗黑铺） */
  if (state.layers.keys.on) {
    for (const e of keysEvents) {
      const t = t16(Math.round(e.beat * 4));
      const dur = Math.max(1, Math.round(e.dur * 4)) * secPer16() * 0.95;
      const names = e.notes.map(midiName);
      const koff = voiceOff(styleOfBar(e.beat), 'keys', e.beat);
      const ks = SAMP_KEYS_BY_STYLE[styleOfBar(e.beat)] || SAMP_KEYS;
      Tone.Transport.schedule(tt2 => { const tt = tt2 + koff;
        const gi = e.inst && e.inst.startsWith('guitar:') ? e.inst.slice(7) : null;
        const gInst = gi && sampOf(SAMP_GUITAR[gi], 'guitar');
        if (gInst) for (const n of e.notes) gInst.play(n, tt, { duration: dur, gain: e.vel * 1.1 });
        else if (ks === '@vibes') AE.keysVibes.triggerAttackRelease(names, dur, tt, e.vel * 0.85);
        else {
          const inst = ks && sampOf(ks, 'keys');
          if (inst) for (const n of e.notes) inst.play(n, tt, { duration: dur, gain: e.vel });
          else AE.keys.triggerAttackRelease(names, dur, tt, e.vel);
        }
      }, t);
    }
  }
  /* 合成器 Pad（采样优先，兜底合成链） */
  if (state.layers.synth.on) {
    const padName = SAMP_PAD[state.layers.synth.patch];
    const inst = (padName && sampOf(padName, 'pad')) || null;
    for (const e of synthEvents) {
      const t = t16(Math.round(e.beat * 4));
      const dur = Math.max(1, Math.round(e.dur * 4)) * secPer16() * 0.98;
      const names = e.notes.map(midiName);
      const poff = voiceOff(styleOfBar(e.beat), 'pad', e.beat);
      const lag = e.padLag || 0;
      Tone.Transport.schedule(tt => {
        if (inst) for (const n of e.notes) inst.play(n, tt + poff + lag, { duration: dur, gain: e.vel * 1.4 });
        else AE.synthPad.triggerAttackRelease(names, dur, tt + poff + lag, e.vel);
      }, t);
    }
  }
  /* 贝斯（指弹电贝斯采样）+ kick-bass ducking */
  if (state.layers.bass.on) {
    const inst = sampOf(SAMP_BASS, 'bass');
    const kickBeats = drumEvents.filter(d => d.inst === 'kick').map(d => d.step16 / 4);
    for (const e of bassEvents) {
      /* kick 后 120ms 内的贝斯音自动避让 -3dB（假侧链） */
      const ducked = kickBeats.some(k => { const d = e.beat - k; return d > 0.001 && d < 0.12; });
      const duckMul = ducked ? 0.7 : 1;
      const t = t16(Math.round(e.beat * 4));
      const dur = Math.max(1, Math.round(e.dur * 4)) * secPer16() * 0.95;
      const boff = voiceOff(styleOfBar(e.beat), 'bass', e.beat);
      Tone.Transport.schedule(tt => {
        if (e.b808) {
          if (!play808(e.midi, tt, dur * 1.6, e.vel, e.slideTo)) {
            AE.bass.triggerAttackRelease(midiName(e.midi), dur, tt, e.vel);
          }
          return;
        }
        if (inst) inst.play(e.midi, tt, { duration: dur, gain: e.vel * 1.3 * duckMul });
        else AE.bass.triggerAttackRelease(midiName(e.midi), dur, tt, e.vel * duckMul);
      }, t);
    }
  }
  /* 鼓（真实采样优先，按事件自带的风格鼓件映射，未加载回退合成） */
  if (state.layers.drums.on) {
    for (const e of drumEvents) {
      const t = t16(e.step16);
      const doff = voiceOff(styleOfBar(e.step16 / 4), (e.inst === 'hat' || e.inst === 'ohat' || e.inst === 'ride' || e.inst === 'shekere' || e.inst === 'shaker') ? 'hat' : 'drums', e.step16 / 4);
      Tone.Transport.schedule(tt0 => { const tt = tt0 + doff;
        const kit = e.kit || DRUM_KITS.rnb;
        const smp = (inst) => { const n = kit[inst]; return n ? playDrumSample(n, tt, e.vel) : false; };
        if (smp(e.inst)) return;
        if (e.inst === 'shekere' || e.inst === 'shaker') { AE.hat.triggerAttackRelease('G6', '32n', tt, e.vel * 0.5); return; }
        if (e.inst === 'snap') { AE.clap808.triggerAttackRelease('16n', tt, e.vel * 0.8); return; }
        if (e.inst === 'clap') { AE.clap808.triggerAttackRelease('8n', tt, e.vel); return; }
        if (state.layers.drums.patch === '808') {
          switch (e.inst) {
            case 'kick': trig808kick(tt, e.vel); break;
            case 'snare': AE.snare808.triggerAttackRelease('C2', '8n', tt, e.vel); AE.snare.triggerAttackRelease('16n', tt, e.vel * 0.3); break;
            case 'hat': AE.hat808.triggerAttackRelease('G6', '32n', tt, e.vel); break;
            case 'ohat': AE.ohat808.triggerAttackRelease('G5', '8n', tt, e.vel); break;
            case 'ride': AE.cowbell808.triggerAttackRelease('A5', '8n', tt, e.vel * 0.8); break;
            case 'congaH': AE.tom808.triggerAttackRelease('G3', '8n', tt, e.vel); break;
            case 'congaL': AE.tom808.triggerAttackRelease('E3', '8n', tt, e.vel); break;
            case 'crash': AE.crash808.triggerAttackRelease('B5', '1m', tt, e.vel); break;
          }
          return;
        }
        switch (e.inst) {
          case 'kick': AE.kick.triggerAttackRelease('C1', '8n', tt, e.vel); break;
          case 'clave': AE.conga.triggerAttackRelease('G3', '16n', tt, e.vel); break;
          case 'snare': AE.snare.triggerAttackRelease('16n', tt, e.vel); AE.snareBody.triggerAttackRelease('G2', '16n', tt, e.vel * 0.5); break;
          case 'hat': AE.hat.triggerAttackRelease('G6', '32n', tt, e.vel); break;
          case 'ohat': AE.ride.triggerAttackRelease('G5', '8n', tt, e.vel); break;
          case 'ride': AE.ride.triggerAttackRelease('A5', '8n', tt, e.vel); break;
          case 'congaH': AE.conga.triggerAttackRelease('A3', '16n', tt, e.vel); break;
          case 'congaL': AE.conga.triggerAttackRelease('F3', '16n', tt, e.vel); break;
          case 'bell': AE.rim808.triggerAttackRelease('A5', '16n', tt, e.vel * 0.8); break;
          case 'crash': AE.crash.triggerAttackRelease('B5', '1m', tt, e.vel); break;
        }
      }, t);
    }
  }
  Tone.Transport.setLoopPoints(0, `${totalBars()}:0:0`);
  Tone.Transport.loop = true;
}

async function ensureAudio() {
  if (typeof Tone === 'undefined') return false;
  if (!state.audioReady) { buildAudio(); state.audioReady = true; loadInstruments(); loadDrumSamples(); loadGuitarSamples(); }
  try {
    await Tone.start();
    if (Tone.context.state !== 'running') await Tone.context.resume();
    /* iOS 某些版本需要二次唤醒 */
    if (Tone.context.state !== 'running') {
      setTimeout(() => { try { Tone.context.resume(); } catch (e) {} }, 150);
    }
  } catch (e) { /* 部分浏览器首次手势不完整，下一次点击会重试 */ }
  return Tone.context.state === 'running';
}

async function togglePlay() {
  if (typeof Tone === 'undefined') {
    alert('音频引擎加载失败，请检查网络后刷新页面');
    return;
  }
  if (!(await ensureAudio())) return;
  applyMix();
  if (state.playing) {
    Tone.Transport.stop();
    silenceSampleBuses();
    state.playing = false;
  } else {
    restoreSampleBuses();
    applyMix();
    (async () => {
      /* 播放闸：仅会话首次等待核心采样（6s 封顶），之后直接播 */
      const need = [SAMP_GUITAR[state.layers.guitar.patch], SAMP_KEYS, SAMP_BASS, SAMP_PAD[state.layers.synth.patch]].filter(Boolean);
      const t0 = Date.now();
      while (!state._gateDone && need.some(n => !SAMP.cache[state.sfBase + ':' + n]) && Date.now() - t0 < 6000) {
        need.forEach(n => ensureSample(n));
        sampStatus('正在准备音色…');
        await new Promise(r => setTimeout(r, 250));
        if (state.playing) return; /* 等待中被再次点击则取消 */
      }
      state._gateDone = true;
      sampStatus('');
      restoreSampleBuses();
      scheduleAll();
      Tone.Transport.start();
      state.playing = true;
      updatePlayBtn();
    })();
  }
  updatePlayBtn();
}
function updatePlayBtn() {
  const b = document.getElementById('btn-play');
  b.textContent = state.playing ? '⏹ 停止' : '▶ 播放';
  b.classList.toggle('playing', state.playing);
}

/* 播放中改动 → 立即重排 */
function reScheduleIfPlaying() {
  if (state.playing && state.audioReady) scheduleAll();
}
let _rsTimer = null;
function reScheduleDebounced() {
  clearTimeout(_rsTimer);
  _rsTimer = setTimeout(reScheduleIfPlaying, 160);
}

async function auditionLayer(layer) {
  if (!(await ensureAudio())) return;
  const t = Tone.now() + 0.05;
  const seq = [60, 64, 67];
  if (layer === 'guitar') {
    const name = SAMP_GUITAR[state.layers.guitar.patch];
    if (!GUITAR_SAMP.buffers[GUITAR_PATCH_MAP[state.layers.guitar.patch]]) loadGuitarSamples();
    for (let i = 0; i < 3; i++) {
      if (!playGuitarReal(state.layers.guitar.patch, seq[i], t + i * 0.22, 0.2, 0.9)) {
        const inst = name && sampOf(name, 'guitar');
        if (inst) inst.play(seq[i], t + i * 0.22, { duration: 0.2, gain: 0.9 });
        else AE.guitar.triggerAttackRelease(midiName(seq[i]), 0.2, t + i * 0.22, 0.8);
      }
    }
  } else if (layer === 'keys') {
    const inst = sampOf(SAMP_KEYS, 'keys');
    if (inst) inst.play([52, 55, 59, 62], t, { duration: 1.2, gain: 0.8 });
    else AE.keys.triggerAttackRelease(['E3','G3','B3','D4'], 1.2, t, 0.7);
  } else if (layer === 'bass') {
    const inst = sampOf(SAMP_BASS, 'bass');
    if (inst) { for (let i = 0; i < 3; i++) inst.play(40 + i * 5, t + i * 0.25, { duration: 0.25, gain: 1.1 }); }
    else for (let i = 0; i < 3; i++) AE.bass.triggerAttackRelease(midiName(40 + i * 5), 0.25, t + i * 0.25, 0.9);
  } else if (layer === 'drums') {
    const kit = DRUM_KITS[state.layers.drums.patch === '808' ? 's808' : (state.styles[0] in DRUM_KITS ? state.styles[0] : 'rnb')];
    playDrumSample(kit.kick, t, 0.9); playDrumSample(kit.snare || 'snare_room', t + 0.25, 0.8);
    playDrumSample(kit.hat || 'hat_closed', t + 0.5, 0.6);
  } else if (layer === 'synth') {
    const name = SAMP_PAD[state.layers.synth.patch];
    const inst = name && sampOf(name, 'pad');
    if (inst) inst.play([48, 52, 55, 59], t, { duration: 1.6, gain: 0.9 });
    else AE.synthPad.triggerAttackRelease(['C3','E3','G3','B3'], 1.6, t, 0.5);
  }
}

/* ---------- 试听单和弦 ---------- */
async function auditionChord(i) {
  if (!state.audioReady) { buildAudio(); state.audioReady = true; loadInstruments(); }
  await Tone.start();
  const chord = chordTimeline[i];
  if (!chord) return;
  const voicing = chooseVoicing(chord.pcs, null);
  AE.keys.triggerAttackRelease(voicing.map(midiName), '2n', Tone.now(), 0.6);
  AE.bass.triggerAttackRelease(midiName(36 + ((chord.rootPC + 12 - 4) % 12)), '2n', Tone.now(), 0.8);
}

/* ============================================================
 * MIDI 导出（SMF format 0，PPQ=96）
 * ============================================================ */
function buildMidi() {
  const PPQ = 96, tpb = PPQ; // 每拍 ticks = PPQ（每四分音符）——修复 4 倍时间压缩
  const ev = [];                 // {tick, order, bytes}
  const meta = (tick, type, data) => ev.push({ tick, order: 0, bytes: [0xFF, type, data.length, ...data] });
  const totalTicks = totalBars() * 4 * tpb;
  const noteOn = (tick, ch, note, vel) => ev.push({ tick, order: 2, bytes: [0x90 | ch, note, vel] });
  const noteOff = (tick, ch, note) => ev.push({ tick, order: 1, bytes: [0x80 | ch, note, 0] });
  /* swing 对齐：与 Tone.Transport.swing('16n') 一致，奇数 16 分位移 */
  const swingAdd = pos16 => (Math.round(pos16) % 2 === 1 ? Math.round(state.swing * tpb / 4) : 0);
  const notePair = (t, dur, ch, note, vel) => {
    if (t >= totalTicks) return;
    noteOn(t, ch, note, vel);
    noteOff(Math.min(t + Math.max(1, dur), totalTicks), ch, note);
  };

  const usPerQuarter = Math.round(60000000 / state.bpm);
  meta(0, 0x51, [(usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255]);
  meta(0, 0x58, [0x04, 0x02, 0x18, 0x08]);
  /* 乐器：ch0 失真吉他(29) ch1 电钢琴(4→GM5) ch2 指弹贝斯(33) */
  ev.push({ tick: 0, order: 0, bytes: [0xC0, 29] });
  ev.push({ tick: 0, order: 0, bytes: [0xC1, 4] });
  ev.push({ tick: 0, order: 0, bytes: [0xC2, 33] });

  for (const e of melodyEvents) {
    const t = Math.round(e.beat * tpb) + swingAdd(e.beat * 4);
    const dur = Math.round(e.dur * tpb);
    notePair(t, dur, 0, e.midi, clamp(Math.round(e.vel * 127), 25, 127));
  }
  for (const e of keysEvents) {
    const t = Math.round(e.beat * tpb) + swingAdd(e.beat * 4);
    const dur = Math.round(e.dur * tpb);
    for (const n of e.notes) notePair(t, dur, 1, n, clamp(Math.round(e.vel * 127), 20, 110));
  }
  for (const e of bassEvents) {
    const t = Math.round(e.beat * tpb) + swingAdd(e.beat * 4);
    const dur = Math.round(e.dur * tpb);
    notePair(t, dur, 2, e.midi, clamp(Math.round(e.vel * 127), 25, 120));
  }
  /* 合成器 Pad → ch3（GM 音色号按 Pad 类型） */
  const PAD_PROGRAM = { halo: 95, sweep: 96, warm: 90, choir: 92, strings: 51, polysynth: 91 };
  ev.push({ tick: 0, order: 0, bytes: [0xC3, PAD_PROGRAM[state.layers.synth.patch] || 90] });
  for (const e of synthEvents) {
    const t = Math.round(e.beat * tpb) + swingAdd(e.beat * 4);
    const dur = Math.round(e.dur * tpb);
    for (const n of e.notes) notePair(t, dur, 3, n, clamp(Math.round(e.vel * 127 * 1.4), 15, 100));
  }
  const DRUM_GM = { kick: 36, snare: 38, hat: 42, ohat: 46, ride: 51, bell: 56, congaH: 63, congaL: 64, crash: 49, shekere: 70, shaker: 70, clap: 39, snap: 37, clave: 75 };
  for (const e of drumEvents) {
    const t = Math.round(e.step16 * tpb / 4) + swingAdd(e.step16);
    const note = DRUM_GM[e.inst]; if (note === undefined) continue;
    notePair(t, Math.round(tpb / 4), 9, note, clamp(Math.round(e.vel * 127), 20, 127));
  }
  /* EOT 放在同一 tick 的所有事件之后（order 3 最大） */
  ev.push({ tick: totalTicks, order: 3, bytes: [0xFF, 0x2F, 0x00] });

  ev.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track = [];
  let last = 0;
  for (const e of ev) {
    let delta = e.tick - last; last = e.tick;
    /* varlen */
    const vl = [delta & 0x7F]; delta >>= 7;
    while (delta > 0) { vl.unshift((delta & 0x7F) | 0x80); delta >>= 7; }
    track.push(...vl, ...e.bytes);
  }
  const hdr = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255];
  const trk = [0x4D, 0x54, 0x72, 0x6B, (track.length >> 24) & 255, (track.length >> 16) & 255, (track.length >> 8) & 255, track.length & 255];
  return new Uint8Array([...hdr, ...trk, ...track]);
}

function exportMidi() {
  const data = buildMidi();
  const blob = new Blob([data], { type: 'audio/midi' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `motif_${pcName(state.keyRoot)}${state.mode}_${state.bpm}bpm.mid`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================
 * UI 渲染
 * ============================================================ */
const $ = sel => document.querySelector(sel);

/* 语义音色目标（方案2: 语义化EQ，MDPI 2016）：每层 亮度bright/空间space/厚度thick 0~1 */
const STYLE_TONE = {
  rnb:   { guitar:{b:0.35,s:0.55,t:0.15}, keys:{b:0.30,s:0.60,t:0.0}, bass:{b:0.30,s:0.15,t:0.0}, pad:{b:0.25,s:0.70,t:0.0}, drums:{b:0.45,s:0.15,t:0.2} },
  jazz:  { guitar:{b:0.40,s:0.35,t:0.10}, keys:{b:0.35,s:0.40,t:0.0}, bass:{b:0.35,s:0.10,t:0.0}, pad:{b:0.30,s:0.50,t:0.0}, drums:{b:0.50,s:0.20,t:0.1} },
  rock:  { guitar:{b:0.70,s:0.20,t:0.50}, keys:{b:0.50,s:0.20,t:0.2}, bass:{b:0.55,s:0.10,t:0.3}, pad:{b:0.40,s:0.30,t:0.2}, drums:{b:0.60,s:0.25,t:0.35} },
  bossa: { guitar:{b:0.50,s:0.35,t:0.05}, keys:{b:0.40,s:0.35,t:0.0}, bass:{b:0.35,s:0.10,t:0.0}, pad:{b:0.30,s:0.40,t:0.0}, drums:{b:0.50,s:0.20,t:0.1} },
  afro:  { guitar:{b:0.55,s:0.30,t:0.15}, keys:{b:0.50,s:0.25,t:0.1}, bass:{b:0.45,s:0.15,t:0.2}, pad:{b:0.40,s:0.30,t:0.1}, drums:{b:0.55,s:0.30,t:0.3} },
  hiphop:{ guitar:{b:0.40,s:0.50,t:0.20}, keys:{b:0.30,s:0.65,t:0.0}, bass:{b:0.25,s:0.10,t:0.3}, pad:{b:0.25,s:0.60,t:0.0}, drums:{b:0.50,s:0.40,t:0.4} },
};
function applyTone(layer) {
  if (!AE.ready) return;
  const t = (state.tone[layer] || { b: 0.5, s: 0.3, t: 0.2 });
  const perfMul = state.perf ? 0.5 : 1;
  const brightDb = -12 + t.b * 26;
  if (layer === 'guitar' && AE.toneEqGuitar) {
    AE.toneEqGuitar.high.value = brightDb;
    AE.toneEqGuitar.low.value = -4 + t.t * 6;
    AE.toneDistGuitar.distortion = t.t * 0.35;
    AE.sendGuitar.gain.value = t.s * 0.9 * perfMul;
  } else if (layer === 'keys' && AE.toneEqKeys) {
    AE.toneEqKeys.high.value = brightDb;
    AE.toneDistKeys.distortion = t.t * 0.25;
    AE.sendKeys.gain.value = t.s * 0.9 * perfMul;
  } else if (layer === 'bass' && AE.toneFilterBass) {
    AE.toneFilterBass.frequency.value = 400 + t.b * 9000; /* 200Hz(闷)~9.4kHz(亮)，默认不再闷 */
    AE.sendBass.gain.value = t.s * 0.25;
  } else if (layer === 'pad' && AE.toneEqPad) {
    AE.toneEqPad.high.value = brightDb;
    AE.sendPad.gain.value = t.s * 0.25; /* pad 自带大混响，space 发送减半防糊 */
  } else if (layer === 'drums' && AE.toneEqDrums) {
    AE.toneEqDrums.high.value = brightDb;
    AE.toneDistDrums.distortion = t.t * 0.07; /* 轻微饱和，避免鼓毛刺 */
    AE.sendDrums.gain.value = t.s * 0.7 * perfMul;
  }
}
function applyStyleTone(styleKey) {
  const tbl = STYLE_TONE[styleKey];
  if (!tbl) return;
  for (const layer of Object.keys(tbl)) {
    if (state.toneCustom[layer]) continue; /* 用户手动调过则保留 */
    state.tone[layer] = Object.assign({}, tbl[layer]);
    applyTone(layer);
  }
}

/* 风格音色性格：合唱/空间混响湿度（RnB 迷幻宽空间 / Jazz 丝滑干净 / Rock 干近 / Afro 打击前置） */
const STYLE_FX = {
  rnb:   { cw: 0.45, rw: 0.42 },
  jazz:  { cw: 0.25, rw: 0.22 },
  rock:  { cw: 0.08, rw: 0.1 },
  bossa: { cw: 0.3,  rw: 0.28 },
  afro:  { cw: 0.12, rw: 0.18 },
  hiphop:{ cw: 0.2,  rw: 0.28 },
};
function applyStyleFx(styleKey) {
  const fx = STYLE_FX[styleKey];
  if (!fx || !AE.ready || !AE.masterVerb) return;
  /* fx.cw→混响湿度, fx.rw→衰减长度映射 */
  AE.masterVerb.wet.value = Math.min(0.5, fx.cw * 0.6); /* 收敛：wash 会埋掉鼓和律动 */
  AE.masterVerb.decay = 1 + fx.rw * 3.2;
}

/* ---------- 风格整体配置：切换风格 = 整套编曲画面变换 ---------- */
const STYLE_SETUP = {
  rnb:   { guitar: 'clean',  keys: 'comp',  drums: 'full',  swing: 22, bpm: 85,  synth: 'choir' },
  jazz:  { guitar: 'jazz',   keys: 'comp',  drums: 'auto',  swing: 41, bpm: 110, synth: 'warm' }, /* swing 2.39:1 偏好窗口 */
  rock:  { guitar: 'dist',   keys: 'auto',  drums: 'drive', swing: 0,  bpm: 122, synth: 'sweep' },
  bossa: { guitar: 'nylon',  keys: 'auto',  drums: 'auto',  swing: 2,  bpm: 78,  synth: 'warm' }, /* 138=Samba，78 才是 Bossa */
  afro:  { guitar: 'clean',  keys: 'auto',  drums: 'drive', swing: 4,  bpm: 104, synth: 'halo' },
  hiphop:{ guitar: 'clean',  keys: 'pad',   drums: 'auto',  swing: 0,  bpm: 140, synth: 'halo' }, /* trap 标准速度 */
};

function setStyles(list) {
  state.styles = list.slice();
  document.querySelectorAll('#style-chips .chip').forEach(chip => {
    chip.classList.toggle('active', state.styles.includes(chip.dataset.style));
  });
  $('#fusion-hint').textContent = state.styles.length > 1
    ? `已选：${state.styles.map(k => STYLES[k].name).join(' + ')} · 节奏/音阶/律动按小节交替融合，编曲配置保持你的设置`
    : `已选：${STYLES[state.styles[0]].name} · 已自动配置该风格的吉他采样/鼓组/速度/Swing，可再微调`;
}

function applyStyleSetup(styleKey) {
  const cfg = STYLE_SETUP[styleKey];
  if (!cfg) return;
  state.layers.guitar.patch = cfg.guitar;
  state.layers.keys.patch = cfg.keys;
  state.layers.drums.patch = cfg.drums;
  state.layers.synth.patch = cfg.synth;
  state.bpm = cfg.bpm;
  state.swing = cfg.swing / 100;
  const bpmEl = $('#ctl-bpm'); if (bpmEl) { bpmEl.value = cfg.bpm; $('#bpm-val').textContent = cfg.bpm; }
  const swEl = $('#ctl-swing'); if (swEl) { swEl.value = cfg.swing; $('#swing-val').textContent = cfg.swing; }
  document.querySelectorAll('#layers .layer').forEach(row => {
    const layer = row.dataset.layer;
    if (cfg[layer] !== undefined) row.querySelector('.patch').value = cfg[layer];
  });
  applyGuitarPatch();
  applyStyleFx(styleKey);
  applyStyleTone(styleKey);
  const gn = SAMP_GUITAR[cfg.guitar];
  if (gn) ensureSample(gn).then(() => autoAlignTimbres(styleKey));
  else autoAlignTimbres(styleKey);
}

function populateStatic() {
  /* 调性 */
  const keySel = $('#ctl-key');
  keySel.innerHTML = NOTES.map((n, i) => `<option value="${i}">${n}</option>`).join('');
  keySel.value = state.keyRoot;
  /* 预设 */
  const ps = $('#preset-select');
  ps.innerHTML = PRESETS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  ps.value = state.presetId;
  updatePresetDesc();
  const sfSel = document.getElementById('ctl-sfbase');
  if (sfSel) sfSel.value = state.sfBase;
}

function updatePresetDesc() {
  const p = PRESETS.find(x => x.id === state.presetId);
  $('#preset-desc').textContent = p ? p.desc : '自定义进行';
}

/* ---------- 音阶显示 ---------- */
function renderScale() {
  const mode = MODES[state.mode];
  $('#scale-display').innerHTML = mode.offsets
    .map((off, i) => `<span class="kn">${ROMAN[i]} · ${pcName(state.keyRoot + off)}${mode.degQ[i] ? ' ' + CHORDS[mode.degQ[i]].sym : ''}</span>`)
    .join('') + `<span class="kn tone">${mode.name}音阶：${mode.offsets.map(o => pcName(state.keyRoot + o)).join(' ')}</span>`;
}

/* ---------- 和弦槽 ---------- */
function renderSlots() {
  const wrap = $('#slots');
  wrap.innerHTML = '';
  chordTimeline.forEach((chord, i) => {
    const slot = state.slots[i];
    const div = document.createElement('div');
    div.className = 'slot';
    div.innerHTML = `
      <div class="slot-head">
        <span class="bar-num">小节 ${i + 1}</span>
        <button class="audition" title="试听">▶</button>
        ${state.slots.length > 2 ? '<button class="del" title="删除">×</button>' : ''}
      </div>
      <div class="chord-name" title="点击试听">${chord.name}</div>
      <div class="roman">${chord.roman}<sup style="font-size:9px">${chord.ext}</sup></div>
      <select class="deg-sel" title="级数">
        ${[1, 2, 3, 4, 5, 6, 7].map(d => {
          const opts = [{ v: 0, t: '' }, { v: -1, t: '♭' }, { v: 1, t: '♯' }]
            .map(a => `<option value="${d}:${a.v}" ${slot.d === d && (slot.acc || 0) === a.v ? 'selected' : ''}>${a.t}${ROMAN[d - 1]}</option>`).join('');
          return opts;
        }).join('')}
      </select>
      <select class="q-sel" title="和弦性质">
        <option value="auto" ${slot.q === 'auto' ? 'selected' : ''}>自动（按风格延伸）</option>
        ${CHORD_GROUPS.map(g => `<optgroup label="${g.title}">${
          Object.keys(CHORDS).filter(k => CHORDS[k].grp === g.grp)
            .map(k => `<option value="${k}" ${slot.q === k ? 'selected' : ''}>${CHORDS[k].sym || '三和弦'} · ${CHORDS[k].label}</option>`).join('')
        }</optgroup>`).join('')}
      </select>
      <div class="chord-tones">${chord.iv.map(iv => pcName(chord.rootPC + iv)).join(' · ')}</div>
      <div class="chord-func">${chord.func}</div>`;
    div.querySelector('.audition').onclick = () => auditionChord(i);
    div.querySelector('.chord-name').onclick = () => auditionChord(i);
    const del = div.querySelector('.del');
    if (del) del.onclick = () => { state.slots.splice(i, 1); regenerate('chord'); };
    div.querySelector('.deg-sel').onchange = ev => {
      const [d, a] = ev.target.value.split(':').map(Number);
      state.slots[i].d = d; state.slots[i].acc = a;
      markCustom(); regenerate('chord');
    };
    div.querySelector('.q-sel').onchange = ev => {
      state.slots[i].q = ev.target.value;
      markCustom(); regenerate('chord');
    };
    wrap.appendChild(div);
  });
  renderExplain();
}

function markCustom() {
  state.presetId = 'custom';
  $('#preset-select').value = 'custom';
  if (![...$('#preset-select').options].some(o => o.value === 'custom')) {
    const o = document.createElement('option'); o.value = 'custom'; o.textContent = '自定义进行';
    $('#preset-select').appendChild(o); $('#preset-select').value = 'custom';
  }
  updatePresetDesc();
}

/* ---------- 走向说明 ---------- */
function renderExplain() {
  const names = chordTimeline.map(c => c.name);
  const degFlow = chordTimeline.map(c => `${c.roman}${c.ext}`).join(' – ');
  const uniqFuncs = Array.from(new Set(chordTimeline.map(c => c.func.split('（')[0])));
  const barWord = state.slots.length === 12 ? '12 小节布鲁斯式长循环' :
    state.slots.length >= 8 ? '8 小节 AA\' 两段体循环' : state.slots.length + ' 小节循环';
  $('#prog-explain').innerHTML = `
    <div class="deg-flow">${degFlow}</div>
    <div><b>走向：</b>${names.join(' → ')}（${barWord}，每小节一和弦）</div>
    <div><b>级数功能：</b>${chordTimeline.map(c => `${c.roman}${c.ext}=${c.func}`).join('，')}</div>
    <div><b>调性框架：</b>${pcName(state.keyRoot)} ${MODES[state.mode].name} · 功能分组：${uniqFuncs.join(' / ')}。
    属功能和弦（${chordTimeline.filter(c => c.func.startsWith('属')).map(c => c.roman).join('、') || '无'}）制造张力，主/下属解决之。</div>`;
}

/* ---------- 钢琴卷帘（可编辑） ---------- */
let selNote = null;    // 选中的旋律事件
let drag = null;       // { mode, ev, grabDelta }
const rollCache = { rects: [], lo: 0, hi: 127, cellW: 1, labelW: 54, topPad: 22, plotH: 1, total16: 16 };

function renderRoll() {
  const cv = $('#roll');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = 230;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const bars = totalBars();
  const labelW = 54, topPad = 30, botPad = 20;
  const plotW = W - labelW - 6, plotH = H - topPad - botPad;
  const total16 = bars * 16;
  const cellW = plotW / total16;

  let lo = 127, hi = 0;
  for (const e of melodyEvents) { lo = Math.min(lo, e.midi); hi = Math.max(hi, e.midi); }
  if (lo > hi) { lo = 60; hi = 80; }
  lo -= 2; hi += 2;
  const yOf = m => topPad + (hi - m) / (hi - lo) * plotH;

  /* 网格（纸面发丝线） */
  ctx.lineWidth = 1;
  for (let s = 0; s <= total16; s++) {
    const x = labelW + s * cellW;
    ctx.beginPath(); ctx.moveTo(x, topPad); ctx.lineTo(x, H - botPad);
    if (s % 16 === 0) { ctx.strokeStyle = 'rgba(36,39,42,.28)'; ctx.lineWidth = 1.2; }
    else if (s % 4 === 0) { ctx.strokeStyle = 'rgba(36,39,42,.09)'; ctx.lineWidth = 1; }
    else { ctx.strokeStyle = 'rgba(36,39,42,.04)'; ctx.lineWidth = 1; }
    ctx.stroke();
  }
  /* 小节标签 + 和弦 */
  ctx.font = '10px -apple-system, "PingFang SC", sans-serif';
  for (let b = 0; b < bars; b++) {
    const x = labelW + b * 16 * cellW;
    ctx.fillStyle = 'rgba(36,39,42,.38)';
    ctx.fillText(`${b + 1}`, x + 3, 22);
    const sec = sectionAt(b);
    if (sec.name && (b === 0 || sectionAt(b - 1).name !== sec.name)) {
      ctx.fillStyle = 'rgba(194,69,45,.85)';
      ctx.font = '9px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText(sec.name, x + 14, 12);
      ctx.font = '10px -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = 'rgba(36,39,42,.38)';
    }
    const chord = chordAtBar(b);
    ctx.fillStyle = 'rgba(194,69,45,.9)';
    ctx.fillText(chord.name, x + 12, 14);
  }
  /* 旋律音符（朱红笔触） */
  const rr = ctx.roundRect ? (x, y, w, h, r) => ctx.roundRect(x, y, w, h, r)
    : (x, y, w, h) => ctx.rect(x, y, w, h);
  rollCache.rects = [];
  for (const e of melodyEvents) {
    const x = labelW + e.beat * 4 * cellW;
    const w = Math.max(2.5, e.dur * 4 * cellW - 1);
    const y = yOf(e.midi);
    const grad = ctx.createLinearGradient(0, y, 0, y + 10);
    grad.addColorStop(0, `rgba(217,110,82,${0.55 + e.vel * 0.45})`);
    grad.addColorStop(1, `rgba(194,69,45,${0.55 + e.vel * 0.45})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    rr(x, y, w, 9, 3);
    ctx.fill();
    if (e === selNote) {
      ctx.strokeStyle = 'rgba(36,39,42,.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      rr(x - 1.5, y - 1.5, w + 3, 12, 4);
      ctx.stroke();
    }
    rollCache.rects.push({ ev: e, x, y, w });
  }
  Object.assign(rollCache, { lo, hi, cellW, labelW, topPad, plotH, total16, H });
  /* 尾标注 */
  if (melodyEvents.length) {
    ctx.fillStyle = 'rgba(36,39,42,.45)';
    ctx.font = '10px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(`${midiName(Math.min(...melodyEvents.map(e => e.midi)))} ~ ${midiName(Math.max(...melodyEvents.map(e => e.midi)))}`, 6, H - 6);
  } else {
    ctx.fillStyle = 'rgba(36,39,42,.35)';
    ctx.font = '11px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('在上方描述动机并点击「生成旋律」，或直接点击网格空白处手写音符', labelW + 14, H / 2);
  }
}

/* ---------- 卷帘编辑交互 ---------- */
function rollXY(e) {
  const rect = $('#roll').getBoundingClientRect();
  return { px: e.clientX - rect.left, py: e.clientY - rect.top };
}
function hitNote(px, py) {
  for (let i = rollCache.rects.length - 1; i >= 0; i--) {
    const r = rollCache.rects[i];
    if (px >= r.x - 2 && px <= r.x + r.w + 2 && py >= r.y - 3 && py <= r.y + 12) return r;
  }
  return null;
}
function pxToPitch(py) {
  const { hi, topPad, plotH } = rollCache;
  return clamp(Math.round(hi - (py - topPad) / plotH * (hi - rollCache.lo)), 24, 108);
}
function pxToBeat(px) {
  return clamp(Math.round((px - rollCache.labelW) / rollCache.cellW / 4 * 4) / 4, 0, state.slots.length * 4 - 0.25);
}

function bindRollEditor() {
  const cv = $('#roll');
  cv.style.touchAction = 'none';

  cv.addEventListener('pointerdown', e => {
    if (!chordTimeline.length) return;
    const { px, py } = rollXY(e);
    cv.setPointerCapture(e.pointerId);
    const hit = hitNote(px, py);
    if (hit) {
      selNote = hit.ev;
      const onEdge = px > hit.x + hit.w - 6;
      drag = { mode: onEdge ? 'resize' : 'move', ev: hit.ev };
    } else {
      /* 空白处：添加音符 */
      const beat = pxToBeat(px), midi = pxToPitch(py);
      const ev = { beat, midi, dur: 1, vel: 0.8 };
      melodyEvents.push(ev);
      melodyEvents.sort((a, b) => a.beat - b.beat);
      selNote = ev;
      drag = { mode: 'move', ev };
      state.melodyEdited = true;
      afterMelodyEdit(false);
    }
    renderRoll();
    e.preventDefault();
  });

  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const { px, py } = rollXY(e);
    const totalBeats = state.slots.length * 4;
    if (drag.mode === 'move') {
      drag.ev.beat = clamp(pxToBeat(px), 0, totalBeats - 0.25);
      drag.ev.midi = pxToPitch(py);
    } else {
      const end = clamp(pxToBeat(px) + 0.25, drag.ev.beat + 0.25, totalBeats);
      drag.ev.dur = Math.min(end - drag.ev.beat, 8);
    }
    melodyEvents.sort((a, b) => a.beat - b.beat);
    renderRoll();
    e.preventDefault();
  });

  const finish = () => {
    if (!drag) return;
    drag = null;
    state.melodyEdited = true;
    afterMelodyEdit(true);
  };
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', finish);

  cv.addEventListener('dblclick', e => {
    const { px, py } = rollXY(e);
    const hit = hitNote(px, py);
    if (hit) {
      melodyEvents.splice(melodyEvents.indexOf(hit.ev), 1);
      if (selNote === hit.ev) selNote = null;
      state.melodyEdited = true;
      afterMelodyEdit(true);
      renderRoll();
    }
  });
}

function afterMelodyEdit(reschedule) {
  renderStats();
  if (reschedule) reScheduleIfPlaying();
}

function deleteSelNote() {
  if (!selNote) return;
  melodyEvents.splice(melodyEvents.indexOf(selNote), 1);
  selNote = null;
  state.melodyEdited = true;
  afterMelodyEdit(true);
  renderRoll();
}

/* ---------- 让旋律适配新和弦（手动编辑后改和弦，由用户决定重配时机） ---------- */
function updateRematchBtn(regenJustHappened) {
  const btn = document.getElementById('btn-rematch');
  if (!btn) return;
  btn.hidden = regenJustHappened || !state.melodyEdited;
}
function rematchMelody() {
  genMelody();
  state.melodyEdited = false;
  const btn = document.getElementById('btn-rematch');
  if (btn) btn.hidden = true;
  selNote = null;
  renderRoll();
  renderStats();
  reScheduleIfPlaying();
}

/* ---------- 旋律统计 / 参数回显 ---------- */
function renderStats() {
  if (!melodyEvents.length) { $('#melody-stats').innerHTML = ''; return; }
  const n = melodyEvents.length;
  const leaps = melodyEvents.slice(1).filter((e, i) => Math.abs(e.midi - melodyEvents[i].midi) > 2).length;
  const range = `${midiName(Math.min(...melodyEvents.map(e => e.midi)))} ~ ${midiName(Math.max(...melodyEvents.map(e => e.midi)))}`;
  const p = state._params || {};
  const dirName = { up: '上行', down: '下行', wave: '波浪', orbit: '环绕' };
  $('#melody-stats').innerHTML =
    `<b>${n}</b> 个音 · 音域 <b>${range}</b> · 跳进占比 <b>${Math.round(leaps / (n - 1) * 100)}%</b> · ` +
    `走向 <b>${dirName[p.dir] || '波浪'}</b>${p.blue ? ' · 含蓝调音' : ''} · <b>${state.slots.length}</b> 小节 · <b>${state.bpm}</b> BPM`;
  /* 风格对齐仪表 */
  const domStyle = state.styles.length === 1 ? state.styles[0] : null;
  const am = domStyle ? alignMetrics(domStyle) : null;
  const alignTxt = am
    ? ` · 对齐 <b>${STYLES[domStyle].name}</b>：音程 <b>${am.ivMatch}%</b> · 节奏 <b>${am.rhythmCov}%</b> · 强拍和弦音 <b>${am.chordPct}%</b>`
    : ' · 融合模式（对齐指标需单风格）';
  $('#melody-stats').innerHTML += `<br><span style="font-size:11px;color:var(--ink-3)">风格对齐仪表${alignTxt}</span>`;
  const readout = [];
  readout.push(`走向=${dirName[p.dir]}`);
  readout.push(`级进倾向=${Math.round(p.stepP * 100)}%`);
  readout.push(`密度=${p.density > 0.7 ? '密集' : p.density < 0.3 ? '稀疏' : '适中'}`);
  readout.push(`音域=${p.regLo >= 67 ? '偏高' : p.regLo <= 58 ? '偏低' : '中'}（${p.regLo}-${p.regHi}）`);
  readout.push(`时值=${p.durBias > 0.6 ? '偏长' : p.durBias < 0.3 ? '偏短' : '均衡'}`);
  readout.push(`重复=${p.rep > 0.7 ? '高（动机反复）' : p.rep < 0.3 ? '低（多变）' : '中'}`);
  if (p.blue) readout.push('蓝调音✓');
  $('#param-readout').textContent = '解析 → ' + readout.join(' · ');
}

/* ============================================================
 * 主流程
 * ============================================================ */
function regenerate(reason) {
  buildChordTimeline();
  /* 旋律重配规则：动机/换版/预设/调性调式变化 → 总是重新生成；
     和弦/风格/编配变化 → 自动生成的旋律立即适配新和弦，仅手动编辑过的旋律予以保留 */
  const regenMelody = !state.melodyEdited || !melodyEvents.length ||
    ['motive', 'reroll', 'example', 'preset', 'key', 'mode'].includes(reason);
  if (regenMelody) { genMelody(); state.melodyEdited = false; }
  selNote = null; drag = null;
  updateRematchBtn(regenMelody);
  genBass();
  genKeys();
  genSynthPad();
  genDrums();
  applyCompositionRules(); /* 作曲规则器：调度前检测修正 */
  renderSlots();
  renderRoll();
  renderStats();
  renderScale();
  reScheduleIfPlaying();
}

function loadPreset(id) {
  const p = PRESETS.find(x => x.id === id);
  if (!p) return;
  state.presetId = id;
  state.slots = p.slots.map(s => ({ d: s.d, acc: s.acc || 0, q: s.q || 'auto' }));
  if (p.mode) { state.mode = p.mode; $('#ctl-mode').value = p.mode; }
  updatePresetDesc();
  regenerate('preset');
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  /* 走带 */
  $('#btn-play').onclick = togglePlay;
  $('#ctl-bpm').oninput = e => {
    state.bpm = +e.target.value;
    $('#bpm-val').textContent = state.bpm;
    reScheduleDebounced();
  };
  $('#ctl-swing').oninput = e => {
    state.swing = +e.target.value / 100;
    $('#swing-val').textContent = e.target.value;
    reScheduleDebounced();
  };
  $('#ctl-key').onchange = e => { state.keyRoot = +e.target.value; regenerate('key'); };
  $('#ctl-mode').onchange = e => { state.mode = e.target.value; regenerate('mode'); };
  $('#ctl-master').oninput = e => { state.master = e.target.value / 100; applyMix(); };

  /* 风格 */
  document.querySelectorAll('#style-chips .chip').forEach(chip => {
    chip.onclick = () => {
      const s = chip.dataset.style;
      const idx = state.styles.indexOf(s);
      if (idx >= 0) {
        if (state.styles.length > 1) state.styles.splice(idx, 1);
      } else state.styles.push(s);
      setStyles(state.styles);
      if (state.styles.length === 1) applyStyleSetup(state.styles[0]);
      regenerate('style');
    };
  });

  /* 动机 */
  $('#btn-gen').onclick = () => { state.motiveText = $('#motive-text').value.trim(); state.seedSalt = 0; regenerate('motive'); };
  $('#btn-reroll').onclick = () => { state.motiveText = $('#motive-text').value.trim(); state.seedSalt++; regenerate('reroll'); };
  document.querySelectorAll('#examples .ex').forEach(b => {
    b.onclick = () => { $('#motive-text').value = b.textContent; state.seedSalt = 0; state.motiveText = b.textContent; regenerate('example'); };
  });

  /* 声部 */
  document.querySelectorAll('#layers .layer').forEach(row => {
    const layer = row.dataset.layer;
    row.querySelector('input[type=checkbox]').onchange = e => { state.layers[layer].on = e.target.checked; applyMix(); reScheduleIfPlaying(); };
    row.querySelector('.patch').onchange = e => {
      state.layers[layer].patch = e.target.value;
      applyGuitarPatch();
      const pn = SAMP_GUITAR[e.target.value] || SAMP_PAD[e.target.value];
      if (pn && !sampOf(pn)) {
        sampStatus('加载音色中…');
        ensureSample(pn).then(() => { sampStatus(''); regenerate('patch'); });
        if (!state.playing) regenerate('patch'); /* 未播放先刷新界面，声音用回退 */
      } else {
        regenerate('patch');
      }
    };
    row.querySelector('.vol').oninput = e => { state.layers[layer].vol = e.target.value / 100; applyMix(); };
  });

  /* 语义音色面板 */
  document.querySelectorAll('.tone-toggle').forEach(btn => {
    btn.onclick = ev => {
      ev.stopPropagation();
      document.getElementById('tone-panel-' + btn.dataset.tone).classList.toggle('open');
    };
  });
  document.querySelectorAll('.tone-slider').forEach(sl => {
    sl.oninput = () => {
      const layer = sl.dataset.layer, p = sl.dataset.param;
      state.tone[layer] = state.tone[layer] || { b: 0.5, s: 0.3, t: 0.2 };
      state.tone[layer][p] = sl.value / 100;
      state.toneCustom[layer] = true;
      try { localStorage.setItem('motif_tone', JSON.stringify(state.tone)); localStorage.setItem('motif_tonecustom', JSON.stringify(state.toneCustom)); } catch (e) {}
      applyTone(layer);
    };
  });
  document.querySelectorAll('.tone-reset').forEach(btn => {
    btn.onclick = () => {
      const layer = btn.dataset.layer;
      delete state.toneCustom[layer];
      const dom = state.styles.length === 1 ? state.styles[0] : null;
      if (dom && STYLE_TONE[dom] && STYLE_TONE[dom][layer]) state.tone[layer] = Object.assign({}, STYLE_TONE[dom][layer]);
      try { localStorage.setItem('motif_tone', JSON.stringify(state.tone)); localStorage.setItem('motif_tonecustom', JSON.stringify(state.toneCustom)); } catch (e) {}
      applyTone(layer);
      document.querySelectorAll('.tone-slider[data-layer="' + layer + '"]').forEach(sl => {
        sl.value = Math.round((state.tone[layer] ? state.tone[layer][sl.dataset.param] : 0.5) * 100);
      });
    };
  });

  const structEl = document.getElementById('ctl-structure');
  if (structEl) structEl.onchange = () => { state.structure = structEl.value; regenerate('patch'); };
  const perfEl = document.getElementById('ctl-perf');
  if (perfEl) {
    perfEl.checked = state.perf;
    perfEl.onchange = () => {
      state.perf = perfEl.checked;
      try { localStorage.setItem('motif_perf', state.perf ? '1' : '0'); } catch (e) {}
      for (const layer of ['guitar','keys','bass','pad','drums']) applyTone(layer);
      regenerate('patch');
    };
  }

  /* 逐层试听：点声部名播 3 个示例音 */
  document.querySelectorAll('#layers .lname').forEach(el => {
    el.style.cursor = 'pointer';
    el.title = '点击试听该声部音色';
    el.onclick = () => auditionLayer(el.closest('.layer').dataset.layer);
  });

  /* 进行 */
  $('#preset-select').onchange = e => loadPreset(e.target.value);
  $('#btn-add-slot').onclick = () => {
    const last = state.slots[state.slots.length - 1];
    state.slots.push({ ...last });
    markCustom(); regenerate('add');
  };

  /* 导出 */
  $('#btn-midi').onclick = exportMidi;
  $('#btn-copy-prog').onclick = () => {
    const text = chordTimeline.map(c => `${c.name}（${c.roman}${c.ext}）`).join(' → ');
    navigator.clipboard.writeText(`${pcName(state.keyRoot)} ${MODES[state.mode].name} ${state.bpm}BPM：${text}`).then(() => {
      $('#btn-copy-prog').textContent = '✓ 已复制';
      setTimeout(() => $('#btn-copy-prog').textContent = '📋 复制和弦走向', 1200);
    });
  };

  /* 卷帘编辑 */
  bindRollEditor();
  $('#btn-del-note').onclick = deleteSelNote;
  $('#btn-rematch').onclick = rematchMelody;
  $('#btn-reset-melody').onclick = () => { state.melodyEdited = false; regenerate('motive'); };

  document.getElementById('ctl-sfbase').onchange = e => {
    state.sfBase = e.target.value;
    try { localStorage.setItem('motif_sf', state.sfBase); } catch (err) {}
    sampStatus('音色库已切换：' + (state.sfBase === 'soundfont2' ? 'MusyngKite' : 'FluidR3'));
    reScheduleIfPlaying();
  };

  window.addEventListener('resize', renderRoll);
  /* 移动端音频解锁：首次触摸即简历 AudioContext */
  const unlock = () => ensureAudio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('touchend', unlock, { once: true });
  window.addEventListener('keydown', e => {
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (e.code === 'Space' && !/textarea|input|select/i.test(tag)) {
      e.preventDefault(); togglePlay();
    }
    if ((e.code === 'Delete' || e.code === 'Backspace') && selNote && !/textarea|input|select/i.test(tag)) {
      e.preventDefault(); deleteSelNote();
    }
  });
}

/* ---------- 启动 ---------- */
function init() {
  populateStatic();
  bindEvents();
  loadPreset(state.presetId);
  if (/iP(hone|ad|od)/.test(navigator.userAgent)) {
    const h = document.getElementById('ios-hint');
    if (h) h.hidden = false;
  }
}
document.addEventListener('DOMContentLoaded', init);
