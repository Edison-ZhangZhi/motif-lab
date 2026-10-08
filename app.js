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
  bpm: 92, swing: 0.18, master: 0.8, meter: 'm44',
  presetId: 'rnb-1625',
  slots: [],             // { d, acc, q }
  motiveText: '',
  seedSalt: 0,
  layers: {
    guitar: { on: true, vol: 0.8, patch: 'crunch' },
    keys:   { on: true, vol: 0.55, patch: 'comp' },
    bass:   { on: true, vol: 0.7, patch: 'auto' },
    drums:  { on: true, vol: 0.9, patch: 'auto' },
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
let hornEvents = [];      // v5 horn 层 { beat, notes:[midi], dur, vel }
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
  /* v5 和弦九维：延伸和弦为默认体（rnb/jazz/bossa/afro/hiphop），rock 保持三和弦 */
  const EXT_UP = { maj: 'maj9', min: 'min9', dom: '9', sus: 'sus4', dim: 'dim7', aug: 'aug' };
  const EXT_STYLE = ['rnb', 'jazz', 'bossa', 'afro', 'hiphop'].includes(state.styles[0]);
  chordTimeline = state.slots.map(slot => {
    let qKey = autoQualityFor(slot, state.styles, rng);
    if (EXT_STYLE && (!slot.q || slot.q === 'auto') && CHORDS[EXT_UP[(CHORDS[qKey] || {}).grp]] && rng() < 0.7) qKey = EXT_UP[CHORDS[qKey].grp];
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

/* ===== v5 拍子系统（生成/调度共享网格常量）=====
   4/4 = 16步·4拍 | 3/4 = 12步·3拍 | 6/8·12/8 = 12步·2拍(附点四分音符拍) */
function SBAR() { return state.meter === 'm44' ? 16 : 12; }
function BPB() { return state.meter === 'm34' ? 3 : state.meter === 'm68' ? 2 : 4; }
function SPB() { return state.meter === 'm68' ? 6 : 4; }
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
    if (state.structure === 'groove' && bar0 < 8) continue; /* v5：鼓+贝斯先铺 8 小节律动，旋律后入 */
    const styleKey = state.styles.length > 1 ? state.styles[bar0 % state.styles.length] : state.styles[0];
    const energy = sectionAt(bar0).energy;
    const params = mergeDna(styleKey, baseParams);
    const isAfro = styleKey === 'afro';
    /* v4 M1/M2 问答句结构：偶数组=问（上扬悬停 2/6 级），奇数组=答（尾反转落解决音） */
    const isQuestion = g % 2 === 0;
    /* M3 副歌加密：副歌/高能量段密度 +0.15 */
    const effDensity = clamp(params.density + (energy > 0.7 ? 0.15 : 0), 0, 1);

    /* 选细胞：复用(重复/呼应)或新选 */
    let cell;
    const reuse = lastCell && (isAfro ? (g % 2 === 1) : (cellRng() < params.rep));
    if (reuse && lastCell) {
      cell = { r: lastCell.r.slice(), iv: lastCell.iv.slice() };
      const rv = rng();
      if ((isAfro || (!isQuestion && cellRng() < 0.5)) && g % 2 === 1) cell.iv = cell.iv.map(v => -v); /* 呼应/答句：反向 */
      else if (rv < 0.35) cell.iv[cell.iv.length - 1] += (cellRng() < 0.5 ? 2 : -2); /* 变尾 */
      else if (rv < 0.6) cell.iv = cell.iv.map(v => v + (cellRng() < 0.5 ? 2 : -2)); /* 模进：整体平移 */
      else if (rv < 0.75) cell.r = cell.r.map((r2, i) => i === cell.r.length - 1 ? Math.max(0, r2 - 1) : r2); /* 尾音提前一个16分 */
    } else {
      let pool = (CELL_LIB[styleKey] || CELL_LIB.rnb).slice();
      /* 文本偏好过滤：级进/跳进 */
      if (baseParams._set.has('stepP')) {
        const avg = c => c.iv.reduce((a, b) => a + Math.abs(b), 0) / c.iv.length;
        const wanted = baseParams.stepP > 0.7 ? pool.filter(c => avg(c) <= 3.5)
          : baseParams.stepP < 0.45 ? pool.filter(c => avg(c) >= 3) : pool;
        if (wanted.length) pool = wanted;
      }
      /* 密度限制 onset 数（用组级 effDensity） */
      const maxOn = effDensity > 0.6 ? 6 : effDensity < 0.3 ? 2 : 4;
      const fit = pool.filter(c => c.r.length <= maxOn + 1);
      if (fit.length) pool = fit;
      /* 走向偏好 */
      const dirUp = baseParams.dir === 'up' ? 1 : baseParams.dir === 'down' ? -1 : 0;
      let tw = pool.map(c => {
        let w = c.w;
        const s = c.iv[c.iv.length - 1];
        if (dirUp > 0) w *= s >= 0 ? 1.8 : 0.6;
        if (dirUp < 0) w *= s <= 0 ? 1.8 : 0.6;
        /* M1/M2：问句偏上扬尾音、答句偏回落尾音 */
        if (isQuestion) w *= s >= 0 ? 1.9 : 0.55;
        else w *= s <= 0 ? 1.9 : 0.55;
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
      const bar = bar0 + Math.floor(on16 / SBAR());
      if (bar >= bars) return;
      const on = on16 % SBAR();
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
      placed.push({ beat: bar * BPB() + on / SPB(), on16: on, midi: m, i });
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
    if (effDensity > 0.6 && placed.length) {
      cell.r.forEach((on16b, i) => {
        const bar = bar0 + Math.floor((on16b + SBAR()) / SBAR());
        if (bar >= bars) return;
        const on = (on16b + SBAR()) % SBAR();
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
        if (m !== null) { placed.push({ beat: bar * BPB() + on / SPB(), on16: on, midi: m, i }); prev = m; }
      });
      placed.sort((a, b) => a.beat - b.beat);
    }
    /* 写入事件：时值架构 + 分风格力度 */
    const isLastGroup = g === groups - 1;
    const MAXSUS16 = { rnb: 12, jazz: 10, bossa: 10, rock: 8, afro: 6, hiphop: 12 };
    const susCap = MAXSUS16[styleKey] || 8;
    const groupEndBeat = (bar0 + GROUP) * BPB();
    placed.sort((a, b) => a.beat - b.beat);
    placed.forEach((p, idx) => {
      const strong = p.on16 % 4 === 0;
      const lastOfCell = idx === placed.length - 1;
      /* M1/M2 句尾处理：问句悬停在和弦 2/6 级（不解决），答句大概率回和弦音 */
      if (lastOfCell && !isLastGroup) {
        const chF = chordAtBar(Math.floor(p.beat / 4));
        if (isQuestion) {
          const susp = [((chF.rootPC + 2) % 12 + 12) % 12, ((chF.rootPC + 9) % 12 + 12) % 12];
          let best2 = null, bd4 = 99;
          for (let mm = p.midi - 5; mm <= p.midi + 5; mm++) {
            if (susp.includes(((mm % 12) + 12) % 12) && Math.abs(mm - p.midi) < bd4) { bd4 = Math.abs(mm - p.midi); best2 = mm; }
          }
          if (best2 !== null && bd4 <= 4) p.midi = best2;
        } else if (cellRng() < 0.7) {
          let best2 = null, bd4 = 99;
          for (let mm = p.midi - 5; mm <= p.midi + 5; mm++) {
            if (chF.pcs.includes(((mm % 12) + 12) % 12) && Math.abs(mm - p.midi) < bd4) { bd4 = Math.abs(mm - p.midi); best2 = mm; }
          }
          if (best2 !== null) p.midi = best2;
        }
      }
      /* v4.1 时值架构：时值默认延伸到下一 onset（连线写进音符本身），句尾长音收束乐句。
         线上实测旧版 93% 音符 ≤0.5 拍——这是"一颗颗蹦"的作曲层根因 */
      const nextOn = idx + 1 < placed.length ? placed[idx + 1].beat
        : (isLastGroup ? p.beat + susCap / 4 : groupEndBeat);
      let dur16 = Math.round((nextOn - p.beat) * 4);
      dur16 = clamp(dur16, 1, susCap);
      if (lastOfCell && !isLastGroup && dur16 < 4 && styleKey !== 'afro') dur16 = Math.min(4, susCap); /* 句尾保底 1 拍 */
      let vel = (strong ? 0.82 : 0.62) + rng() * 0.14;
      if (styleKey === 'rock') vel = strong ? 0.9 + rng() * 0.08 : vel * 0.82;
      else if (styleKey === 'bossa') vel *= 0.88 + 0.24 * (p.on16 / SBAR());
      else if (styleKey === 'rnb') vel *= 0.85 + 0.25 * (p.on16 / SBAR());
      if (idx === 0) vel += 0.06; // 动机头重音
      events.push({ beat: p.beat, midi: p.midi, dur: dur16 / 4, vel });
    });
  }

  /* v4 M4-M6 + 连线标记：切分拖拍 / 装饰语汇 / 轮廓约束 / tie-breath */
  postMelodyCraft(events, rng, firstParams);
  melodyFlowPass(events, rng, firstStyle); /* v4.2 流动性整形 */
  melodyRhythmPass(events, rng, firstStyle); /* v5.2 节奏塑形：articulation 对比 + 休止 + 抢拍 */
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
  melodyEvents = events.filter(e => e.beat >= 0); /* v5：负拍预示音拦截 */
  state._params = firstParams;
}

/* ================= v4.2 流动性整形：跨组连线 + 乐句力度拱 + 圆滑音标记 =================
   线上 v4.1 实测：组内衔接率 86-91%，但组与组之间仍"断气"——乐句级流动性靠本通道补齐 */
const FLOW_SUS_BEATS = { rnb: 4, jazz: 3.5, bossa: 3.5, rock: 3, afro: 2, hiphop: 4 };
function melodyFlowPass(events, rng, styleKey) {
  if (!events.length) return;
  const core = events.filter(e => !e.ghost).sort((a, b) => a.beat - b.beat);
  const susCap = FLOW_SUS_BEATS[styleKey] || 3;
  /* 1) 跨组连线：时值延伸到下一 onset（风格上限内），乐句内部不许断气 */
  for (let i = 0; i < core.length; i++) {
    const e = core[i];
    const nxt = i + 1 < core.length ? core[i + 1] : null;
    const gap = nxt ? nxt.beat - e.beat : susCap;
    e.dur = clamp(Math.min(gap, susCap), 0.25, susCap);
  }
  /* 2) 乐句力度拱：组内正弦拱（中段最强）、组尾 taper、组头轻 accent——真实乐手的呼吸 */
  const GROUP_BEATS = 2 * BPB(); /* v5 两小节一乐句（m44=8拍，与原一致） */
  let gs = Math.floor(core[0].beat / GROUP_BEATS) * GROUP_BEATS;
  let phrase = [];
  const flush = () => {
    if (!phrase.length) return;
    phrase.forEach((e, j) => {
      const pos = phrase.length > 1 ? j / (phrase.length - 1) : 0.5;
      e.vel *= 0.88 + 0.24 * Math.sin(Math.PI * pos);
      if (j === phrase.length - 1) e.vel *= 0.85;
      if (j === 0) e.vel = Math.min(1, e.vel + 0.04);
    });
    phrase = [];
  };
  for (const e of core) {
    if (e.beat >= gs + GROUP_BEATS) { flush(); gs = Math.floor(e.beat / GROUP_BEATS) * GROUP_BEATS; }
    phrase.push(e);
  }
  flush();
  /* 3) 圆滑音：贴接且级进 → 后音标记 slur（演奏层轻奏，hammer-on 感） */
  for (let i = 0; i + 1 < core.length; i++) {
    const e = core[i], n = core[i + 1];
    if (n.beat - (e.beat + e.dur) <= 0.06 && n.midi !== e.midi && Math.abs(n.midi - e.midi) <= 2) n.slur = true;
  }
}

/* ================= v5.2 节奏塑形通道：articulation 对比 + 休止呼吸 + 抢拍 =================
 * v4.1/v4.2 为治"断"把每个音都延到下一 onset—— pendulum 过头，旋律成"一个音连续"，
 * 没有 articulation 对比、没有休止、没有切分骨架。本通道把"演奏法"写回旋律：
 *   断奏(staccato)= 时值砍到 45%，音与音之间留出空气 → 律动的"点"
 *   半断(portato) = 80%，常规演奏
 *   延音(sustain)= 保持连线，只给乐句尾/旋律峰 → 长音有目的地出现
 *   休止：每乐句按 rest 概率抽掉一个非骨干音 → 乐句会"呼吸"
 *   抢拍(anticipation)：强拍音提前到前一拍& → 流行/rnb/hiphop 的招牌切分 */
const ARTIC = {
  rnb:   { sus: 0.28, port: 0.42, stacc: 0.30, rest: 0.5, antici: 0.32, accOff: 0.07 },
  jazz:  { sus: 0.30, port: 0.42, stacc: 0.28, rest: 0.55, antici: 0.38, accOff: 0.06 },
  rock:  { sus: 0.16, port: 0.34, stacc: 0.50, rest: 0.35, antici: 0.12, accOff: 0.09 },
  bossa: { sus: 0.24, port: 0.52, stacc: 0.24, rest: 0.55, antici: 0.28, accOff: 0.05 },
  afro:  { sus: 0.16, port: 0.38, stacc: 0.46, rest: 0.45, antici: 0.20, accOff: 0.08 },
  hiphop:{ sus: 0.16, port: 0.34, stacc: 0.50, rest: 0.70, antici: 0.42, accOff: 0.09 },
};
function melodyRhythmPass(events, rng, styleKey) {
  const A = ARTIC[styleKey] || ARTIC.rnb;
  const core = events.filter(e => !e.ghost).sort((a, b) => a.beat - b.beat);
  if (!core.length) return;
  const spb = SPB(), bpb = BPB();
  /* 1) articulation 分配：乐句尾/旋律峰 → 延音；其余按风格配比断/半断 */
  const GROUP_BEATS = 2 * bpb;
  for (let gi = 0; gi < core.length; gi++) {
    const e = core[gi];
    const nxt = gi + 1 < core.length ? core[gi + 1] : null;
    const gap = nxt ? nxt.beat - e.beat : 2;
    const isPhraseEnd = !nxt || Math.floor(nxt.beat / GROUP_BEATS) !== Math.floor(e.beat / GROUP_BEATS);
    /* 旋律峰：比前后音都高的音给延音（长音出现在高点才有方向感） */
    const prv = gi > 0 ? core[gi - 1] : null;
    const isPeak = (!prv || e.midi >= prv.midi) && (!nxt || e.midi >= nxt.midi) && gap >= 1.0; /* v5.3：峰判定收紧，别把普通音都送延音 */
    let kind;
    if (gap <= 0.05) kind = 'stacc'; /* v5.2b 重述/M4 撞车产生的同音齐奏 → 双音 stab，时值不能归零 */
    else if (isPhraseEnd || isPeak || e.tie) kind = 'sus';
    else {
      const r = rng();
      kind = r < A.stacc ? 'stacc' : r < A.stacc + A.port ? 'port' : 'sus';
    }
    if (kind === 'stacc') e.dur = gap <= 0.05 ? 0.18 : clamp(gap * 0.35, 0.12, 0.35); /* 真断奏：+尾音后可闻 <0.5 拍 */
    else if (kind === 'port') e.dur = clamp(gap * 0.8, 0.2, Math.max(0.4, gap - 0.06));
    else e.dur = Math.min(gap, e.dur); /* 延音保持 flow pass 的连线 */
    e.artic = kind;
  }
  /* 2) 休止呼吸：每 2 小节乐句按 rest 概率抽掉一个非骨干音，制造 ≥0.5 拍的洞 */
  let gs = Math.floor(core[0].beat / GROUP_BEATS) * GROUP_BEATS;
  let phrase = [];
  const doRest = () => {
    if (phrase.length < 3 || rng() > A.rest) { phrase = []; return; }
    const cand = phrase.filter(e => e.artic !== 'sus' && e !== phrase[0] && e !== phrase[phrase.length - 1]);
    if (cand.length) {
      const victim = cand[Math.floor(rng() * cand.length)];
      events.splice(events.indexOf(victim), 1);
    }
    phrase = [];
  };
  for (const e of core) {
    if (e.beat >= gs + GROUP_BEATS) { doRest(); gs = Math.floor(e.beat / GROUP_BEATS) * GROUP_BEATS; }
    phrase.push(e);
  }
  doRest();
  /* 3) 抢拍切分：强拍 onset 提前 0.25~0.5 拍（前一音让位收缩），rnb/hiphop 招牌 */
  const survivors = events.filter(e => !e.ghost).sort((a, b) => a.beat - b.beat);
  for (let i = 0; i < survivors.length; i++) {
    const e = survivors[i];
    const on16 = Math.round(e.beat * spb) % SBAR();
    if (on16 % 4 !== 0 || e.artic === 'sus') continue;
    if (rng() >= A.antici) continue;
    const shift = rng() < 0.6 ? 0.25 : 0.5;
    const newOn = e.beat - shift;
    if (newOn < 0) continue;
    const prv = i > 0 ? survivors[i - 1] : null;
    if (prv && prv.beat + prv.dur > newOn - 0.04) prv.dur = Math.max(0.15, newOn - prv.beat - 0.05); /* 前音让位 */
    e.beat = newOn;
    e.antic = true;
  }
  /* 4) 切分重音：落在弱拍/&的音给力度加成——律动的"提线" */
  for (const e of events) {
    if (e.ghost) continue;
    const on16 = Math.round(e.beat * spb);
    if (on16 % 4 !== 0) e.vel = Math.min(1, e.vel + A.accOff);
  }
  events.sort((a, b) => a.beat - b.beat);
}

/* ================= v4 旋律后处理（M4 切分拖拍 / M5 装饰语汇 / M6 轮廓约束 / §2.2 连线标记） ================= */
const M5_TABLE = {
  rnb:   { neighbor: 0.20, approach: 0.10, run: 0.20, double: 0    },
  jazz:  { neighbor: 0.10, approach: 0.20, run: 0.15, double: 0    },
  rock:  { neighbor: 0,    approach: 0,    run: 0.25, double: 0.15 },
  bossa: { neighbor: 0.15, approach: 0.10, run: 0.15, double: 0    },
  afro:  { neighbor: 0.10, approach: 0,    run: 0.20, double: 0.15 },
  hiphop:{ neighbor: 0,    approach: 0.15, run: 0.15, double: 0.10 },
};
function postMelodyCraft(events, rng, params) {
  if (!events.length) return;
  const styleKey = state.styles[0];
  const m5 = M5_TABLE[styleKey] || M5_TABLE.rnb;
  const scalePCs = MODES[state.mode].offsets.map(o => (state.keyRoot + o) % 12);
  const syncoP = (styleKey === 'rnb' || styleKey === 'jazz') ? 0.3 : (styleKey === 'hiphop' || styleKey === 'afro') ? 0.15 : 0;
  const added = [];
  const freeBefore = (e, i, need) => {
    const prev = events[i - 1];
    return !prev || e.beat - (prev.beat + prev.dur) >= need;
  };
  /* 调内下行第 k 级（尾 run 用） */
  const scaleDown = (midi, k) => {
    let m = midi;
    for (let j = 0; j < k; j++) {
      let best = null;
      for (const pc of scalePCs) {
        for (let mm = m - 1; mm >= m - 4; mm--) {
          if (((mm % 12) + 12) % 12 === pc) { best = mm; break; }
        }
        if (best !== null) break;
      }
      if (best === null) return null;
      m = best;
    }
    return m;
  };
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const on16 = Math.round(e.beat * SPB()) % SBAR();
    const nx = events[i + 1];
    /* M4：弱拍 onset 向后拖 1/16（不顶撞下一音、不拖幽灵音） */
    if (syncoP && on16 % 4 !== 0 && !e.ghost && rng() < syncoP) {
      if (!nx || nx.beat - e.beat > 0.35) e.beat += 0.25;
    }
    /* M5 趋近音：强拍长音前插半音趋近 */
    if (m5.approach && on16 % 4 === 0 && e.dur >= 0.75 && rng() < m5.approach && freeBefore(e, i, 0.3)) {
      const dir = rng() < 0.5 ? -1 : 1;
      added.push({ beat: e.beat - 0.25, midi: e.midi + dir, dur: 0.2, vel: e.vel * 0.65, ghost: true });
    }
    /* M5 邻音摇曳：长音前上邻音装饰 */
    if (m5.neighbor && e.dur >= 1.25 && rng() < m5.neighbor && freeBefore(e, i, 0.3)) {
      let nb = null;
      for (const pc of scalePCs) {
        const d = ((pc - (e.midi % 12)) % 12 + 12) % 12;
        if (d >= 1 && d <= 3) { nb = e.midi + d; break; }
      }
      if (nb !== null && nb <= params.regHi + 2) added.push({ beat: e.beat - 0.25, midi: nb, dur: 0.2, vel: e.vel * 0.6, ghost: true });
    }
    /* M5 尾 run：乐句尾长音前插 3 音下行十六分 */
    if (m5.run && on16 >= 12 && e.dur >= 1 && rng() < m5.run && freeBefore(e, i, 0.8)) {
      for (let k = 3; k >= 1; k--) {
        const mk = scaleDown(e.midi, k);
        if (mk !== null && mk >= params.regLo - 2) added.push({ beat: e.beat - 0.25 * k, midi: mk, dur: 0.2, vel: e.vel * (0.42 + 0.08 * k), ghost: true });
      }
    }
    /* M5 双音：强拍叠和弦音（rock/afro/hiphop 和声厚度） */
    if (m5.double && on16 % 8 === 0 && rng() < m5.double) {
      const ch = chordAtBar(Math.floor(e.beat / 4));
      for (const pc of ch.pcs) {
        const d = ((pc - (e.midi % 12)) % 12 + 12) % 12;
        if (d === 3 || d === 4 || d === 7) {
          added.push({ beat: e.beat, midi: e.midi + d, dur: Math.min(e.dur, 1), vel: e.vel * 0.7, ghost: true, dbl: true });
          break;
        }
      }
    }
  }
  events.push(...added);
  events.sort((a, b) => a.beat - b.beat);
  /* M6 轮廓约束：大跳后必须反向；同向三次强制转折（八度置换，保持调内） */
  for (let i = 1; i + 1 < events.length; i++) {
    const d1 = events[i].midi - events[i - 1].midi;
    const d2 = events[i + 1].midi - events[i].midi;
    if (d1 !== 0 && Math.abs(d1) > 5 && Math.sign(d2) === Math.sign(d1) && d2 !== 0) {
      const cand = events[i + 1].midi - Math.sign(d1) * 12;
      const ch = chordAtBar(Math.floor(events[i + 1].beat / 4));
      if (cand >= params.regLo - 2 && cand <= params.regHi + 2 && ch.scalePCs.includes(((cand % 12) + 12) % 12)) events[i + 1].midi = cand;
    }
    if (i >= 2) {
      const d0 = events[i - 1].midi - events[i - 2].midi;
      if (d0 !== 0 && d1 !== 0 && d2 !== 0 && Math.sign(d0) === Math.sign(d1) && Math.sign(d1) === Math.sign(d2)) {
        const cand = events[i].midi + (Math.sign(d1) > 0 ? -12 : 12);
        const ch = chordAtBar(Math.floor(events[i].beat / 4));
        if (cand >= params.regLo - 2 && cand <= params.regHi + 2 && ch.scalePCs.includes(((cand % 12) + 12) % 12)) events[i].midi = cand;
      }
    }
  }
  /* §2.2 连线标记：缝隙 ≤0.5 拍且级进 → tie（连奏不重新起音）；缝隙 ≥1 拍 → 换气点 */
  for (let i = 0; i + 1 < events.length; i++) {
    const e = events[i], nx2 = events[i + 1];
    const gap = nx2.beat - (e.beat + e.dur);
    if (gap <= 0.5 && gap >= -0.01 && Math.abs(nx2.midi - e.midi) <= 2 && !nx2.ghost && !nx2.dbl) e.tie = true;
    if (gap >= 1) nx2.breath = true;
  }
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
    const push = (beat, midi, dur, vel) => ev.push({ beat: bar * BPB() + beat, midi, dur, vel });

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
      /* N3 rnb 贝斯旋律化：50% 把第 3 拍五音换成趋向下一和弦根的趋近音（D'Angelo 式歌唱性） */
      if (styleKey === 'rnb' && rng() < 0.5) push(3, approach, 0.4, 0.7);
      else push(3, fifth, 0.4, 0.7);
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
  bassEvents = ev.filter(e => e.beat < bars * BPB()); /* v5 拍子系统：拍偏移溢出拦截 */
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
  const grooveEntry = state.structure === 'groove' ? 4 : 0; /* v5 endless-groove：键盘第 4 小节入场 */
  const COMP_PATTERNS = [
    [[1, 2], [3, 2]], [[2, 2], [3.5, 1.5]], [[1.5, 2], [3, 2]],
    [[2, 4], [3.5, 1]], [[0.5, 2], [2.5, 2]], [[1, 1.5], [2.5, 2], [3.5, 1]],
  ];
  const BOSSA_KEYS = [[0, 2], [1.5, 2], [2.5, 2], [3, 2], [3.75, 1]];
  /* A2 答句生成器：旋律在前半句收住（留出 ≥1 拍）→ 键盘在后半句作答（力度 ×0.55） */
  const melodyGapAnswer = (bar, hits) => {
    const mInBar = melodyEvents.filter(m => Math.floor(m.beat / 4) === bar);
    if (!mInBar.length) return hits;
    const lastOn = Math.max(...mInBar.map(m => m.beat % 4));
    if (lastOn < 2) return hits.concat([[2.5, 0.6], [3.5, 0.5]]);
    return hits;
  };
  for (let bar = 0; bar < bars; bar++) {
    if (bar < grooveEntry) continue;
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
          ev.push({ beat: bar * BPB() + i * 0.5, notes: power, dur: 0.28, vel: i % 2 === 0 ? 0.62 : 0.48, inst: 'guitar:muted' });
        }
      } else if (styleKey === 'bossa') {
        for (const [b, d] of BOSSA_KEYS) ev.push({ beat: bar * BPB() + b, notes: voicing, dur: Math.min(d, BPB() - b), vel: 0.5 + rng() * 0.1, inst: 'guitar:nylon' });
      } else if (styleKey === 'afro') {
        /* A4 一疏一密（Fela 双吉他互锁）：偶数小节全 chop，奇数小节只留抢拍 stub */
        const stabs = bar % 2 === 0 ? [[2, 1.5], [6, 1.5], [10, 1.5], [13, 1], [14, 2]] : [[13, 1], [14, 2]];
        for (const [b, d] of stabs) ev.push({ beat: bar * BPB() + b / SPB(), notes: voicing, dur: d / SPB(), vel: 0.42 + rng() * 0.14, inst: 'guitar:clean' });
      } else if (styleKey === 'hiphop') {
        /* S6：暗黑 stab 顿奏，把空间留给 808 */
        for (const s of [0, 7, 8, 15]) ev.push({ beat: bar * BPB() + s / SPB(), notes: voicing, dur: 0.3, vel: 0.42 + rng() * 0.1, inst: 'keys' });
      } else {
        /* rnb/jazz comping + 答句填空 */
        let hits = pick(rng, COMP_PATTERNS).slice();
        if (styleKey === 'rnb' || styleKey === 'jazz') hits = melodyGapAnswer(bar, hits);
        for (const [b, d] of hits) {
          const vel = 0.46 + rng() * 0.13;
          /* v5.2 comping 断奏化：最长 1 拍，Rhodes 变 stab 才会"弹"而不是"糊一片" */
          ev.push({ beat: bar * BPB() + b, notes: voicing, dur: Math.min(d, 1, BPB() - b), vel, inst: 'keys' });
          /* N2 双层键盘：Rhodes 高八度轻叠层（rnb 45%） */
          if (styleKey === 'rnb' && rng() < 0.45) {
            ev.push({ beat: bar * BPB() + b, notes: voicing.map(n => Math.min(n + 12, 96)), dur: Math.min(d, 1, BPB() - b) * 0.5, vel: vel * 0.45, inst: 'keys', layer: 2 });
          }
        }
      }
    } else if (patch === 'afro') {
      /* Fela 式交错 chop：反拍十六分 + 第4拍&的抢拍 */
      const stabs = [[2, 1.5], [6, 1.5], [10, 1.5], [13, 1], [14, 2]];
      for (const [b, d] of stabs) ev.push({ beat: bar * BPB() + b / SPB(), notes: voicing, dur: d / SPB(), vel: 0.42 + rng() * 0.14, inst: 'keys' });
    } else if (patch === 'bossa' || (patch === 'comp' && styleKey === 'bossa' && rng() < 0.5)) {
      for (const [b, d] of BOSSA_KEYS) ev.push({ beat: bar * BPB() + b, notes: voicing, dur: Math.min(d, BPB() - b), vel: 0.55 + rng() * 0.1, inst: 'keys' });
    } else if (patch === 'pad') {
      ev.push({ beat: bar * BPB(), notes: voicing, dur: Math.max(1, BPB() - 0.2), vel: 0.42, inst: 'keys' });
    } else {
      for (const [b, d] of pick(rng, COMP_PATTERNS)) ev.push({ beat: bar * BPB() + b, notes: voicing, dur: Math.min(d, BPB() - b), vel: 0.5 + rng() * 0.15, inst: 'keys' });
    }
  }
  keysEvents = ev.filter(e => e.beat < bars * BPB()); /* v5 拍子系统：拍偏移溢出拦截 */
}

