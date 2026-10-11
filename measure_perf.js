#!/usr/bin/env node
/* MotifLab 调度负载静态测量：沙盒跑生成管线，统计每轨事件数与每秒回调密度。
   沙盒机制复用 audit.js（vm + 桩环境）。 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIR = process.argv[2] || __dirname;
const mocks = { console, setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {}, fetch: () => Promise.reject(),
  localStorage: { getItem: () => null, setItem: () => {} }, navigator: { userAgent: 'n' }, window: { addEventListener: () => {} },
  MediaRecorder: undefined, alert: () => {}, Soundfont: undefined, Tone: undefined,
  document: { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ click: () => {} }) },
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} }, Blob: class {}, Promise };
const ctx = vm.createContext(mocks);
for (const f of ['theory.js', 'cells.js', 'specs.js', 'rules.js', 'app.js'])
  vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });

const out = vm.runInContext(`(function(){
const CFGS = [
  ['rnb','m44','song'], ['jazz','m44','song'], ['rock','m44','song'],
  ['bossa','m44','song'], ['afro','m44','song'], ['hiphop','m44','song'],
  ['funk','m44','song'], ['soul','m44','song'], ['reggae','m44','song'], ['afrobeats','m44','song'],
  ['afro','m44','groove'],
];
const rows = [];
for (const [st, meter, struct] of CFGS) {
  state.styles = [st]; state.structure = struct; state.meter = meter;
  state.slots = [{d:1,acc:0,q:'auto'},{d:6,acc:0,q:'auto'},{d:2,acc:0,q:'auto'},{d:5,acc:0,q:'auto'}];
  state.layers.drums.patch = 'auto';
  const cfg = (typeof STYLE_SETUP !== 'undefined' && STYLE_SETUP[st]) || { bpm: 92 };
  state.bpm = cfg.bpm;
  buildChordTimeline(); genMelody(); genBass(); genKeys(); genSynthPad(); genHorns(); genDrums();
  const bars = totalBars();
  const songSec = bars * BPB() * 60 / state.bpm;
  /* keys 事件每事件触发 notes.length 个 SF play；旋律/贝斯 1 个；鼓 1 个（叠层另算） */
  const notesOf = arr => arr.reduce((s, e) => s + (e.notes ? e.notes.length : 1), 0);
  const n = {
    mel: melodyEvents.length, keys: keysEvents.length, keysNotes: notesOf(keysEvents),
    pad: synthEvents.length, padNotes: notesOf(synthEvents), horn: hornEvents.length,
    bass: bassEvents.length, drums: drumEvents.length,
  };
  const events = n.mel + n.keys + n.pad + n.horn + n.bass + n.drums;
  const plays = n.mel + n.keysNotes + n.padNotes + notesOf(hornEvents) + n.bass + n.drums;
  rows.push({ st, struct, bpm: state.bpm, bars, songSec: +songSec.toFixed(1),
    ...n, events, evPerSec: +(events / songSec).toFixed(1), plays, playsPerSec: +(plays / songSec).toFixed(1) });
}
return rows;
})()`, ctx);

console.log('style    struct  bpm  bars  sec    mel  keys(notes)  pad(notes)  horn  bass  drums | evTotal ev/s | plays/s');
let worst = null;
for (const r of out) {
  console.log(
    (r.st + ' '.repeat(9)).slice(0, 9), (r.struct + ' '.repeat(6)).slice(0, 6),
    String(r.bpm).padEnd(4), String(r.bars).padEnd(5), String(r.songSec).padEnd(6),
    String(r.mel).padEnd(5), (r.keys + '(' + r.keysNotes + ')').padEnd(12),
    (r.pad + '(' + r.padNotes + ')').padEnd(11), String(r.horn).padEnd(5),
    String(r.bass).padEnd(5), String(r.drums).padEnd(5), '|',
    String(r.events).padEnd(7), String(r.evPerSec).padEnd(5), '|', r.playsPerSec);
  if (!worst || r.events > worst.events) worst = r;
}
console.log('\n最重配置:', worst.st, worst.struct, worst.events, '个 Transport.schedule 回调，',
  worst.plays, '次发声（', worst.songSec, 's），峰值密度', worst.playsPerSec, 'plays/s');

/* ---------- scheduleAll 主线程耗时：mock Transport 计数 + 计时（cancel+全量重排的真实 JS 成本） ---------- */
vm.runInContext(`
  var _schedCount = 0;
  Tone = {
    Transport: {
      cancel: function() {}, bpm: { value: 120 }, swing: 0, swingSubdivision: '16n',
      schedule: function(fn, t) { _schedCount++; return 0; },
      setLoopPoints: function() {}, loop: true,
    },
    getContext: function() { return { rawContext: {} }; },
    gainToDb: function(g) { return 20 * Math.log10(Math.max(g, 1e-4)); },
  };
`, ctx);
const schedRows = vm.runInContext(`(function(){
  const res = [];
  for (const [st, struct] of [['afro','song'], ['funk','song'], ['rnb','song'], ['afro','groove']]) {
    state.styles = [st]; state.structure = struct; state.meter = 'm44';
    state.slots = [{d:1,acc:0,q:'auto'},{d:6,acc:0,q:'auto'},{d:2,acc:0,q:'auto'},{d:5,acc:0,q:'auto'}];
    state.bpm = (STYLE_SETUP[st] || { bpm: 92 }).bpm;
    buildChordTimeline(); genMelody(); genBass(); genKeys(); genSynthPad(); genHorns(); genDrums();
    /* 预热一次再计时（JIT） */
    scheduleAll();
    const t0 = Date.now(); scheduleAll(); const t1 = Date.now(); scheduleAll(); const t2 = Date.now();
    res.push({ st, struct, ms: [t1 - t0, t2 - t1], count: _schedCount });
  }
  return res;
})()`, ctx);
console.log('\nscheduleAll 主线程耗时（cancel + 全量重排，mock Transport）:');
for (const r of schedRows) console.log('  ', r.st + '/' + r.struct, r.count, '回调，耗时', r.ms.join('ms / ') + 'ms');
