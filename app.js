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
    drums:  { on: true, vol: 0.7, patch: 'auto' },
  },
  playing: false,
  audioReady: false,
};

/* 派生数据 */
let chordTimeline = [];   // 每小节: { rootPC, rootMidi, qKey, name, roman, ext, iv[], pcs[], tonesMidi[], scalePCs[] }
let melodyEvents = [];    // { beat, midi, dur, vel }
let bassEvents = [];
let keysEvents = [];      // { beat, notes:[midi], dur, vel }
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
      name: pcName(rootPC) + c.sym,
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
    durBias: 0.5, rep: 0.5, blue: false, synco: 0.5, maxLeap: 7,
  };
  const has = (...words) => words.some(w => t.includes(w));
  if (has('上行', '上升', '向上', '攀升', '爬升', 'up', 'ascend', 'climb', 'rise')) p.dir = 'up';
  if (has('下行', '下降', '向下', '坠落', '下滑', 'down', 'descend', 'fall')) p.dir = 'down';
  if (has('波浪', '起伏', '迂回', 'wave', 'arch', 'swell')) p.dir = 'wave';
  if (has('环绕', '盘旋', '绕回', 'hover', 'orbit')) p.dir = 'orbit';
  if (has('级进', '平稳', '平滑', '连贯', 'step', 'smooth', 'legato', 'flow')) { p.stepP = 0.85; p.maxLeap = 4; }
  if (has('跳进', '跳跃', '大跳', 'leap', 'jump', 'arpeggio', 'arp')) { p.stepP = 0.3; p.maxLeap = 12; }
  if (has('密集', '急促', '紧张', 'busy', 'dense', 'fast', 'run', '冲刺')) p.density = 0.85;
  if (has('稀疏', '舒缓', '松弛', '平静', '呼吸感', 'sparse', 'slow', 'calm', 'airy', 'space')) p.density = 0.25;
  if (has('高音', '高亢', '嘹亮', '尖', 'high', 'bright', 'soar')) { p.regLo = 67; p.regHi = 88; }
  if (has('低音', '低沉', '低吟', '闷', 'low', 'deep', 'dark', 'mellow')) { p.regLo = 55; p.regHi = 76; }
  if (has('长音', '绵延', '拖沓', '拖长', 'long', 'sustain', 'hold', 'pad')) p.durBias = 0.8;
  if (has('短促', '碎', '断奏', '干脆', 'short', 'staccato', 'choppy', 'stab')) p.durBias = 0.15;
  if (has('忧郁', '悲伤', '蓝调', '苦涩', 'sad', 'blue', 'melancholy', 'cry')) p.blue = true;
  if (has('明亮', '欢快', '阳光', 'uplift', 'happy', 'bright', 'shine')) { p.blue = false; p.stepP = Math.min(0.9, p.stepP + 0.1); }
  if (has('律动', '放克', '摇摆', 'funk', 'groove', 'swing', 'bounce')) p.synco = 0.85;
  if (has('重复', '执拗', '顽固', 'loop', 'repeat', 'insist', 'ostinato', 'riff')) p.rep = 0.85;
  if (has('自由', '多变', '漫游', ' wandering', 'varied', 'wander', 'explore')) p.rep = 0.15;
  if (has('宽广', '宽', 'wide', 'broad')) { p.regLo -= 4; p.regHi += 4; p.maxLeap = Math.max(p.maxLeap, 9); }
  if (has('窄', '集中', 'narrow', 'tight')) { p.regLo += 3; p.regHi -= 3; p.maxLeap = Math.min(p.maxLeap, 5); }
  /* 风格校准 */
  if (state.styles.includes('rock')) { p.stepP = Math.min(p.stepP, 0.6); }
  if (state.styles.includes('jazz') && p.density === 0.5) p.density = 0.4;
  if (state.styles.includes('afro') && p.rep === 0.5) p.rep = 0.65;
  return p;
}
function motiveSeed() {
  return hashStr(state.motiveText + '|' + state.seedSalt + '|' + state.styles.join(',') + '|' + state.keyRoot + state.mode);
}

/* ================= 旋律生成 ================= */
function midiPool(pcs, lo, hi) {
  const out = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(m % 12)) out.push(m);
  return out;
}