/* ============ v4 合成器氛围引擎（S1-S6）：存在度按风格，换挡换色，三模式 ============
 * 合成器在每种风格都存在，但角色不同：
 *   rnb   choir  胶感和声垫（verse 稀 → chorus 密）
 *   jazz  strings 气息式 2+2 短铺（给 walking bass 让位）
 *   rock  sweep  副歌门控低音铺（主歌退场，失真吉他是主角）
 *   bossa strings 空气感点缀（Jobim 式小编制）
 *   afro  warm   warm organ 反拍 stab（与吉他 chop 互锁）
 *   hiphop polysynth 暗黑长铺主角（trap 氛围核心）
 */
const PAD_BY_STYLE = {
  rnb:   { bank: 'choir',     presence: 0.42, attack: 'slow', lpf: 5200, mode: 'pad',  vol: 0.90 }, /* v4.3 密度 0.50→0.42 */
  jazz:  { bank: 'strings',   presence: 0.12, attack: 'slow', lpf: 6200, mode: 'air',  vol: 0.60 },
  rock:  { bank: 'sweep',     presence: 0.18, attack: 'gate', lpf: 3800, mode: 'gate', vol: 0.70 },
  bossa: { bank: 'strings',   presence: 0.10, attack: 'slow', lpf: 6200, mode: 'air',  vol: 0.55 },
  afro:  { bank: 'warm',      presence: 0.35, attack: 'stab', lpf: 4200, mode: 'stab', vol: 0.85 },
  hiphop:{ bank: 'polysynth', presence: 0.65, attack: 'slow', lpf: 3400, mode: 'pad',  vol: 1.00 },
};
function genSynthPad() {
  const rng = mulberry32(curSeed ^ 0x5EED);
  const bars = totalBars();
  const ev = [];
  let prevVoicing = null;
  for (let bar = 0; bar < bars; bar++) {
    if (state.structure === 'groove' && bar < 12) continue; /* v5 endless-groove：pad 最后入场 */
    const chord = chordAtBar(bar);
    const styleKey = state.styles.length > 1 ? state.styles[bar % state.styles.length] : state.styles[0];
    const cfg = PAD_BY_STYLE[styleKey] || PAD_BY_STYLE.rnb;
    let voicing = chooseVoicing(styleVoicingPcs(chord.pcs, styleKey), prevVoicing);
    prevVoicing = voicing;
    /* N1 RnB pad 跨八度 spread：3 音拉开（沙滩多层弦乐式厚度） */
    if (styleKey === 'rnb' && voicing.length >= 3) {
      voicing = [voicing[0], voicing[1], Math.min(voicing[voicing.length - 1] + 12, 96)];
    }
    const energy = sectionAt(bar).energy;
    /* S1 存在度：verse→chorus 递增；段首小节必出现（和声锚点） */
    let pEff = cfg.presence * (0.55 + energy * 0.9);
    if (cfg.mode === 'gate') pEff *= energy > 0.7 ? 1 : 0.25;
    const secStart = state.structure === 'song' && (bar === 0 || sectionAt(bar).name !== sectionAt(bar - 1).name);
    if (!secStart && rng() > pEff) continue;
    const vel0 = cfg.vol;
    if (cfg.mode === 'stab') {
      /* S3 Afro：warm organ 式反拍 stab，与吉他 chop 错开 */
      for (const s of [2, 6, 10, 13, 14]) {
        ev.push({ beat: bar * BPB() + s / SPB(), notes: voicing.slice(0, 3), dur: 0.22, vel: (0.30 + rng() * 0.08) * vel0 });
      }
    } else if (cfg.mode === 'air') {
      /* S3 Jazz/Bossa：2+2 呼吸短铺，留出 walking bass 的空间 */
      ev.push({ beat: bar * BPB(), notes: voicing, dur: 1.85, vel: (0.26 + rng() * 0.05) * vel0 });
      if (rng() < 0.6) ev.push({ beat: bar * BPB() + 2, notes: voicing, dur: 1.7, vel: (0.22 + rng() * 0.05) * vel0 });
    } else if (cfg.mode === 'gate') {
      /* S3 Rock：隔小节低音铺底，只在高能量段进场 */
      if (bar % 2 === 0) ev.push({ beat: bar * BPB(), notes: voicing.slice(0, 2), dur: 7.6, vel: (0.30 + rng() * 0.05) * vel0 });
    } else {
      /* 长音 pad：进入点变化，段首必在正拍 */
      const entry = secStart ? 0 : (rng() < 0.58 ? 0 : rng() < 0.5 ? 1 : 2);
      ev.push({ beat: bar * BPB() + entry, notes: voicing, dur: Math.max(1.2, BPB() - 0.1 - entry), vel: (0.28 + rng() * 0.07) * vel0 });
      if (rng() < 0.12) ev.push({ beat: bar * BPB() + 2, notes: voicing.map(n => Math.min(n + 12, 96)), dur: 0.5, vel: 0.13 * vel0 }); /* v4.3 高音色彩层降密 */
    }
    /* 抢拍预示：rnb 25% / 其余 12% 在前一小节末 16 分提前涌入（swell） */
    if (bar > 0 && rng() < (styleKey === 'rnb' ? 0.15 : 0.08)) ev.push({ beat: bar * BPB() - 0.25, notes: voicing, dur: 0.4, vel: 0.11 }); /* v4.3 swell 减半 */
    /* rnb 高音色彩声部：30% 在第 3 拍后半拍点最高音 → pad 有自己的"旋律线" */
    if (styleKey === 'rnb' && rng() < 0.3) {
      const top = voicing[voicing.length - 1];
      ev.push({ beat: bar * BPB() + 2.5, notes: [Math.min(top + 12, 96)], dur: 0.6, vel: 0.13 + rng() * 0.05 });
    }
  }
  synthEvents = ev.filter(e => e.beat >= 0 && e.beat < bars * BPB()); /* v5 拍子系统：swell 负拍/溢出拦截 */
}