function genMelody() {
  const params = parseMotiveText(state.motiveText);
  const rng = mulberry32(motiveSeed());
  curSeed = motiveSeed();
  const bars = state.slots.length;
  const events = [];
  const styleKeys = state.styles;
  let prev = null;
  const rhythmBank = [];

  const firstChord = chordTimeline[0];
  const startPool = midiPool(firstChord.pcs, params.regLo, params.regHi);
  const regCenter = (params.regLo + params.regHi) / 2;
  prev = startPool.length
    ? startPool.reduce((a, b) => Math.abs(b - regCenter + (rng() - 0.5) * 10) < Math.abs(a - regCenter) ? b : a)
    : 64;
  let lastDiff = 0;

  for (let bar = 0; bar < bars; bar++) {
    const chord = chordTimeline[bar];
    const styleKey = styleKeys.length > 1 ? styleKeys[bar % styleKeys.length] : styleKeys[0];
    let pattern = pick(rng, STYLES[styleKey].rhythm).map(x => x.slice());

    /* 重复参数：奇数小节复用前一节奏型 */
    if (bar > 0 && bar % 2 === 1 && rng() < params.rep && rhythmBank[bar - 1]) {
      pattern = rhythmBank[bar - 1].map(x => x.slice());
      if (rng() < 0.3) pattern = pattern.filter((_, i) => i !== Math.floor(rng() * pattern.length));
    }
    rhythmBank[bar] = pattern;

    /* 密度过滤 */
    const minOn = params.density > 0.7 ? 4 : params.density > 0.4 ? 3 : 2;
    pattern = pattern.filter(() => rng() < params.density * 0.9 + 0.12);
    if (pattern.length < minOn) pattern = rhythmBank[bar].slice(0, minOn);

    const chordPool = midiPool(chord.pcs, params.regLo, params.regHi);
    const scalePool = midiPool(chord.scalePCs, params.regLo, params.regHi);
    const bluePCs = [0, 3, 5, 6, 7, 10].map(iv => (chord.rootPC + iv) % 12);
    const isCadence = (bar % 4 === 3) || bar === bars - 1;

    let lastSame = 0;
    pattern.forEach(([on16, len16], idx) => {
      const strong = on16 % 4 === 0;
      const lastOfBar = idx === pattern.length - 1;
      let pool = strong ? chordPool : (rng() < 0.45 ? scalePool : chordPool);
      if (!pool.length) pool = scalePool;

      /* 乐句走势目标音高（随小节推进漂移） */
      const progress = (bar * 4 + on16 / 4) / (bars * 4);
      const span = (params.regHi - params.regLo) * 0.38;
      let target = regCenter;
      if (params.dir === 'up') target = regCenter - span / 2 + progress * span * 2;
      else if (params.dir === 'down') target = regCenter + span / 2 - progress * span * 2;
      else if (params.dir === 'wave') target = regCenter + Math.sin(progress * Math.PI * 2) * span;
      else if (params.dir === 'orbit') target = prev;

      /* 候选打分 */
      let best = null, bestScore = -1e9;
      const tries = Math.min(pool.length, 16);
      for (let k = 0; k < tries; k++) {
        const cand = pool[Math.floor(rng() * pool.length)];
        const diff = cand - prev;
        const ad = Math.abs(diff);
        if (ad > params.maxLeap + (strong ? 2 : 0)) continue;
        /* 级进便宜、大跳昂贵 */
        let s = -(ad <= 2 ? ad * 0.5 : ad * (params.stepP > 0.7 ? 2.0 : 1.1)) + rng() * 3;
        /* 朝走势目标漂移 */
        s += clamp((cand - target) * 0.12, -3, 3);
        if (params.dir === 'up' && diff > 0) s += 2.5;
        if (params.dir === 'down' && diff < 0) s += 2.5;
        if (params.dir === 'orbit') s += (ad <= 5 && ad >= 2 ? 2 : -1);
        /* 惯性：延续上一次方向 */
        if (lastDiff !== 0 && Math.sign(diff) === Math.sign(lastDiff) && ad <= 4) s += 1.4;
        if (params.blue && bluePCs.includes(cand % 12)) s += 2.2;
        if (cand === prev) s -= 4 + lastSame * 5;
        if (strong && chord.pcs.includes(cand % 12)) s += 3;
        if (isCadence && lastOfBar && (cand % 12) === chord.rootPC) s += 5;
        if (s > bestScore) { bestScore = s; best = cand; }
      }
      if (best === null) best = pool[Math.floor(rng() * pool.length)] || prev + 2;
      lastSame = best === prev ? lastSame + 1 : 0;
      lastDiff = best - prev;

      let dur16 = len16;
      if (lastOfBar && isCadence) dur16 = Math.max(dur16, 6);
      if (params.durBias > 0.6) dur16 = Math.min(16 - on16, Math.max(dur16, 4));
      if (params.durBias < 0.3) dur16 = Math.min(dur16, 2);
      dur16 = clamp(dur16, 1, 16 - on16);

      const vel = (strong ? 0.82 : 0.62) + rng() * 0.14;
      events.push({ beat: bar * 4 + on16 / 4, midi: best, dur: dur16 / 4, vel });
      prev = best;
    });
  }
  /* 终止：尾音落回最后和弦的根/三/五音 */
  if (events.length) {
    const lastChord = chordTimeline[bars - 1];
    const final = events[events.length - 1];
    const options = lastChord.pcs.filter(pc => [0, 4, 7].some(iv => (lastChord.rootPC + iv) % 12 === pc));
    const targetPCs = options.length ? options : lastChord.pcs;
    let best = final.midi, bd = 99;
    for (let m = final.midi - 6; m <= final.midi + 6; m++) {
      if (targetPCs.includes(m % 12) && Math.abs(m - final.midi) < bd) { bd = Math.abs(m - final.midi); best = m; }
    }
    final.midi = best;
  }
  melodyEvents = events;
  state._params = params;
}

/* ================= 贝斯生成 ================= */
function genBass() {
  const rng = mulberry32(curSeed ^ 0xBEEF);
  const bars = state.slots.length;
  const ev = [];
  const styleKeys = state.styles;
  for (let bar = 0; bar < bars; bar++) {
    const chord = chordTimeline[bar];
    const nextChord = chordTimeline[(bar + 1) % bars];
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
    } else { /* afro */
      for (let i = 0; i < 8; i++) {
        const n = (i === 3 || i === 6) ? oct : r;
        push(i * 0.5, n, 0.42, i % 2 === 0 ? 0.82 : 0.6);
      }
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
  if (!prevNotes) return candidates[Math.floor(candidates.length / 2)] || candidates[0];
  let best = candidates[0], bd = 1e9;
  for (const c of candidates) {
    const d = c.reduce((s, n, i) => s + Math.abs(n - (prevNotes[i] !== undefined ? prevNotes[i] : n)), 0);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function genKeys() {
  const rng = mulberry32(curSeed ^ 0xF00D);
  const bars = state.slots.length;
  const ev = [];
  const styleKeys = state.styles;
  let prevVoicing = null;
  const COMP_PATTERNS = [
    [[1, 2], [3, 2]], [[2, 2], [3.5, 1.5]], [[1.5, 2], [3, 2]],
    [[2, 4], [3.5, 1]], [[0.5, 2], [2.5, 2]], [[1, 1.5], [2.5, 2], [3.5, 1]],
  ];
  const BOSSA_KEYS = [[0, 2], [1.5, 2], [2.5, 2], [3, 2], [3.75, 1]];
  for (let bar = 0; bar < bars; bar++) {
    const chord = chordTimeline[bar];
    let voicing = chooseVoicing(chord.pcs, prevVoicing);
    prevVoicing = voicing;
    let patch = state.layers.keys.patch;
    const styleKey = styleKeys.length > 1 ? styleKeys[bar % styleKeys.length] : styleKeys[0];
    if (patch === 'bossa' || (patch === 'comp' && styleKey === 'bossa' && rng() < 0.5)) {
      for (const [b, d] of BOSSA_KEYS) ev.push({ beat: bar * 4 + b, notes: voicing, dur: Math.min(d, 4 - b), vel: 0.55 + rng() * 0.1 });
    } else if (patch === 'pad') {
      ev.push({ beat: bar * 4, notes: voicing, dur: 3.8, vel: 0.42 });
    } else {
      for (const [b, d] of pick(rng, COMP_PATTERNS)) ev.push({ beat: bar * 4 + b, notes: voicing, dur: Math.min(d, 4 - b), vel: 0.5 + rng() * 0.15 });
    }
  }
  keysEvents = ev;
}

/* ================= 鼓生成 ================= */
function genDrums() {
  const rng = mulberry32((curSeed ^ 0xD00D) >>> 0);
  const bars = state.slots.length;
  const ev = [];
  const styleKeys = state.styles;
  for (let bar = 0; bar < bars; bar++) {
    const styleKey = styleKeys.length > 1 ? styleKeys[bar % styleKeys.length] : styleKeys[0];
    let patName = state.layers.drums.patch;
    if (patName === 'auto') patName = STYLES[styleKey].drums;
    const P = DRUM_PATTERNS[patName] || DRUM_PATTERNS.rnb;
    const density = state.layers.drums.patch;
    for (let s = 0; s < 16; s++) {
      const push = (inst, vel) => ev.push({ step16: bar * 16 + s, inst, vel });
      if (P.kick && P.kick[s]) push('kick', 1);
      if (P.snare && P.snare[s]) push('snare', patName === 'jazz' || patName === 'bossa' ? 0.55 : 0.9);
      if (P.ghost && P.ghost[s] && rng() < 0.5) push('snare', 0.3);
      if (P.hat && P.hat[s]) {
        if (density === 'lite' && s % 4 !== 0) continue;
        if (density === 'drive' && rng() < 0.3) { push('hat', 0.5); continue; }
        push('hat', s % 4 === 0 ? 0.75 : 0.45);
      }
      if (P.ohat && P.ohat[s] && density !== 'lite') push('ohat', 0.6);
      if (P.ride && P.ride[s]) push('ride', s % 4 === 0 ? 0.8 : 0.5);
      if (P.crash && P.crash[s] && bar % 4 === 0) push('crash', 0.7);
      if (P.congaH && P.congaH[s]) push('congaH', 0.6);
      if (P.congaL && P.congaL[s]) push('congaL', 0.55);
    }
    /* 结尾加花 */
    if (bar === bars - 1) {
      for (let s = 12; s < 16; s++) ev.push({ step16: bar * 16 + s, inst: s % 2 ? 'snare' : 'hat', vel: 0.5 + (s - 12) * 0.12 });
    }
  }
  drumEvents = ev;
}

/* ============================================================
 * 音频引擎（Tone.js）
 * ============================================================ */
const AE = { ready: false, nodes: {} };

function buildAudio() {
  if (AE.ready) return;
  AE.master = new Tone.Volume(-2).connect(new Tone.Limiter(-1).toDestination());

  /* --- 旋律吉他：锯齿波 + 失真 + 反馈延迟 --- */
  AE.guitarVol = new Tone.Volume(-3).connect(AE.master);
  AE.guitarBus = new Tone.Distortion(0.25).connect(AE.guitarVol);
  AE.guitarDelay = new Tone.FeedbackDelay('8n.', 0.28).connect(AE.guitarBus);
  AE.guitar = new Tone.Synth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.012, decay: 0.18, sustain: 0.45, release: 0.3 },
    portamento: 0.045,
  }).connect(AE.guitarBus);
  AE.guitar.connect(AE.guitarDelay);

  /* --- 电钢琴：三角波 Poly + 合唱 + 混响 --- */
  AE.keysVol = new Tone.Volume(-6).connect(AE.master);
  const keysFx = new Tone.Reverb({ decay: 2.2, wet: 0.3 }).connect(AE.keysVol);
  const keysChorus = new Tone.Chorus(4, 2.5, 0.4).connect(keysFx);
  AE.keys = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.01, decay: 0.35, sustain: 0.25, release: 1.1 },
  }).connect(keysChorus);
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
  AE.drumsVol = new Tone.Volume(-6).connect(AE.master);
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
  AE.hat.volume.value = -14;
  AE.ride = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.35, release: 0.05 },
    harmonicity: 5.1, modulationIndex: 18, resonance: 3200, octaves: 1,
  }).connect(AE.drumsVol);
  AE.ride.volume.value = -16;
  AE.conga = new Tone.MembraneSynth({
    pitchDecay: 0.02, octaves: 3,
    envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
  }).connect(AE.drumsVol);
  AE.crash = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.8, release: 0.1 },
    harmonicity: 5.1, modulationIndex: 30, resonance: 4000, octaves: 1.5,
  }).connect(AE.drumsVol);
  AE.crash.volume.value = -16;

  AE.ready = true;
  applyMix();
}