/* ================= v5 horn 层（afro 签名声部：反拍铜管 stab） ================= */
function genHorns() {
  hornEvents = [];
  if (state.styles[0] !== 'afro' || state.structure === 'loop' || state.meter !== 'm44') return;
  const rng = mulberry32(curSeed ^ 0xB0AD);
  const bars = totalBars();
  for (let bar = 0; bar < bars; bar++) {
    if (sectionAt(bar).energy < 0.7 || bar % 2 === 1) continue; /* 副歌进场，隔小节 */
    const chord = chordAtBar(bar);
    const root = 58 + ((chord.rootPC + 12 - 4) % 12); /* B3 区，与吉他音域错开 */
    const third = root + (CHORDS[chord.qKey].iv[1] || 4);
    const stab = (beat, notes, vel) => hornEvents.push({ beat: bar * BPB() + beat, notes, dur: 0.22, vel });
    stab(1.5, [root, third], 0.5);
    stab(3.5, [root, third, Math.min(root + 12, 96)], 0.45);
    if (rng() < 0.3) stab(2.5, [root + 12, third + 12], 0.35);
  }
}

/* ============ v4 鼓组声部系统（B1-B6）：实测鼓型 + 重音 + 互锁 + 配比 + 段落鼓型 ============ */
const DRUM_PRESENCE = { /* v4.2 再提一档 +1dB */
  afro:   { kick: +1,   snare: +3, perc: +4 }, /* Fela 打击乐群前置 */
  hiphop: { kick: +4.5, snare: +2, perc: +2 },
  rnb:    { kick: +3.5, snare: +2, perc: +2 },
  rock:   { kick: +3,   snare: +3, perc: +1 },
  jazz:   { kick: 0,    snare: +2, perc: +2 },
  bossa:  { kick: +2,   snare: +2, perc: +3 },
};
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
    /* B5 减法过渡：verse 最后一小节抽掉非正拍 kick（把能量推进副歌） */
    const secChange = state.structure === 'song' && bar + 1 < bars && sectionAt(bar + 1).name !== sectionAt(bar).name;
    const subtract = state.structure === 'song' && (secChange || sectionAt(bar + 1).energy - energy > 0.3); /* v5：段落切换前减壳 = vamp 过渡呼吸 */
    const isThinSec = energy < 0.4; /* 前奏/尾奏剥壳：只留律动轴 */
    let P = DRUM_PATTERNS[patName] || DRUM_PATTERNS.rnb;
    const rockChorus = patName === 'rock' && energy > 0.7;
    if (rockChorus) P = DRUM_PATTERNS.rockChorus;
    /* v5 拍子系统：3/4 华尔兹 / 6·8 摇曳专用鼓型（12 步矩阵） */
    const meterPats = { m34: 'waltz', m68: 'soul68' };
    if (meterPats[state.meter] && DRUM_PATTERNS[meterPats[state.meter]]) P = DRUM_PATTERNS[meterPats[state.meter]];
    const density = state.layers.drums.patch;
    const kit = DRUM_KITS[state.layers.drums.patch === '808' ? 's808' : state.layers.drums.patch === 'beach' ? 'beach' : styleKey] || DRUM_KITS.rnb;
    /* B4 声部配比（dB→倍数） */
    const pres = DRUM_PRESENCE[styleKey] || {};
    const presMul = (inst) => {
      const db = inst === 'kick' ? pres.kick
        : (inst === 'snare' || inst === 'clap') ? (pres.snare || 0)
        : (inst === 'hat' || inst === 'ohat') ? 0 : (pres.perc || 0);
      return db ? Math.pow(10, db / 20) : 1;
    };
    const kickRow = (patName === 'afro' && bar % 2 === 1 && P.kickB) ? P.kickB : P.kick; /* afro 第二小节变体 */
    for (let s = 0; s < SBAR(); s++) {
      const arc = [0.92, 0.97, 1.0, 1.06]; /* 四小节呼吸弧：第 4 小节冲刺进下一段 */
      const push = (inst, vel) => {
        const essential = inst === 'kick' || inst === 'snare';
        if (!essential && rng() > energy + 0.35) return; /* 低能量段裁掉装饰音 */
        ev.push({ step16: bar * SBAR() + s, inst, vel: vel * (0.65 + energy * 0.45) * arc[bar % 4] * presMul(inst), kit });
      };
      /* A3 剥壳：前奏/尾奏只留 hat 轴 + 第 1 拍 kick */
      if (isThinSec && !(P.hat && P.hat[s]) && s % 4 !== 0 && !(s === 0 && P.kick && P.kick[s])) continue;
      if (P.kick && kickRow[s]) {
        if (subtract && s % 4 !== 0) { /* B5 减法：正拍 kick 保留，其余抽掉 */ }
        else {
          push('kick', (patName === 'jazz' ? 0.3 : (patName === 'bossa' ? 0.55 : (patName === 'afro' ? 0.7 : 1))) * (s % 4 === 0 ? 1.0 : 0.85));
          /* B2 强 kick 叠 808 次低音层（rnb/hiphop） */
          if ((styleKey === 'rnb' || styleKey === 'hiphop') && s % 8 === 0) ev[ev.length - 1].sub = true;
        }
      }
      if (patName === 'jazz') {
        /* 爵士军鼓 = 反拍应答 comping，不是摇滚式 backbeat */
        if (P.snare && P.snare[s] && !isThinSec && rng() < 0.35) push('snare', 0.5);
        if ((s === 3 || s === 7 || s === 11 || s === 14) && !isThinSec && rng() < 0.22) push('snare', 0.32);
      } else if (P.snare && P.snare[s]) {
        if (!isThinSec) {
          if (patName === 'bossa') {
            /* 实测 Ipanema：rim 只在 B 段/高能量段出现 */
            if (energy > 0.65 || bar % 2 === 1) push('snare', 0.45);
          } else {
            push('snare', patName === 'afro' ? 0.55 : 0.9);
            /* B2 rnb 军鼓叠 rimshot（Questlove flam 感） */
            if (styleKey === 'rnb' && s % 8 === 4) ev[ev.length - 1].rimLayer = true;
          }
        }
      }
      if (P.ghost && P.ghost[s] && !isThinSec && rng() < 0.5) push('snare', 0.38);
      if (P.hat && P.hat[s]) {
        if (density === 'lite' && s % 4 !== 0) continue;
        if (density === 'drive' && rng() < 0.3) { push('hat', 0.5); continue; }
        let hatBase = patName === 'beach' ? (s % 4 === 0 ? 0.62 : 0.4 + rng() * 0.18) : (s % 4 === 0 ? 0.85 : 0.6); /* 律动载体站出来 */
        /* B2 重音系统：rnb/jazz 四分 hat 突出、反拍收轻（摇摆对比） */
        if (styleKey === 'rnb' || styleKey === 'jazz') {
          if (s % 4 === 0) hatBase *= 1.35;
          else if (s % 4 === 2) hatBase *= 0.6;
        }
        push('hat', hatBase);
      }
      if (P.ohat && P.ohat[s] && density !== 'lite') push('ohat', 0.6);
      /* N5 rock verse 开镲：15% 概率在反拍点开镲（GNR 式动态） */
      if (patName === 'rock' && !rockChorus && s % 4 === 2 && rng() < 0.15) push('ohat', 0.5);
      if (P.ride && P.ride[s]) push('ride', s % 4 === 0 ? 0.8 : 0.5);
      if (P.crash && P.crash[s] && (bar % 4 === 0 || rockChorus)) push('crash', styleKey === 'rock' ? 0.5 : 0.7);
      if (P.congaH && P.congaH[s]) push('congaH', 0.7);
      if (P.congaL && P.congaL[s]) push('congaL', 0.65);
      if (P.bell && P.bell[s]) push('bell', s % 4 === 0 ? 0.55 : 0.4);
      /* rnb 现代变体（Frank Ocean 式）：第二小节军鼓上 3 */
      if (patName === 'rnb' && bar % 2 === 1 && s === 8 && !isThinSec) push('snare', 0.55);
      /* Fela 式 break：每 16 小节最后一拍全停 */
      if (styleKey === 'afro' && bar % 16 === 15 && s >= 12) {
        ev.filter(x => x.step16 === bar * SBAR() + s).forEach(x => { x._drop = true; });
      }
    }
    /* Rock：每 4 小节末加花进下一段（Nirvana/GNR 式） */
    if (styleKey === 'rock' && bar % 4 === 3 && bar !== bars - 1 && energy > 0.45) {
      for (let s = SBAR() - 4; s < SBAR(); s++) ev.push({ step16: bar * SBAR() + s, inst: 'snare', vel: (0.45 + (s - (SBAR() - 4)) * 0.15) * presMul('snare'), kit });
    }
    /* 结尾加花（Afro break 小节不加） */
    if (bar === bars - 1 && !(styleKey === 'afro' && bar % 16 === 15)) {
      for (let s = SBAR() - 4; s < SBAR(); s++) ev.push({ step16: bar * SBAR() + s, inst: s % 2 ? 'snare' : 'hat', vel: (0.5 + (s - (SBAR() - 4)) * 0.12) * presMul('snare'), kit });
    }
    /* v5 fill 库：段落末或每 8 小节，末 3 步军鼓渐强滚奏 + 下小节 crash 收束（afro/bossa 免） */
    if (state.meter === 'm44' && styleKey !== 'afro' && styleKey !== 'bossa' && styleKey !== 'rock' && (secChange || bar % 8 === 7) && bar + 1 < bars) {
      for (let s = SBAR() - 3; s < SBAR(); s++) ev.push({ step16: bar * SBAR() + s, inst: 'snare', vel: (0.4 + (s - (SBAR() - 3)) * 0.2) * presMul('snare'), kit });
      ev.push({ step16: (bar + 1) * SBAR(), inst: 'crash', vel: 0.6 * presMul('crash'), kit });
    }
    /* Hip-Hop：32 分 hat 滚奏（每 2 小节随机一整拍）+ 偶发 16 分三连音顿奏 */
    if (styleKey === 'hiphop') {
      if (bar % 2 === 1) {
        const rollBeat = 4 * Math.floor(rng() * 4);
        for (let k = 0; k < 8; k++) ev.push({ step16: bar * SBAR() + rollBeat + k * 0.5, inst: 'hat', vel: (0.45 + k * 0.045) * presMul('hat'), kit });
      }
      if (bar % 8 === 7 && rng() < 0.6) {
        for (let k = 0; k < 6; k++) ev.push({ step16: bar * SBAR() + 8 + k * (2 / 3), inst: 'hat', vel: (0.4 + k * 0.05) * presMul('hat'), kit });
      }
    }
    /* 风格打击乐层：Afro 全十六分 shekere（hat 轴）+ 反拍 clap（力量鼓点 ×1.3） */
    if (styleKey === 'afro') {
      for (let s = 0; s < SBAR(); s++) {
        if (state.perf && s % 2 === 1) continue; /* 性能模式：shekere 减半 */
        if (bar % 16 === 15 && s >= 12) continue; /* Fela break：shekere 同停 */
        ev.push({ step16: bar * SBAR() + s, inst: 'shekere', vel: (s % 4 === 0 ? 0.7 : 0.45) * presMul('shekere'), kit });
      }
      if (bar % 16 !== 15) {
        ev.push({ step16: bar * SBAR() + 4,  inst: 'clap', vel: 0.8 * 1.3 * presMul('clap'), kit });
        ev.push({ step16: bar * SBAR() + 12, inst: 'clap', vel: 0.85 * 1.3 * presMul('clap'), kit });
      }
    } else if (styleKey === 'rnb') {
      for (let s = 0; s < 16; s += 2) ev.push({ step16: bar * SBAR() + s, inst: 'shaker', vel: (s % 4 === 0 ? 0.5 : 0.38) * presMul('shaker'), kit });
    }
    /* 实测 Ipanema：bossa 的 shaker 型已并入 P.hat（X.X...X.X.X...X.），不再叠层 */
  }
  drumEvents = ev.filter(x => !x._drop && x.step16 < totalBars() * SBAR()); /* v5：非4/4 roll/ clap 越界拦截 */
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
  /* v4 Logic 级母带链：音量(AGC) → 三段EQ → 多段压缩 → 温和饱和 → 限制器 → 输出。
     各层推子仍汇入 AE.master；导出音频从限制器后分流（与听到的一致） */
  AE.master = new Tone.Volume(-2);
  AE.masterEq = new Tone.EQ3({ low: 0, mid: 0, high: 0.5, lowFrequency: 120, highFrequency: 7500 });
  AE.masterMB = new Tone.MultibandCompressor({
    lowFrequency: 250, highFrequency: 2600,
    low:  { threshold: -20, ratio: 3,   attack: 0.02,  release: 0.15 },
    mid:  { threshold: -16, ratio: 2.5, attack: 0.015, release: 0.12 },
    high: { threshold: -13, ratio: 3,   attack: 0.01,  release: 0.1  },
  });
  AE.masterSat = new Tone.Distortion(0.06);
  AE.limiterRef = new Tone.Limiter(-1);
  AE.master.connect(AE.masterEq);
  AE.masterEq.connect(AE.masterMB);
  AE.masterMB.connect(AE.masterSat);
  AE.masterSat.connect(AE.limiterRef);
  AE.limiterRef.toDestination();
  AE.masterMeter = new Tone.Meter({ normalRange: false, smoothing: 0.85 });
  AE.recDest = Tone.getContext().createMediaStreamDestination();
  AE.limiterRef.connect(AE.recDest);
  /* 限制器后 → 电平监听（并联，不影响信号链） */
  setTimeout(() => { try { AE.limiterRef.connect(AE.masterMeter); } catch (e) {} }, 0);
  /* v4 AGC：3.5s 一拍、±0.4dB 步进、±3dB 死区、目标 -12dB RMS（不泵动、不抢瞬态） */
  setInterval(() => {
    if (!state.playing || !AE.masterMeter) return;
    let db = -60;
    try { const v = AE.masterMeter.getValue(); db = typeof v === 'number' ? v : -60; } catch (e) { return; }
    if (db < -45 || db > -3) return;
    const err = -12 - db;
    if (Math.abs(err) < 3) return;
    const cur = AE.master.volume.value;
    const next = Math.max(-14, Math.min(8, cur + Math.sign(err) * 0.4));
    AE.master.volume.value = next;
  }, 3500);

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
  AE.drumsVol = new Tone.Volume(-5); /* 路由在音色链创建后建立；v4.1 前置一档 */
  AE.drumsComp = new Tone.Compressor(-16, 3.5); /* v2：全鼓挤进同一动态包络，一起呼吸 */
  /* v4.1 NY 并行压缩：重压缩副本 0.4 混入——kick/snare 永远顶穿混音 */
  AE.drumsPar = new Tone.Compressor(-32, 10); /* v4.2 更重：底鼓军鼓压平混音 */
  AE.drumsParGain = new Tone.Gain(0.55);
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
  AE.padPhaser = new Tone.Phaser(0.08, 0.5, 320); /* v4.3 合成器老问题根因：octaves=4 全频扫描 → 几乎静止的模拟暖度 */
  AE.synthPad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.6, decay: 1.5, sustain: 0.5, release: 2.5 },
  }).connect(AE.padPhaser);

  /* --- 引擎 v2：全链仅 1 个混响 + 廉价双二阶滤波；卷积从 4 降到 1 --- */
  AE.masterVerb = new Tone.Reverb({ decay: 2.2, wet: 0.3 }).connect(AE.master);
  /* v5.4 粘合总线：和声层共用一个温和总线压缩——吉他/键盘/pad 被"压进"同一空间，
     不再各自直连主总线当"叠加的独奏"（吉他游离在歌外的根因之一） */
  AE.musicBus = new Tone.Compressor(-18, 2, 0.03, 0.25); /* v5.5 Suno 式 glue */
  AE.musicBus.connect(AE.masterEQ = new Tone.EQ3({ low: -2.5, mid: -1, high: 2, lowFrequency: 250, highFrequency: 4000 })); /* 频段手术：压糊提空气感 */
  AE.masterEQ.connect(AE.master);
  /* 吉他/键盘：失真→高通(v5.5 低频单声道化)→EQ→粘合总线 */
  AE.toneEqGuitar = new Tone.EQ3({ low: 0, mid: 0, high: 3 }).connect(AE.musicBus);
  AE.hpGuitar = new Tone.Filter(70, 'highpass').connect(AE.toneEqGuitar); /* 70Hz 以下让给贝斯 */
  AE.toneDistGuitar = new Tone.Distortion(0).connect(AE.hpGuitar);
  AE.toneEqKeys = new Tone.EQ3({ low: 0, mid: 0, high: 2 }).connect(AE.musicBus);
  AE.hpKeys = new Tone.Filter(100, 'highpass').connect(AE.toneEqKeys); /* Rhodes 低频浑浊重灾区 */
  AE.toneDistKeys = new Tone.Distortion(0).connect(AE.hpKeys);
  AE.toneFilterBass = new Tone.Filter(9000, 'lowpass').connect(AE.master);
  /* Pad：移相→风格低通→EQ→粘合总线（v4 S5：合成器音色链随风格开合） */
  AE.toneEqPad = new Tone.EQ3({ low: 0, mid: 0, high: 0 }).connect(AE.musicBus);
  AE.padFilter = new Tone.Filter(8000, 'lowpass');
  AE.hpPad = new Tone.Filter(80, 'highpass'); /* v5.5 pad 低频不抢贝斯 */
  AE.padPhaser.connect(AE.hpPad);
  AE.hpPad.connect(AE.padFilter);
  AE.padFilter.connect(AE.toneEqPad);
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
  AE.drumsVol.connect(AE.drumsPar);
  AE.drumsPar.connect(AE.drumsParGain);
  AE.drumsParGain.connect(AE.drumsComp);
  AE.drumsComp.connect(AE.toneDistDrums);
  /* 鼓房间声：0.45s 短混响 send（kick/snare 的"房间麦"，鼓机→真鼓） */
  AE.drumRoom = new Tone.Reverb({ decay: 0.35, wet: 1 }).connect(AE.master); /* v4.3 短房间=力量而非大厅 */
  AE.drumRoomSend = new Tone.Gain(0.26).connect(AE.drumRoom); /* 房间胶：鼓件共享空间 */
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
/* v4 吉他双源（§2.1）：rnb/jazz/bossa = SoundFont 连音乐句（滑音/长音可控）；
   rock/hiphop/afro = 真实单音采样（颗粒/riff 质感优先），SoundFont 兜底 */