function applyGuitarPatch() {
  if (!AE.ready) return;
  const p = state.layers.guitar.patch;
  if (p === 'dist') {
    AE.guitar.oscillator.type = 'sawtooth';
    AE.guitarDistortion && AE.guitarDistortion.dispose();
    AE.guitarBus.distortion = 0.5; AE.guitarBus.oversample = '2x';
    AE.guitarDelay.wet.value = 0.12;
  } else if (p === 'delay') {
    AE.guitar.oscillator.type = 'triangle';
    AE.guitarBus.distortion = 0.12;
    AE.guitarDelay.wet.value = 0.5; AE.guitarDelay.feedback.value = 0.45;
  } else { /* crunch */
    AE.guitar.oscillator.type = 'sawtooth';
    AE.guitarBus.distortion = 0.25; AE.guitarBus.oversample = '2x';
    AE.guitarDelay.wet.value = 0.2; AE.guitarDelay.feedback.value = 0.28;
  }
}

function applyMix() {
  if (!AE.ready) return;
  AE.master.volume.value = Tone.gainToDb(state.master * state.master);
  AE.guitarVol.mute = !state.layers.guitar.on;
  AE.keysVol.mute = !state.layers.keys.on;
  AE.bassVol.mute = !state.layers.bass.on;
  AE.drumsVol.mute = !state.layers.drums.on;
  AE.guitarVol.volume.value = Tone.gainToDb(state.layers.guitar.vol * state.layers.guitar.vol) - 3;
  AE.keysVol.volume.value = Tone.gainToDb(state.layers.keys.vol * state.layers.keys.vol) - 6;
  AE.bassVol.volume.value = Tone.gainToDb(state.layers.bass.vol * state.layers.bass.vol) - 4;
  AE.drumsVol.volume.value = Tone.gainToDb(state.layers.drums.vol * state.layers.drums.vol) - 6;
  applyGuitarPatch();
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

  /* 吉他旋律 */
  if (state.layers.guitar.on) {
    for (const e of melodyEvents) {
      const t = t16(Math.round(e.beat * 4));
      const dur = Math.max(1, Math.round(e.dur * 4)) * secPer16() * 0.92;
      Tone.Transport.schedule(tt => AE.guitar.triggerAttackRelease(midiName(e.midi), dur, tt, e.vel), t);
    }
  }
  /* 电钢琴 */
  if (state.layers.keys.on) {
    for (const e of keysEvents) {
      const t = t16(Math.round(e.beat * 4));
      const dur = Math.max(1, Math.round(e.dur * 4)) * secPer16() * 0.9;
      const names = e.notes.map(midiName);
      Tone.Transport.schedule(tt => AE.keys.triggerAttackRelease(names, dur, tt, e.vel), t);
    }
  }
  /* 贝斯 */
  if (state.layers.bass.on) {
    for (const e of bassEvents) {
      const t = t16(Math.round(e.beat * 4));
      const dur = Math.max(1, Math.round(e.dur * 4)) * secPer16() * 0.9;
      Tone.Transport.schedule(tt => AE.bass.triggerAttackRelease(midiName(e.midi), dur, tt, e.vel), t);
    }
  }
  /* 鼓 */
  if (state.layers.drums.on) {
    for (const e of drumEvents) {
      const t = t16(e.step16);
      Tone.Transport.schedule(tt => {
        switch (e.inst) {
          case 'kick': AE.kick.triggerAttackRelease('C1', '8n', tt, e.vel); break;
          case 'snare': AE.snare.triggerAttackRelease('16n', tt, e.vel); AE.snareBody.triggerAttackRelease('G2', '16n', tt, e.vel * 0.5); break;
          case 'hat': AE.hat.triggerAttackRelease('G6', '32n', tt, e.vel); break;
          case 'ohat': AE.ride.triggerAttackRelease('G5', '8n', tt, e.vel); break;
          case 'ride': AE.ride.triggerAttackRelease('A5', '8n', tt, e.vel); break;
          case 'congaH': AE.conga.triggerAttackRelease('A3', '16n', tt, e.vel); break;
          case 'congaL': AE.conga.triggerAttackRelease('F3', '16n', tt, e.vel); break;
          case 'crash': AE.crash.triggerAttackRelease('B5', '1m', tt, e.vel); break;
        }
      }, t);
    }
  }
  Tone.Transport.setLoopPoints(0, `${bars}:0:0`);
  Tone.Transport.loop = true;
}

async function togglePlay() {
  if (!state.audioReady) { buildAudio(); state.audioReady = true; }
  await Tone.start();
  applyMix();
  if (state.playing) {
    Tone.Transport.stop();
    state.playing = false;
  } else {
    scheduleAll();
    Tone.Transport.start();
    state.playing = true;
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

/* ---------- 试听单和弦 ---------- */
async function auditionChord(i) {
  if (!state.audioReady) { buildAudio(); state.audioReady = true; }
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
  const PPQ = 96, tpb = PPQ / 4; // 每拍 ticks
  const ev = [];                 // {tick, order, bytes}
  const meta = (tick, type, data) => ev.push({ tick, order: 0, bytes: [0xFF, type, data.length, ...data] });
  const totalTicks = state.slots.length * 4 * tpb;
  const noteOn = (tick, ch, note, vel) => ev.push({ tick, order: 2, bytes: [0x90 | ch, note, vel] });
  const noteOff = (tick, ch, note) => ev.push({ tick, order: 1, bytes: [0x80 | ch, note, 0] });
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
    const t = Math.round(e.beat * tpb);
    const dur = Math.round(e.dur * tpb);
    notePair(t, dur, 0, e.midi, clamp(Math.round(e.vel * 127), 25, 127));
  }
  for (const e of keysEvents) {
    const t = Math.round(e.beat * tpb);
    const dur = Math.round(e.dur * tpb);
    for (const n of e.notes) notePair(t, dur, 1, n, clamp(Math.round(e.vel * 127), 20, 110));
  }
  for (const e of bassEvents) {
    const t = Math.round(e.beat * tpb);
    const dur = Math.round(e.dur * tpb);
    notePair(t, dur, 2, e.midi, clamp(Math.round(e.vel * 127), 25, 120));
  }
  const DRUM_GM = { kick: 36, snare: 38, hat: 42, ohat: 46, ride: 51, congaH: 63, congaL: 64, crash: 49 };
  for (const e of drumEvents) {
    const t = Math.round(e.step16 * tpb / 4);
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

/* ---------- 钢琴卷帘 ---------- */
function renderRoll() {
  const cv = $('#roll');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = 230;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const bars = state.slots.length;
  const labelW = 54, topPad = 22, botPad = 20;
  const plotW = W - labelW - 6, plotH = H - topPad - botPad;
  const total16 = bars * 16;
  const cellW = plotW / total16;

  let lo = 127, hi = 0;
  for (const e of melodyEvents) { lo = Math.min(lo, e.midi); hi = Math.max(hi, e.midi); }
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
    ctx.fillText(`${b + 1}`, x + 3, 14);
    const chord = chordTimeline[b];
    ctx.fillStyle = 'rgba(194,69,45,.9)';
    ctx.fillText(chord.name, x + 12, 14);
  }
  /* 旋律音符（朱红笔触） */
  const rr = ctx.roundRect ? (x, y, w, h, r) => ctx.roundRect(x, y, w, h, r)
    : (x, y, w, h) => ctx.rect(x, y, w, h);
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
  }
  /* 尾标注 */
  if (melodyEvents.length) {
    ctx.fillStyle = 'rgba(36,39,42,.45)';
    ctx.font = '10px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(`${midiName(Math.min(...melodyEvents.map(e => e.midi)))} ~ ${midiName(Math.max(...melodyEvents.map(e => e.midi)))}`, 6, H - 6);
  }
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
  genMelody();
  genBass();
  genKeys();
  genDrums();
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
    reScheduleIfPlaying();
  };
  $('#ctl-swing').oninput = e => {
    state.swing = +e.target.value / 100;
    $('#swing-val').textContent = e.target.value;
    reScheduleIfPlaying();
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
      chip.classList.toggle('active');
      $('#fusion-hint').textContent = state.styles.length > 1
        ? `已选：${state.styles.map(k => STYLES[k].name).join(' + ')} · 节奏/音阶/律动将按小节交替融合`
        : `已选：${STYLES[state.styles[0]].name} · 可多选实现风格融合`;
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
    row.querySelector('.patch').onchange = e => { state.layers[layer].patch = e.target.value; applyGuitarPatch(); regenerate('patch'); };
    row.querySelector('.vol').oninput = e => { state.layers[layer].vol = e.target.value / 100; applyMix(); };
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

  window.addEventListener('resize', renderRoll);
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !/textarea|input|select/i.test(document.activeElement.tagName)) {
      e.preventDefault(); togglePlay();
    }
  });
}

/* ---------- 启动 ---------- */
function init() {
  populateStatic();
  bindEvents();
  loadPreset(state.presetId);
}
document.addEventListener('DOMContentLoaded', init);