const GUITAR_SRC_BY_STYLE = { rnb: 'samp', jazz: 'sf', bossa: 'sf', rock: 'samp', hiphop: 'samp', afro: 'samp' }; /* v4.2 rnb 走采样：滑音/揉弦/前音闪避才谈得上流动性 */
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
/* v4.1 分风格吉他音色：在 patch 基础上按风格叠音色层——
   rnb 圆润单线圈 / jazz 空心暖 / rock 中频哼声 crunch / bossa 尼龙指弹
   afro highlife 清亮 / hiphop 闷暗 sparse hook */
const GUITAR_STYLE_FX = {
  rnb:    { drive: 1.5, lpf: 11000, gate: 1.00, vol: 0.95 }, /* v4.3 提空气感 */
  jazz:   { drive: 1.5, lpf: 7200,  gate: 1.00, vol: 0.95 }, /* v5.1 空心琴体：少推子失真、收敛高频 */
  rock:   { drive: 12,  lpf: 6800,  gate: 1.00, vol: 1.05 },
  bossa:  { drive: 0,   lpf: 12500, gate: 1.00, vol: 0.90 },
  afro:   { drive: 2,   lpf: 8800,  gate: 1.00, vol: 0.95 },
  hiphop: { drive: 1.5, lpf: 4200,  gate: 0.85, vol: 0.90 }, /* v5.1 采样 chop 美学：更闷更狠，微失真给砂砾 */
};
const GUITAR_FX_CHAINS = {}; /* patch|style -> chain head */
function guitarFxChain(patch, raw, styleKey) {
  const fx = Object.assign({}, GUITAR_PATCH_FX[patch] || GUITAR_PATCH_FX.clean, GUITAR_STYLE_FX[styleKey] || {});
  if (fx.drive === 0 && fx.lpf >= 20000 && fx.gate === 1 && fx.vol === 1) return SAMP.busByRole.guitar;
  const ck = patch + '|' + (styleKey || '');
  let head = GUITAR_FX_CHAINS[ck];
  if (!head) {
    const lpf = raw.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = fx.lpf; lpf.Q.value = 0.7;
    const vol = raw.createGain(); vol.gain.value = fx.vol;
    let tail = lpf;
    if (fx.drive > 0) {
      const shaper = raw.createWaveShaper();
      shaper.curve = driveCurve(fx.drive);
      shaper.oversample = '2x';
      shaper.connect(lpf); tail = shaper;
    }
    lpf.connect(vol); vol.connect(SAMP.busByRole.guitar);
    head = tail;
    GUITAR_FX_CHAINS[ck] = head;
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
/* ================= v5.7 声部互锁：治"各播各的" =================
   真实乐队的锁定关系：贝斯 onset 贴底鼓（pocket）、军鼓位留空、键盘避让旋律 onset（应答）。
   各生成器彼此独立、节奏互不参照 = "各播各的"的根因；此 pass 在调度前统一对齐。 */
function interlockPass() {
  const spb = SPB();
  const WIN = 0.06; /* ±60ms 内视为"撞车/该吸合" */
  const kickBeats = drumEvents.filter(d => d.inst === 'kick' || d.inst === 'kick_808').map(d => d.step16 / spb);
  const snareBeats = drumEvents.filter(d => /snare|clap/.test(d.inst)).map(d => d.step16 / spb);
  const maxBeat = totalBars() * BPB();
  /* 1) 贝斯锁底鼓：±60ms 内吸合到 kick 网格（pocket 感） */
  for (const e of bassEvents) {
    for (const k of kickBeats) {
      const d = e.beat - k;
      if (Math.abs(d) > 0.001 && Math.abs(d) <= WIN) { e.beat = k; e.vel = Math.min(1, e.vel * 1.05); break; }
    }
  }
  /* 2) 军鼓位留空：贝斯 onset 撞军鼓 ±40ms → 后移 1/16（军鼓是锚点，贝斯让） */
  for (const e of bassEvents) {
    if (snareBeats.some(s => Math.abs(e.beat - s) <= 0.04)) e.beat += 0.25;
  }
  /* 3) 键盘避让旋律：comping 撞旋律 onset → 后移 1/16 成应答（撞=糊；让=call-response） */
  for (const e of keysEvents) {
    if (melodyEvents.some(m => Math.abs(m.beat - e.beat) <= WIN)) e.beat += 0.25;
  }
  /* 4) 吸合去重 + 边界回收 */
  const bseen = {};
  bassEvents = bassEvents.filter(e => {
    if (e.beat >= maxBeat) return false;
    const k = e.beat.toFixed(3) + '_' + e.midi;
    if (bseen[k]) return false; bseen[k] = 1; return true;
  });
  const kseen = {};
  keysEvents = keysEvents.filter(e => {
    if (e.beat >= maxBeat) return false;
    const k = e.beat.toFixed(3);
    if (kseen[k]) return false; kseen[k] = 1; return true;
  });
}

/* v5.6：共享拨片噪声缓冲（60ms 指数衰减白噪，经 bandpass 塑成拨片刷弦瞬态） */
function guitarPickNoise(raw) {
  if (GUITAR_SAMP._pickNoise) return GUITAR_SAMP._pickNoise;
  const n = Math.floor(raw.sampleRate * 0.06);
  const b = raw.createBuffer(1, n, raw.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-(i / n) * 9);
  GUITAR_SAMP._pickNoise = b;
  return b;
}

function playGuitarReal(patch, midi, t, dur, vel, slideFrom, legato, styleKey, artic) {
  const set = GUITAR_PATCH_MAP[patch] || 'electric';
  const bank = GUITAR_SAMP.buffers[set] || {};
  const keys = Object.keys(bank).map(Number);
  if (!keys.length) return false;
  let best = keys[0], bd = 99;
  for (const k of keys) { const d = Math.abs(k - midi); if (d < bd) { bd = d; best = k; } }
  if (bd > 5) return false; /* v5.1：>5 半音 playbackRate 共振峰漂移=塑料味，交还 SoundFont */
  /* v5.6 轮播微差：同音高 0.6s 内连击时换邻近采样位（真人两连音不可能完全同音色） */
  if (keys.length > 1 && midi === GUITAR_SAMP._rrMidi && t - GUITAR_SAMP._rrT < 0.6) {
    const alts = keys.filter(k => k !== best && Math.abs(k - midi) <= Math.min(5, Math.max(bd + 2, 2)));
    if (alts.length) best = alts.reduce((a, b) => Math.abs(a - midi) <= Math.abs(b - midi) ? a : b);
  }
  GUITAR_SAMP._rrMidi = midi; GUITAR_SAMP._rrT = t;
  const fx = Object.assign({}, GUITAR_PATCH_FX[patch] || GUITAR_PATCH_FX.clean, GUITAR_STYLE_FX[styleKey] || {});
  const out = guitarFxChain(patch, Tone.getContext().rawContext, styleKey);
  if (fx.gate < 1) dur = Math.max(0.07, Math.min(dur, 0.08 + dur * fx.gate));
  else dur = Math.min(dur, 2.5); /* v4：自然衰减上限，采样像真琴一样"散掉"而非锯住 */
  const raw = Tone.getContext().rawContext;
  const src = raw.createBufferSource();
  src.buffer = bank[best];
  src.playbackRate.value = Math.pow(2, (midi - best) / 12) * (1 + (Math.random() * 0.016 - 0.008)); /* v5.6 ±0.8%：真人手指压力差 */
  if (slideFrom && slideFrom !== midi && Math.abs(midi - slideFrom) <= 7) {
    /* 滑音：从前一音高滑到目标（≤7 半音才滑，大跳保持干净分离） */
    src.playbackRate.setValueAtTime(Math.pow(2, (slideFrom - best) / 12), t);
    src.playbackRate.exponentialRampToValueAtTime(Math.pow(2, (midi - best) / 12), t + 0.07);
  } else if (dur >= 0.5) {
    /* 长音揉弦：~5Hz 微幅颤音，0.25s 后进入（真人习惯），收尾渐停 */
    const cents = midi >= 70 ? 9 : 6;
    const depth = src.playbackRate.value * (Math.pow(2, cents / 1200) - 1);
    const vib = raw.createOscillator();
    const vg = raw.createGain();
    vib.frequency.value = 5.1 + Math.random() * 0.7;
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(depth, t + 0.25);
    vg.gain.setValueAtTime(depth, t + Math.max(0.3, dur - 0.1));
    vg.gain.linearRampToValueAtTime(0, t + dur + 0.1);
    vib.connect(vg); vg.connect(src.playbackRate);
    vib.start(t); vib.stop(t + dur + 0.15);
  }
  const g = raw.createGain();
  /* v5.1：attack 随机化（6~20ms/24~38ms）+ jazz 拇指柔音 ×1.6 + 轻音软起 ×1.3——消灭"每音一个模子"的机器感 */
  const atk = (legato ? 0.024 + Math.random() * 0.014 : 0.008 + Math.random() * 0.012)
    * (styleKey === 'jazz' ? 1.6 : 1) * (vel < 0.5 ? 1.3 : 1);
  /* v5.3 可闻时值：尾音按演奏法缩放。0.45 拍断奏 + 固定 0.4s 尾 = 实际 1 拍长（旧版断奏听不见的根因） */
  const tail = artic === 'stacc' ? 0.04 + Math.random() * 0.05
    : artic === 'port' ? 0.12 + Math.random() * 0.1
    : 0.25 + Math.random() * 0.25;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(vel, 0.05), t + atk);
  g.gain.setValueAtTime(Math.max(vel, 0.05), t + Math.max(0.05, dur - 0.1));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + tail);
  /* v5.6 力度联动音色：轻拨暗、重拨亮——固定音色是"塑料感"的频谱根源 */
  const tp = raw.createBiquadFilter(); tp.type = 'lowpass'; tp.frequency.value = 1800 + Math.min(1, vel) * 6200; tp.Q.value = 0.5;
  src.connect(tp); tp.connect(g); g.connect(out);
  /* v5.6 拨弦瞬态：吉他的身份在前 15ms 拨片噪声里；attack 包络把它磨没了，单独补一发 */
  const pk = raw.createBiquadFilter(); pk.type = 'bandpass'; pk.frequency.value = 2200 + Math.random() * 1200; pk.Q.value = 1.0; /* v5.7 收敛：拨片太亮=粗糙感 */
  const pg = raw.createGain();
  const pgv = Math.min(0.85, vel * 0.55) * (artic === 'stacc' ? 1.1 : 1) * (styleKey === 'jazz' ? 0.5 : 1); /* v5.7 收敛 */
  pg.gain.setValueAtTime(pgv, t);
  pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.012 + Math.random() * 0.01);
  const pkSrc = raw.createBufferSource(); pkSrc.buffer = guitarPickNoise(raw);
  pkSrc.connect(pk); pk.connect(pg); pg.connect(out);
  pkSrc.start(t); pkSrc.stop(t + 0.04);
  src.start(t); src.stop(t + dur + 0.4);
  /* v4 §2.3：前一音快速闪避到 0.45×——旋律"连成线"而不是一颗颗蹦 */
  if (GUITAR_SAMP._lastG && !legato && t - GUITAR_SAMP._lastT < 0.9 && GUITAR_SAMP._lastG !== g) { /* v5.1：连线时前音保持，断奏才闪避 */
    try {
      GUITAR_SAMP._lastG.gain.cancelScheduledValues(t);
      GUITAR_SAMP._lastG.gain.setTargetAtTime(GUITAR_SAMP._lastVel * 0.35, t, 0.035); /* v5.4 慢释放：泵感变坐感，吉他不再每拍被抽离 */
    } catch (e) {}
  }
  GUITAR_SAMP._lastG = g;
  GUITAR_SAMP._lastVel = Math.max(vel, 0.05);
  GUITAR_SAMP._lastT = t + dur;
  /* 双轨录制：厚度>0.5 时叠第二轨（±声像/微延迟/微失谐） */
  const th = state.tone.guitar ? state.tone.guitar.t : 0.2;
  if (th > 0.08) { /* 默认双轨：t=0.15 的 RnB/Jazz 不再是单薄单轨 */
    const raw2 = Tone.getContext().rawContext;
    const src2 = raw2.createBufferSource();
    src2.buffer = bank[best];
    src2.playbackRate.value = Math.pow(2, (midi - best) / 12) * (1.003 + Math.random() * 0.006); /* v5.7 每音随机失谐：固定 0.6% 会产生可闻拍频 */
    const g2 = raw2.createGain();
    const v2 = vel * (0.2 + th * 0.5); /* v5.4 副轨轻一点：宽度让位给融合 */
    const h2 = 0.006 + Math.random() * 0.01; /* v5.4 Haas 随机 6~16ms，不再固定 12ms 梳状感 */
    g2.gain.setValueAtTime(0.0001, t + h2);
    g2.gain.exponentialRampToValueAtTime(Math.max(v2, 0.03), t + h2 + 0.012);
    g2.gain.setValueAtTime(Math.max(v2, 0.03), t + Math.max(0.05, dur - 0.1));
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur + tail * 0.9); /* v5.3：双轨同演奏法尾音 */
    const pan = raw2.createStereoPanner ? raw2.createStereoPanner() : null;
    if (pan) { pan.pan.value = 0.28; g2.connect(pan); pan.connect(out); } /* v5.4 0.45→0.28：宽吉他=游离感 */
    else g2.connect(out);
    const tp2 = raw2.createBiquadFilter(); tp2.type = 'lowpass'; tp2.frequency.value = (1800 + Math.min(1, vel) * 6200) * 0.92; tp2.Q.value = 0.5;
    src2.connect(tp2); tp2.connect(g2);
    src2.start(t + h2); src2.stop(t + dur + 0.45);
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
  t += Math.random() * 0.008 - 0.004; /* v2 人性化：±4ms 偏移 */
  vel *= 1 + (Math.random() * 0.12 - 0.06); /* ±6% 力度抖动 */
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
/* ================= v4 律动引擎（GROOVE 表 + 排程层逐件 swing） =================
 * 谱面实测/风格对标：hatSwing=摇摆对 hat 族的额外推拉，snareLag=军鼓习惯性拖后，
 * kickP=kick 去摆（负=略提前）。Transport.swing 对 Transport.schedule 回调不生效，
 * 且各声部律动不同 → swing 全部在排程层逐件计算（baseSwingSec / drumTimeShift）。
 */
const GROOVE = {
  rnb:   { hatSwing: 0.62, snareLag: 0.028, kickP: -0.004 }, /* v5 醉拍：12→28ms */ /* 重音在 3&，军鼓大拖后 */
  jazz:  { hatSwing: 0.66, snareLag: 0.018, kickP: -0.003 }, /* behind-the-beat */
  rock:  { hatSwing: 0.10, snareLag: 0.002, kickP: 0      }, /* 实测修正：几乎不摆 */
  bossa: { hatSwing: 0.22, snareLag: 0.004, kickP: 0      },
  hiphop:{ hatSwing: 0.55, snareLag: 0.014, kickP: -0.004 },
  afro:  { hatSwing: 0.12, snareLag: 0.004, kickP: 0      },
};
const HAT_FAMILY = new Set(['hat', 'ohat', 'ride', 'shekere', 'shaker', 'bell', 'clave']);
/* B3 互锁：Afro 打击乐错位时间（Tony Allen 式多层前后错开） */
const AFRO_INTERLOCK = { shekere: -0.003, congaH: 0.008, congaL: 0.008, bell: 0.004, clap: -0.006 };
function baseSwingSec(pos16) {
  if (state.meter === 'm68') return 0; /* v5 6/8：三连音网格自带摇曳，swing 不再叠加 */
  return (Math.round(pos16) % 2 === 1) ? state.swing * secPer16() : 0;
}
function drumTimeShift(styleKey, inst, step16) {
  const s16 = ((Math.round(step16) % SBAR()) + SBAR()) % SBAR();
  let sh = (state.meter === 'm68') ? 0 : (Math.round(step16) % 2 === 1) ? state.swing * secPer16() : 0;
  const grv = GROOVE[styleKey];
  if (grv) {
    if (HAT_FAMILY.has(inst)) {
      const eff = grv.hatSwing * (0.5 + state.swing * 2);
      if (s16 % 4 === 2) sh += eff * secPer16() * 0.9;       /* 八分 &：拉向摇摆 */
      else if (s16 % 2 === 1) sh += eff * secPer16() * 0.45;  /* 奇数 16 分 */
    }
    if (inst === 'snare' || inst === 'clap') sh += grv.snareLag;
    if (inst === 'kick') sh += grv.kickP;
    if (styleKey === 'afro' && AFRO_INTERLOCK[inst]) sh += AFRO_INTERLOCK[inst];
  }
  return sh;
}
/* B6 pad/keys 侧链：kick/snare/clap 后 ~80ms 内和声自动闪避 */
let _ksStepsCache = null;
function duckMulAt(beat, mul) {
  if (!_ksStepsCache) _ksStepsCache = drumEvents.filter(d => d.inst === 'kick' || d.inst === 'snare' || d.inst === 'clap').map(d => d.step16);
  const win = Math.max(1, Math.round(0.08 / secPer16()));
  const s = Math.round(beat * SPB());
  for (const k of _ksStepsCache) { const d = s - k; if (d > 0 && d <= win) return mul; }
  return 1;
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
    const phrase = (beat % (4 * BPB())) / (4 * BPB()); /* v5 乐句周期随拍号（m44=16拍，与原一致） */
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
function totalBars() { return state.structure === 'song' ? SONG_BARS : state.structure === 'groove' ? 32 : state.slots.length; }
function sectionAt(bar) {
  if (state.structure === 'groove') return { name: 'groove', energy: Math.min(1, 0.45 + bar / 24) }; /* v5 endless-groove：能量只涨不剥壳 */
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
/* v4 S6 键盘按风格分音色：rnb=Rhodes(双层)/jazz=FM 颤音琴/rock=无(吉他chug 为主)
   bossa=原钢(Jobim)/afro=原钢稀疏顿奏/hiphop=暗黑 polysynth stab */
const SAMP_KEYS_BY_STYLE = {
  rnb: SAMP_KEYS, jazz: '@vibes', rock: null,
  bossa: 'acoustic_grand_piano', afro: 'acoustic_grand_piano', hiphop: 'pad_3_polysynth',
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
  mk('guitar').connect(nativeInputOf(AE.hpGuitar));
  mk('keys').connect(nativeInputOf(AE.hpKeys));
  mk('bass').connect(nativeInputOf(AE.toneFilterBass));
  mk('pad').connect(nativeInputOf(AE.hpPad));
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
  /* v4 预载：所有启用风格的 pad bank 与键盘音色（换挡换色不卡解码） */
  const actStyles = state.styles.length ? state.styles : ['rnb'];
  const extra = new Set();
  actStyles.forEach(k => {
    const pc = PAD_BY_STYLE[k];
    if (pc && SAMP_PAD[pc.bank]) extra.add(SAMP_PAD[pc.bank]);
    const kn = SAMP_KEYS_BY_STYLE[k];
    if (kn && kn !== '@vibes') extra.add(kn);
  });
  extra.forEach(n => { if (!core.includes(n)) ensureSample(n); });
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
  AE.guitarVol.volume.value = Tone.gainToDb(state.layers.guitar.vol * state.layers.guitar.vol) - 4; /* v4.1 让位鼓组 */
  AE.keysVol.volume.value = Tone.gainToDb(state.layers.keys.vol * state.layers.keys.vol) - 7;
  AE.bassVol.volume.value = Tone.gainToDb(state.layers.bass.vol * state.layers.bass.vol) - 4;
  AE.drumsVol.volume.value = Tone.gainToDb(state.layers.drums.vol * state.layers.drums.vol) + 0; /* v4.2 鼓组默认最高位 */
  AE.synthVol.volume.value = Tone.gainToDb(state.layers.synth.vol * state.layers.synth.vol) - 7.5; /* v4.3 pad 再退半步 */
  applyGuitarPatch();
}

function styleOfBar(beat) {
  const bar = Math.floor(beat / 4);
  return state.styles.length > 1 ? state.styles[bar % state.styles.length] : state.styles[0];
}

/* ---------- 走带调度（全部量化到 16 分网格，用 b:b:s 记谱） ---------- */
function t16(total16) {
  const sb = SBAR(), spb = SPB();
  const bar = Math.floor(total16 / sb), rem = total16 % sb;
  return `${bar}:${Math.floor(rem / spb)}:${rem % spb}`;
}
const secPer16 = () => 60 / state.bpm / 4;

function scheduleAll() {
  Tone.Transport.cancel(0);
  Tone.Transport.bpm.value = state.bpm;
  /* v4：swing 由排程层逐件计算（baseSwingSec/drumTimeShift）。
     Transport.swing 只对 Sequence/Part 迭代生效，对 Transport.schedule 回调无效——
     旧代码里 swing 滑条对实时播放完全不生效，MIDI 导出却生效（两套时间），此处统一 */
  Tone.Transport.swing = 0;
  Tone.Transport.swingSubdivision = '16n';
  _ksStepsCache = null; /* pad/keys 侧链缓存随鼓重算 */
  const bars = state.slots.length;

  /* 吉他旋律（v4 双源：rnb/jazz/bossa=SF 连音乐句优先；rock/hiphop/afro=真实采样优先） */
  if (state.layers.guitar.on) {
    const instName = SAMP_GUITAR[state.layers.guitar.patch] || null;
    let prevMel = null;
    for (let i = 0; i < melodyEvents.length; i++) {
      const e = melodyEvents[i];
      const nx = melodyEvents[i + 1];
      const t = t16(Math.round(e.beat * SPB()));
      /* v4 §2.2 tie：标记了连线的音，时值延长到下一音起音（不断开） */
      let durSteps = Math.max(1, Math.round(e.dur * 4));
      if (e.tie && nx && nx.beat - e.beat <= 2 && !nx.ghost) durSteps = Math.max(durSteps, Math.round((nx.beat - e.beat) * 4));
      const dur = durSteps * secPer16() * 0.95;
      const toff = voiceOff(styleOfBar(e.beat), 'melody', e.beat) + baseSwingSec(e.beat * SPB());
      /* v4 §2.3 滑音放宽：tie 级进必滑（|Δ|≤2）；|Δ|≤5 且缝隙 ≤0.25 拍也滑；大跳干净分离 */
      const gapBeats = prevMel ? e.beat - prevMel.end : 99;
      const dMidi = prevMel ? e.midi - prevMel.midi : 0;
      const slideFrom = prevMel && dMidi !== 0 && gapBeats <= 0.5
        && (Math.abs(dMidi) <= 2 || (Math.abs(dMidi) <= 5 && gapBeats <= 0.25)) ? prevMel.midi : null;
      prevMel = { midi: e.midi, end: e.beat + e.dur };
      const melStyle = styleOfBar(e.beat);
      const src = GUITAR_SRC_BY_STYLE[melStyle] || 'samp';
      Tone.Transport.schedule(tt => {
        const pgt = tt + toff;
        const gduck = duckMulAt(e.beat, 0.80); /* v4.2 吉他随 kick/snare 闪避，让鼓 */
        if (src === 'sf') {
          const inst = instName && sampOf(instName, 'guitar');
          if (inst) { inst.play(e.midi, pgt, { duration: dur + (e.artic === "stacc" ? 0.03 : e.artic === "port" ? 0.08 : e.dur >= 1 ? 0.2 : 0.1), gain: e.vel * 1.05 * gduck * (e.slur ? 0.82 : 1) }); return; } /* v5.3 SF 尾巴按演奏法 */
          if (playGuitarReal(state.layers.guitar.patch, e.midi, pgt, dur, e.vel * 1.0 * gduck, slideFrom, e.tie || e.slur, melStyle, e.artic)) return;
          AE.guitar.triggerAttackRelease(midiName(e.midi), dur, pgt, e.vel * gduck * (e.slur ? 0.82 : 1));
        } else {
          if (playGuitarReal(state.layers.guitar.patch, e.midi, pgt, dur, e.vel * 1.0 * gduck, slideFrom, e.tie || e.slur, melStyle, e.artic)) return;
          const inst = instName && sampOf(instName, 'guitar');
          if (inst) inst.play(e.midi, pgt, { duration: dur + (e.artic === "stacc" ? 0.03 : e.artic === "port" ? 0.08 : e.dur >= 1 ? 0.2 : 0.1), gain: e.vel * 1.05 * gduck });
          else AE.guitar.triggerAttackRelease(midiName(e.midi), dur, pgt, e.vel * gduck);
        }
      }, t);
    }
  }
  /* 键盘（按风格分音色：Rhodes/颤音琴/暗黑铺） */
  if (state.layers.keys.on) {
    for (const e of keysEvents) {
      const t = t16(Math.round(e.beat * SPB()));
      const dur = Math.max(1, Math.round(e.dur * 4)) * secPer16() * 0.95;
      const names = e.notes.map(midiName);
      const koff = voiceOff(styleOfBar(e.beat), 'keys', e.beat) + baseSwingSec(e.beat * SPB());
      const ks = SAMP_KEYS_BY_STYLE[styleOfBar(e.beat)] || SAMP_KEYS;
      const kduck = duckMulAt(e.beat, 0.68); /* B6：kick/snare 后和声闪避（v4.2 加深，泵感=鼓的力量感） */
      Tone.Transport.schedule(tt2 => { const tt = tt2 + koff;
        const gi = e.inst && e.inst.startsWith('guitar:') ? e.inst.slice(7) : null;
        const gInst = gi && sampOf(SAMP_GUITAR[gi], 'guitar');
        if (gInst) for (const n of e.notes) gInst.play(n, tt, { duration: dur, gain: e.vel * 1.0 * kduck });
        else if (ks === '@vibes') AE.keysVibes.triggerAttackRelease(names, dur, tt, e.vel * 0.85 * kduck);
        else {
          const inst = ks && sampOf(ks, 'keys');
          if (inst) for (const n of e.notes) inst.play(n, tt, { duration: dur, gain: e.vel * kduck });
          else AE.keys.triggerAttackRelease(names, dur, tt, e.vel * kduck);
        }
      }, t);
    }
  }
  /* 合成器 Pad（v4 S2 换挡换色：音色按小节风格解析，不再整曲一个音色） */
  if (state.layers.synth.on) {
    for (const e of synthEvents) {
      const t = t16(Math.round(e.beat * SPB()));
      const dur = Math.max(1, Math.round(e.dur * 4)) * secPer16() * 0.98;
      const names = e.notes.map(midiName);
      const poff = voiceOff(styleOfBar(e.beat), 'pad', e.beat) + baseSwingSec(e.beat * SPB());
      const lag = e.padLag || 0;
      const pcfg = PAD_BY_STYLE[styleOfBar(e.beat)] || PAD_BY_STYLE.rnb;
      const padName = SAMP_PAD[pcfg.bank];
      const inst = (padName && sampOf(padName, 'pad')) || null;
      const pduck = duckMulAt(e.beat, 0.68); /* B6：kick 后 pad 闪避更深 */
      Tone.Transport.schedule(tt => {
        if (inst) for (const n of e.notes) inst.play(n, tt + poff + lag, { duration: dur, gain: e.vel * 1.4 * pduck });
        else AE.synthPad.triggerAttackRelease(names, dur, tt + poff + lag, e.vel * pduck);
      }, t);
    }
    /* v5 horn 层：反拍铜管 stab（走 pad 采样库，短促 envelope） */
    for (const e of hornEvents) {
      const t = t16(Math.round(e.beat * SPB()));
      const dur = Math.max(1, Math.round(e.dur * SPB())) * secPer16() * 0.9;
      const poff = voiceOff('afro', 'pad', e.beat);
      Tone.Transport.schedule(tt => {
        const inst = sampOf('brass_section', 'pad') || (SAMP_PAD.warm && sampOf(SAMP_PAD.warm, 'pad'));
        if (inst) for (const n of e.notes) inst.play(n, tt + poff, { duration: dur, gain: e.vel * 1.3 });
        else AE.synthPad.triggerAttackRelease(e.notes.map(midiName), dur, tt + poff, e.vel);
      }, t);
    }
  }
  /* 贝斯（指弹电贝斯采样）+ kick-bass ducking */
  if (state.layers.bass.on) {
    const inst = sampOf(SAMP_BASS, 'bass');
    const kickBeats = drumEvents.filter(d => d.inst === 'kick').map(d => d.step16 / SPB());
    for (const e of bassEvents) {
      /* kick 后 120ms 内的贝斯音自动避让 -3dB（假侧链） */
      const ducked = kickBeats.some(k => { const d = e.beat - k; return d > 0.001 && d < 0.12; });
      const duckMul = ducked ? 0.7 : 1;
      const t = t16(Math.round(e.beat * SPB()));
      const dur = Math.max(1, Math.round(e.dur * 4)) * secPer16() * 0.95;
      const boff = voiceOff(styleOfBar(e.beat), 'bass', e.beat) + baseSwingSec(e.beat * SPB());
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
  /* 鼓（真实采样优先；v4 律动引擎：每件按 GROOVE 表单独位移 + 叠层触发） */
  if (state.layers.drums.on) {
    for (const e of drumEvents) {
      const t = t16(e.step16);
      const dStyle = styleOfBar(e.step16 / SPB());
      const doff = voiceOff(dStyle, (e.inst === 'hat' || e.inst === 'ohat' || e.inst === 'ride' || e.inst === 'shekere' || e.inst === 'shaker') ? 'hat' : 'drums', e.step16 / SPB())
        + drumTimeShift(dStyle, e.inst, e.step16);
      Tone.Transport.schedule(tt0 => { const tt = tt0 + doff;
        const kit = e.kit || DRUM_KITS.rnb;
        const smp = (inst) => { const n = kit[inst]; return n ? playDrumSample(n, tt, e.vel) : false; };
        if (smp(e.inst)) {
          /* B2 叠层：强 kick 叠 808 次低音 / rnb 军鼓叠 rimshot（采样命中时也叠） */
          if (e.sub) trig808kick(tt + 0.002, e.vel * 0.5);
          if (e.rimLayer) AE.rim808.triggerAttackRelease('A5', '16n', tt + 0.004, e.vel * 0.5);
          return;
        }
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
          case 'kick': AE.kick.triggerAttackRelease('C1', '8n', tt, e.vel); if (e.sub) trig808kick(tt + 0.002, e.vel * 0.5); break;
          case 'clave': AE.conga.triggerAttackRelease('G3', '16n', tt, e.vel); break;
          case 'snare': AE.snare.triggerAttackRelease('16n', tt, e.vel); AE.snareBody.triggerAttackRelease('G2', '16n', tt, e.vel * 0.5); if (e.rimLayer) AE.rim808.triggerAttackRelease('A5', '16n', tt + 0.004, e.vel * 0.5); break;
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
      if (!playGuitarReal(state.layers.guitar.patch, seq[i], t + i * 0.22, 0.2, 0.9, null, false, state.styles[0])) {
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

/* ================= AI 录音棚：旋律离屏渲染 → MusicGen melody 条件生成 ================= */
function encodeWav(buffers, sampleRate) {
  const ch0 = buffers[0]; const numCh = buffers.length; const len = ch0.length;
  const buf = new ArrayBuffer(44 + len * numCh * 2); const v = new DataView(buf);
  const wstr = (o, s2) => { for (let i = 0; i < s2.length; i++) v.setUint8(o + i, s2.charCodeAt(i)); };
  wstr(0, 'RIFF'); v.setUint32(4, 36 + len * numCh * 2, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * 2, true); v.setUint16(32, numCh * 2, true);
  v.setUint16(34, 16, true); wstr(36, 'data'); v.setUint32(40, len * numCh * 2, true);
  let off = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < numCh; c++) {
    const s2 = Math.max(-1, Math.min(1, buffers[c][i]));
    v.setInt16(off, s2 < 0 ? s2 * 0x8000 : s2 * 0x7FFF, true); off += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}
function blobToDataURI(blob) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}
async function renderMelodyToWav(guideOffsetBeats) {
  const SR = 22050;
  const beatsPerBar = state.meter === 'm34' ? 3 : state.meter === 'm68' ? 6 : 4;
  const loopSec = totalBars() * beatsPerBar * 60 / state.bpm;
  const dur = Math.min(30, Math.max(10, loopSec));
  const ctx = new OfflineAudioContext(1, Math.ceil(dur * SR), SR);
  const master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
  const secPerBeat = 60 / state.bpm;
  const off = guideOffsetBeats || 0; /* v6 分块：第 N 块从第 N×28 秒开始取事件 */
  const note = (midi, t, d, vel, type) => {
    if (t < -0.01 || t >= dur - 0.05) return;
    const tt = Math.max(0, t);
    const dd = Math.min(d, dur - tt);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, tt);
    g.gain.exponentialRampToValueAtTime(Math.max(vel, 0.08), tt + 0.012);
    g.gain.setValueAtTime(Math.max(vel, 0.08), tt + Math.max(0.03, dd - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, tt + dd + 0.1);
    osc.connect(g); g.connect(master);
    osc.start(tt); osc.stop(tt + dd + 0.15);
  };
  /* v6 引导带三件套：旋律(主角) + 和弦垫(0.30) + 贝斯(0.5)。
     MusicGen 的 melody 条件提取的是色度(chroma)——混入轻量 pad/贝斯后，
     引导带的色度携带完整和声走向，模型不再瞎猜和弦，只负责"演奏与录音"。 */
  for (const e of synthEvents) {
    const t = (e.beat - off) * secPerBeat;
    for (const n of (e.notes || [])) note(n, t, e.dur * secPerBeat, 0.3 * e.vel, 'sine');
  }
  for (const e of bassEvents) {
    note(e.midi, (e.beat - off) * secPerBeat, e.dur * secPerBeat, 0.5 * e.vel, 'sine');
  }
  for (const e of melodyEvents) {
    note(e.midi, (e.beat - off) * secPerBeat, e.dur * secPerBeat, Math.max(e.vel, 0.1), 'triangle');
  }
  const rendered = await ctx.startRendering();
  return encodeWav([rendered.getChannelData(0)], SR);
}
/* v6 分块拼接：块长 30s、步进 28s（2s 等功率交叉淡化），整曲突破 30s 上限 */
async function studioGenerateChunk(prompt, melodyURI, token, temperature) {
  /* provider 1：本机 musicgen_server.py（medium 模型，免费且质量高于 small） */
  try {
    const h = await fetch('http://127.0.0.1:7860/health', { signal: AbortSignal.timeout(1500) });
    if (h.ok) {
      const r = await fetch('http://127.0.0.1:7860/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, melody: melodyURI, duration: 30, temperature: temperature || 1.0 }),
      });
      if (r.ok) return await r.arrayBuffer();
    }
  } catch (e) { /* 本机服务未启动，走 Replicate */ }
  /* provider 2：Replicate meta/musicgen（melody 版，需 token） */
  const pred = await fetch('https://api.replicate.com/v1/models/meta/musicgen/predictions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: { prompt, melody: melodyURI, duration: 30, model_version: 'melody', temperature: temperature || 1.0 } }),
  });
  if (!pred.ok) {
    const err = await pred.text();
    throw new Error('Replicate 请求失败(' + pred.status + ')：' + err.slice(0, 160) + (pred.status === 401 ? '（token 无效）' : ''));
  }
  let job = await pred.json();
  while (job.status !== 'succeeded' && job.status !== 'failed' && job.status !== 'canceled') {
    await new Promise(r => setTimeout(r, 2500));
    const poll = await fetch('https://api.replicate.com/v1/predictions/' + job.id, { headers: { 'Authorization': 'Bearer ' + token } });
    job = await poll.json();
  }
  if (job.status !== 'succeeded') throw new Error('生成失败：' + JSON.stringify(job.error || '').slice(0, 160));
  const audioUrl = Array.isArray(job.output) ? job.output[0] : job.output;
  const ab = await fetch(audioUrl);
  if (!ab.ok) throw new Error('下载生成结果失败(' + ab.status + ')');
  return await ab.arrayBuffer();
}
function buildStudioPrompt() {
  const st = state.styles[0];
  const keyName = pcName(state.keyRoot) + ' ' + (state.mode === 'minor' || state.mode === 'dorian' ? 'minor' : 'major');
  const preset = PRESETS.find(p => p.id === state.presetId);
  const P = {
    rnb: 'neo-soul R&B, smooth electric guitar lead, rhodes piano, warm 808 drums, laid-back groove, lush pads, professional studio recording',
    jazz: 'swing jazz, hollow-body electric guitar lead, upright bass, brushed drums, soft piano comping, intimate club recording',
    rock: 'classic rock, distorted electric guitar lead, driving drums, powerful bass, arena energy, vintage analog recording',
    bossa: 'bossa nova, nylon string guitar lead, soft percussion, warm upright bass, gentle keys, beachside ambience, vintage recording',
    afro: 'afrobeat, interlocking guitars, congas and shekere percussion, groovy electric bass, horn stabs, energetic live band recording',
    hiphop: 'modern trap hip-hop, dark melodic hook, deep 808 sub bass, crisp hi-hats, atmospheric keys, punchy mix',
  };
  return (P[st] || P.rnb) + ', in ' + keyName + ', ' + state.bpm + ' bpm' + (preset ? ', ' + preset.name : '') + ', high quality, well mixed';
}
async function studioRender(variantIdx, temperature, label) {
  const tokenEl = document.getElementById('replicate-token');
  const status = document.getElementById('studio-status');
  const token = (tokenEl.value || '').trim();
  try { localStorage.setItem('motif_replicate', token); } catch (e) {}
  const beatsPerBar = state.meter === 'm34' ? 3 : state.meter === 'm68' ? 6 : 4;
  const secPerBeat = 60 / state.bpm;
  const loopSec = totalBars() * beatsPerBar * secPerBeat;
  const CHUNK = 28, FADE = 2; /* 30s 块、28s 步进、2s 交叉淡化 */
  const nChunks = Math.max(1, Math.ceil(loopSec / CHUNK));
  let localOK = false;
  try { localOK = (await fetch('http://127.0.0.1:7860/health', { signal: AbortSignal.timeout(1500) })).ok; } catch (e) {}
  if (!localOK && !token) { status.textContent = '请先填写 Replicate API Token（replicate.com → Account → API tokens），或启动本机服务（musicgen_server.py，免费且模型更大）'; tokenEl.focus(); return; }
  status.textContent = '① 正在渲染引导带（旋律+和声+贝斯）…';
  try {
    const prompt = buildStudioPrompt();
    const chunkBufs = [];
    for (let i = 0; i < nChunks; i++) {
      const wav = await renderMelodyToWav(i * CHUNK / secPerBeat);
      const melodyURI = await blobToDataURI(wav);
      status.textContent = '② AI 录音棚 ' + (i + 1) + '/' + nChunks + '…' + (localOK ? '（本机 medium 模型）' : '（Replicate）');
      const ab = await studioGenerateChunk(prompt, melodyURI, token, temperature);
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      chunkBufs.push(await actx.decodeAudioData(ab));
      await actx.close();
    }
    /* 交叉淡化拼接：等功率 2s 淡化消除块间接缝 */
    status.textContent = '③ 拼接 ' + nChunks + ' 个乐段…';
    const sr = 44100;
    const stride = chunkBufs[0].duration - FADE;
    const total = stride * (nChunks - 1) + chunkBufs[0].duration;
    const off = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
    let t = 0;
    for (let i = 0; i < nChunks; i++) {
      const srcN = off.createBufferSource(); srcN.buffer = chunkBufs[i];
      const g = off.createGain();
      if (i > 0) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + FADE); }
      srcN.connect(g); g.connect(off.destination);
      srcN.start(t);
      t += stride;
    }
    const stitched = await off.startRendering();
    const wav = encodeWav([stitched.getChannelData(0), stitched.getChannelData(1)], sr);
    const url = URL.createObjectURL(wav);
    if (variantIdx !== undefined) {
      const box = document.getElementById('studio-variants');
      box.hidden = false;
      const row = document.createElement('div');
      row.className = 'variant-row';
      row.innerHTML = '<span class="variant-label">' + label + '</span><audio controls style="flex:1"></audio><a class="btn small" download="motif-variant.wav">⬇</a>';
      row.querySelector('audio').src = url;
      row.querySelector('a').href = url;
      box.appendChild(row);
      return;
    }
    document.getElementById('studio-result').hidden = false;
    document.getElementById('studio-audio').src = url;
    document.getElementById('studio-dl').href = url;
    status.textContent = '✓ ' + (label ? label + ' 完成（' : '完成！AI 按你的旋律/和声/风格生成 ') + Math.round(total) + 's 唱片级渲染（引导带含完整和声，模型只负责演奏与录音）。';
  } catch (e) {
    status.textContent = '出错：' + (e && e.message ? e.message.slice(0, 240) : e);
  }
}

/* ================= 生成式渲染（本地神经网络，Suno 同技术路线） =================
   采样拼接的混音天花板物理上够不着唱片级；这条路线换成神经音频生成：
   模型直接从音频潜空间生成波形，乐器/空间/混音是"长"出来的而非拼出来的。
   免费、不要 token、数据不出本机。代价：首次下载约 1.2GB 模型（之后走缓存）、
   需要 Chrome/Edge 桌面版（WebGPU）、生成一次约 1-5 分钟（取决于显卡）。 */
let NEURAL_PIPE = null, NEURAL_LOADING = null;
async function neuralRender() {
  const status = document.getElementById('studio-status');
  if (!navigator.gpu) { status.textContent = '本浏览器不支持 WebGPU（需桌面版 Chrome/Edge）；可改用「渲染成唱片」或导出 WAV 到 HuggingFace 免费生成'; return; }
  try {
    if (!NEURAL_PIPE) {
      if (!NEURAL_LOADING) {
        NEURAL_LOADING = (async () => {
          status.textContent = '正在加载神经网络（首次约 1.2GB，之后走缓存）…';
          const t = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@3.3.1');
          t.env.allowLocalModels = false;
          t.env.progress_callback = p => {
            if (p.status === 'progress') status.textContent = '下载模型 ' + (p.file || '') + ' ' + Math.round(p.progress || 0) + '%';
          };
          let pipe;
          try {
            pipe = await t.pipeline('text-to-audio', 'Xenova/musicgen-small', { dtype: 'q8' });
          } catch (e) {
            pipe = await t.pipeline('text-to-audio', 'Xenova/musicgen-small');
          }
          return pipe;
        })();
      }
      NEURAL_PIPE = await NEURAL_LOADING;
    }
    status.textContent = '🧠 神经网络生成中（约 1-5 分钟，取决显卡）…';
    const prompt = buildStudioPrompt();
    const out2 = await NEURAL_PIPE(prompt, {
      max_new_tokens: 512,
      do_sample: true,
      temperature: 1.0,
      top_k: 50,
      guidance_scale: null,
    });
    const audio = out2.audio, sr = out2.sampling_rate || 32000;
    const wav = encodeWav([audio], sr);
    const url = URL.createObjectURL(wav);
    document.getElementById('studio-result').hidden = false;
    document.getElementById('studio-audio').src = url;
    document.getElementById('studio-dl').href = url;
    status.textContent = '✓ 生成式渲染完成（' + Math.round(audio.length / sr) + 's）。声学/空间/混音由模型生成——注意：此为文本驱动，旋律走向为 AI 自由演绎，不严格遵循卷帘上的旋律；要旋律严格一致请用「渲染成唱片」。';
  } catch (e) {
    status.textContent = '生成式渲染出错：' + (e && e.message ? e.message.slice(0, 200) : e) + '（可改用「渲染成唱片」或导出 WAV 免费路径）';
  }
}

/* 梯级2·变体挑选：同一引导带三种采样温度，逐版渲染供盲听挑选 */
async function studioRenderVariants() {
  const status = document.getElementById('studio-status');
  const box = document.getElementById('studio-variants');
  box.innerHTML = ''; box.hidden = true;
  const TEMPS = [1.0, 1.15, 0.9];
  const LABELS = ['变体A·标准', '变体B·奔放', '变体C·克制'];
  for (let i = 0; i < 3; i++) {
    status.textContent = '🎲 渲染变体 ' + (i + 1) + '/3（' + LABELS[i] + '）…';
    try { await studioRender(i, TEMPS[i], LABELS[i]); }
    catch (e) { status.textContent = LABELS[i] + ' 失败：' + (e && e.message ? e.message.slice(0, 120) : e); }
  }
  status.textContent = '✓ 三个变体已就绪，盲听挑选你最喜欢的一版（可复制链接发给朋友一起选）。';
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
  const totalTicks = totalBars() * BPB() * tpb;
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
    const t = Math.round(e.beat * tpb) + swingAdd(e.beat * SPB());
    const dur = Math.round(e.dur * tpb);
    notePair(t, dur, 0, e.midi, clamp(Math.round(e.vel * 127), 25, 127));
  }
  for (const e of keysEvents) {
    const t = Math.round(e.beat * tpb) + swingAdd(e.beat * SPB());
    const dur = Math.round(e.dur * tpb);
    for (const n of e.notes) notePair(t, dur, 1, n, clamp(Math.round(e.vel * 127), 20, 110));
  }
  for (const e of bassEvents) {
    const t = Math.round(e.beat * tpb) + swingAdd(e.beat * SPB());
    const dur = Math.round(e.dur * tpb);
    notePair(t, dur, 2, e.midi, clamp(Math.round(e.vel * 127), 25, 120));
  }
  /* 合成器 Pad → ch3（GM 音色号按 Pad 类型） */
  const PAD_PROGRAM = { halo: 95, sweep: 96, warm: 90, choir: 92, strings: 51, polysynth: 91 };
  const domStyle = state.styles.length === 1 ? state.styles[0] : 'rnb';
  ev.push({ tick: 0, order: 0, bytes: [0xC3, PAD_PROGRAM[(PAD_BY_STYLE[domStyle] || PAD_BY_STYLE.rnb).bank] || 90] });
  for (const e of synthEvents) {
    const t = Math.round(e.beat * tpb) + swingAdd(e.beat * SPB());
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
 * 音频导出（v4）：实时录一遍全曲 → WebM，与听到的完全一致（含 Logic 级母带链）
 * ============================================================ */
let _audioRec = null;
async function exportAudio() {
  if (typeof Tone === 'undefined') { alert('音频引擎加载失败，请检查网络后刷新页面'); return; }
  if (!(await ensureAudio())) return;
  if (_audioRec) return; /* 录制中防重入 */
  const btn = document.getElementById('btn-audio');
  const wasPlaying = state.playing;
  applyMix();
  Tone.Transport.stop();
  restoreSampleBuses();
  scheduleAll();
  Tone.Transport.position = 0;
  const stream = AE.recDest.stream;
  const mime = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) ? 'audio/webm;codecs=opus' : 'audio/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
  const durMs = totalBars() * BPB() * (60000 / state.bpm) + 800; /* 全曲 + 尾音余量 */
  rec.onstop = () => {
    _audioRec = null;
    Tone.Transport.stop();
    if (wasPlaying) { Tone.Transport.start(); }
    else { state.playing = false; silenceSampleBuses(); }
    updatePlayBtn();
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `motif_${pcName(state.keyRoot)}${state.mode}_${state.bpm}bpm.webm`;
    a.click();
    URL.revokeObjectURL(a.href);
    if (btn) btn.textContent = '⬇ 导出音频（WebM）';
  };
  _audioRec = rec;
  if (btn) btn.textContent = '⏺ 录制中…';
  rec.start();
  state.playing = true;
  updatePlayBtn();
  Tone.Transport.start();
  setTimeout(() => { try { rec.stop(); } catch (e) {} }, durMs);
}

/* ============================================================
 * UI 渲染
 * ============================================================ */
const $ = sel => document.querySelector(sel);

/* 语义音色目标（方案2: 语义化EQ，MDPI 2016）：每层 亮度bright/空间space/厚度thick 0~1 */
const STYLE_TONE = {
  rnb:   { guitar:{b:0.46,s:0.30,t:0.10}, keys:{b:0.30,s:0.50,t:0.0}, bass:{b:0.30,s:0.15,t:0.0}, pad:{b:0.25,s:0.70,t:0.0}, drums:{b:0.45,s:0.15,t:0.2} }, /* v4.3 吉他提亮+收湿声 */
  jazz:  { guitar:{b:0.44,s:0.26,t:0.10}, keys:{b:0.35,s:0.40,t:0.0}, bass:{b:0.35,s:0.10,t:0.0}, pad:{b:0.30,s:0.50,t:0.0}, drums:{b:0.50,s:0.20,t:0.1} },
  rock:  { guitar:{b:0.70,s:0.20,t:0.50}, keys:{b:0.50,s:0.20,t:0.2}, bass:{b:0.55,s:0.10,t:0.3}, pad:{b:0.40,s:0.30,t:0.2}, drums:{b:0.60,s:0.25,t:0.35} },
  bossa: { guitar:{b:0.58,s:0.30,t:0.05}, keys:{b:0.40,s:0.35,t:0.0}, bass:{b:0.35,s:0.10,t:0.0}, pad:{b:0.30,s:0.40,t:0.0}, drums:{b:0.50,s:0.20,t:0.1} },
  afro:  { guitar:{b:0.55,s:0.28,t:0.15}, keys:{b:0.50,s:0.25,t:0.1}, bass:{b:0.45,s:0.15,t:0.2}, pad:{b:0.40,s:0.30,t:0.1}, drums:{b:0.55,s:0.30,t:0.3} },
  hiphop:{ guitar:{b:0.42,s:0.24,t:0.20}, keys:{b:0.30,s:0.65,t:0.0}, bass:{b:0.25,s:0.10,t:0.3}, pad:{b:0.25,s:0.60,t:0.0}, drums:{b:0.50,s:0.40,t:0.4} },
};
function applyTone(layer) {
  if (!AE.ready) return;
  const t = (state.tone[layer] || { b: 0.5, s: 0.3, t: 0.2 });
  const perfMul = state.perf ? 0.5 : 1;
  const brightDb = -12 + t.b * 26;
  if (layer === 'guitar' && AE.toneEqGuitar) {
    AE.toneEqGuitar.high.value = brightDb;
    AE.toneEqGuitar.low.value = -2 + t.t * 4;
    AE.toneEqGuitar.mid.value = 0.5 + t.t * 2.5; /* v5.1 琴体归位：塑料感=中频掏空，糊该由低频频段管 */
    AE.toneDistGuitar.distortion = t.t * 0.35;
    AE.sendGuitar.gain.value = t.s * 0.65 * perfMul; /* v4.3 混响发送收敛 */
  } else if (layer === 'keys' && AE.toneEqKeys) {
    AE.toneEqKeys.high.value = brightDb;
    AE.toneEqKeys.low.value = -3.5 + t.b * 3; /* v5.2 Rhodes 低中收掉：250-500Hz 和吉他/贝斯抢 = 难听根源 */
    AE.toneEqKeys.mid.value = -1 + t.b * 2;
    AE.toneDistKeys.distortion = t.t * 0.25;
    AE.sendKeys.gain.value = t.s * 0.55 * perfMul; /* v5.2 0.9→0.55：电钢琴不再泡在大混响里 */
  } else if (layer === 'bass' && AE.toneFilterBass) {
    AE.toneFilterBass.frequency.value = 400 + t.b * 9000; /* 200Hz(闷)~9.4kHz(亮)，默认不再闷 */
    AE.sendBass.gain.value = t.s * 0.25;
  } else if (layer === 'pad' && AE.toneEqPad) {
    AE.toneEqPad.high.value = brightDb;
    AE.toneEqPad.low.value = -4; /* v4.3 低频让位贝斯 */
    AE.toneEqPad.mid.value = -3; /* v4.3 中频让位吉他 */
    AE.sendPad.gain.value = t.s * 0.25; /* pad 自带大混响，space 发送减半防糊 */
  } else if (layer === 'drums' && AE.toneEqDrums) {
    AE.toneEqDrums.high.value = brightDb;
    AE.toneEqDrums.low.value = -2 + t.b * 5; /* v4.3 kick 低频权重随风格 */
    AE.toneDistDrums.distortion = Math.max(0.12, t.t * 0.07); /* v2：饱和常开底线=鼓皮粘合感 */
    AE.sendDrums.gain.value = t.s * 0.5 * perfMul; /* v4.3 鼓房发送收敛 */
  }
}
function applyStyleTone(styleKey) {
  const tbl = STYLE_TONE[styleKey];
  if (!tbl) return;
  /* v4 S5：pad 低通随风格（rnb 胶感 5.2k / rock 门控 3.8k / hiphop 暗黑 3.4k …） */
  if (AE.padFilter) {
    const pc = PAD_BY_STYLE[styleKey];
    if (pc) AE.padFilter.frequency.value = pc.lpf;
  }
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
  rnb:   { guitar: 'clean',  keys: 'comp',  drums: 'full',  swing: 22, bpm: 85,  synth: 'choir',  preset: 'rnb-1625' },
  jazz:  { guitar: 'jazz',   keys: 'comp',  drums: 'auto',  swing: 41, bpm: 110, synth: 'warm',   preset: 'jazz-2516' }, /* swing 2.39:1 偏好窗口 */
  rock:  { guitar: 'dist',   keys: 'auto',  drums: 'drive', swing: 0,  bpm: 122, synth: 'sweep',  preset: 'rock-min' },
  bossa: { guitar: 'nylon',  keys: 'auto',  drums: 'auto',  swing: 2,  bpm: 78,  synth: 'warm',   preset: 'bossa-251' }, /* 138=Samba，78 才是 Bossa */
  afro:  { guitar: 'clean',  keys: 'auto',  drums: 'drive', swing: 4,  bpm: 104, synth: 'halo',   preset: 'afro-min' },
  hiphop:{ guitar: 'clean',  keys: 'pad',   drums: 'auto',  swing: 0,  bpm: 140, synth: 'halo',   preset: 'trap-min' }, /* trap 标准速度 */
};

/* v4.1 预设与风格匹配：下拉只列当前风格可用的走向，杜绝"布鲁斯走向配 rnb" */
function syncPresetSelect() {
  const ps = document.getElementById('preset-select');
  if (!ps) return;
  const match = PRESETS.filter(p => p.styles.some(s => state.styles.includes(s)));
  const hadCustom = [...ps.options].some(o => o.value === 'custom');
  ps.innerHTML = match.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  if (hadCustom) { const o = document.createElement('option'); o.value = 'custom'; o.textContent = '自定义进行'; ps.appendChild(o); }
  if (state.presetId === 'custom') ps.value = 'custom';
  else if (match.some(p => p.id === state.presetId)) ps.value = state.presetId;
  else if (match.length) loadPreset(match[0].id); /* 当前走向与风格不符 → 自动换成本风格招牌走向 */
}

function setStyles(list) {
  state.styles = list.slice();
  document.querySelectorAll('#style-chips .chip').forEach(chip => {
    chip.classList.toggle('active', state.styles.includes(chip.dataset.style));
  });
  syncPresetSelect(); /* v4.1：预设列表随风格过滤 */
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
  if (cfg.preset && state.presetId !== cfg.preset) {
    const p = PRESETS.find(x => x.id === cfg.preset);
    if (p && p.styles.some(s => state.styles.includes(s))) loadPreset(cfg.preset);
  }
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
  const total16 = bars * SBAR();
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
    if (s % SBAR() === 0) { ctx.strokeStyle = 'rgba(36,39,42,.28)'; ctx.lineWidth = 1.2; }
    else if (s % SPB() === 0) { ctx.strokeStyle = 'rgba(36,39,42,.09)'; ctx.lineWidth = 1; }
    else { ctx.strokeStyle = 'rgba(36,39,42,.04)'; ctx.lineWidth = 1; }
    ctx.stroke();
  }
  /* 小节标签 + 和弦 */
  ctx.font = '10px -apple-system, "PingFang SC", sans-serif';
  for (let b = 0; b < bars; b++) {
    const x = labelW + b * SBAR() * cellW;
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
  genHorns(); /* v5 horn 层 */
  genDrums();
  interlockPass(); /* v5.7：贝斯锁鼓/键盘避让旋律——调度前最后一道互锁对齐 */
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
  const meterEl = document.getElementById('ctl-meter'); /* v5 拍子系统 */
  if (meterEl) { meterEl.value = state.meter; meterEl.onchange = () => { state.meter = meterEl.value; regenerate('patch'); }; }
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
  const btnAudio = document.getElementById('btn-audio');
  if (btnAudio) btnAudio.onclick = exportAudio;
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
  const tokEl = document.getElementById('replicate-token');
  try { tokEl.value = localStorage.getItem('motif_replicate') || ''; } catch (e) {}
  document.getElementById('btn-studio').onclick = () => studioRender();
  document.getElementById('btn-studio3').onclick = studioRenderVariants;
  document.getElementById('btn-neural').onclick = neuralRender;
  document.getElementById('btn-melody-wav').onclick = async () => {
    const st = document.getElementById('studio-status');
    st.textContent = '正在渲染旋律 WAV…';
    try {
      const wav = await renderMelodyToWav();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(wav);
      a.download = 'melody_' + state.styles[0] + '_' + state.bpm + 'bpm.wav';
      a.click();
      st.textContent = '✓ 已下载。免费生成：打开 huggingface.co/spaces/facebook/MusicGen → Melody 条件 → 上传此 WAV → 提示词粘这段：' + buildStudioPrompt();
    } catch (e) { st.textContent = '出错：' + (e && e.message); }
  };
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
