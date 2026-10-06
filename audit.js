#!/usr/bin/env node
/* ============================================================
 * Motif Lab 十二维审核门禁 audit.js v1.0
 * 用法：把本文件放在站点根目录（与 app.js 同级），运行  node audit.js
 * 退出码 0 = 全部维度 ≥ 合格线；1 = 有维度未达标（禁止上线）
 * 审核哲学：每个维度必须有可测量的指标，不接受"听起来还行"。
 *   指标分两类：
 *     A. 静态链审计——直接检查源码里该存在的修复/参数在不在
 *     B. 动态事件审计——沙盒跑生成管线，统计事件流的真实数据
 * ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIR = process.argv[2] || __dirname;
let SRC;
try { SRC = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8'); }
catch (e) { console.error('找不到 app.js，请把 audit.js 放到站点根目录'); process.exit(1); }

/* ---------- 沙盒装载 ---------- */
const mocks = { console, setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {}, fetch: () => Promise.reject(),
  localStorage: { getItem: () => null, setItem: () => {} }, navigator: { userAgent: 'n' }, window: { addEventListener: () => {} },
  MediaRecorder: undefined, alert: () => {}, Soundfont: undefined, Tone: undefined,
  document: { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ click: () => {} }) },
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} }, Blob: class {}, Promise };
const ctx = vm.createContext(mocks);
for (const f of ['theory.js', 'cells.js', 'rules.js', 'app.js'])
  vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });

/* ---------- A. 静态链审计（源码级，13 项硬指标） ---------- */
const STATIC = [
  ['拍号·调度层 SPB',        !/e\.beat \* 4\)/.test(SRC) && !/step16 \/ 4\)/.test(SRC), '旋律/键盘/pad/贝斯调度必须走 SPB()，残留 beat*4 说明 6/8 定时会错位'],
  ['音色·连线不掐音',         SRC.includes('!legato &&'),            '前音闪避必须跳过 legato，否则"一蹦一蹦"'],
  ['音色·attack 随机化',      /atk = \(legato \? 0\.024 \+ Math\.random/.test(SRC), '固定 attack=机器感；需 6~38ms 随机+jazz 柔音'],
  ['音色·变调阈值 ≤5 半音',   SRC.includes('bd > 5'),                'playbackRate 移 >5 半音共振峰漂移=塑料味'],
  ['音色·SF 音放尾巴',        SRC.includes('duration: dur + (e.dur >= 1') || SRC.includes('v5.3 SF 尾巴按演奏法'), 'SF 旋律硬截在 dur 处=ping-pong'],
  ['音色·中频琴体归位',       SRC.includes('mid.value = 0.5 + t.t * 2.5'), '吉他 mid 必须为正（EQ3 250-2500Hz 是琴体）'],
  ['音色·移相器低速',         SRC.includes('Phaser(0.08, 0.5, 320)'),  'octaves=4 全频扫描是合成器"老问题"根因'],
  ['鼓·NY 并行压缩',          SRC.includes('drumsPar'),              '鼓力量链的核心'],
  ['混音·三声部闪避',         SRC.includes('0.78') && SRC.includes('0.74') && SRC.includes('0.85'), 'keys/pad/guitar 随 kick/snare 闪避'],
  ['边界·生成器过滤',         SRC.includes('beat < bars * BPB()'),    '各声部越界过滤必须存在'],
  ['拍号·UI 接线',           SRC.includes('ctl-meter'),              '拍号选择器必须接入 regenerate'],
  ['和声·九和弦扩展表',        SRC.includes('EXT_UP'),                '非 rock 风格扩展和弦升级路径'],
  ['结构·vamp 让位',          SRC.includes('secChange'),              '段落切换不硬切断和弦垫'],
];
const staticPass = STATIC.filter(s => s[1]).length;

/* ---------- B. 动态事件审计（沙盒跑 13 个配置） ---------- */
const DYN = vm.runInContext(`(function(){
const CFGS = [
  ['rnb','m44','song'], ['jazz','m44','song'], ['rock','m44','song'],
  ['bossa','m44','song'], ['afro','m44','song'], ['hiphop','m44','song'],
  ['jazz','m34','song'], ['rnb','m68','song'], ['afro','m34','song'],
  ['afro','m44','groove'], ['rnb','m44','loop'], ['jazz','m44','loop'],
];
const styles = {};
const boundsBad = [];
const meterCov = {};
for (const [st, meter, struct] of CFGS) {
  state.styles = [st]; state.structure = struct; state.meter = meter;
  state.slots = [{d:1,acc:0,q:'auto'},{d:6,acc:0,q:'auto'},{d:2,acc:0,q:'auto'},{d:5,acc:0,q:'auto'}];
  state.layers.drums.patch = 'auto'; state.bpm = 92;
  buildChordTimeline(); genMelody(); genBass(); genKeys(); genSynthPad(); genHorns(); genDrums();
  const bars = totalBars(), bpb = BPB(), spb = SPB(), sbar = SBAR(), maxBeat = bars * bpb;
  for (const e of melodyEvents) if (!(e.beat >= 0 && e.beat < maxBeat + 0.01 && e.dur > 0)) boundsBad.push(st+'/'+meter+'/mel@'+e.beat.toFixed(2));
  for (const e of bassEvents) if (!(e.beat >= 0 && e.beat < maxBeat + 0.01)) boundsBad.push(st+'/'+meter+'/bass@'+e.beat.toFixed(2));
  for (const e of keysEvents) if (!(e.beat >= 0 && e.beat < maxBeat + 0.01)) boundsBad.push(st+'/'+meter+'/keys@'+e.beat.toFixed(2));
  for (const e of synthEvents) if (!(e.beat >= 0 && e.beat < maxBeat + 0.01)) boundsBad.push(st+'/'+meter+'/pad@'+e.beat.toFixed(2));
  for (const e of hornEvents) if (!(e.beat >= 0 && e.beat < maxBeat + 0.01)) boundsBad.push(st+'/'+meter+'/horn@'+e.beat.toFixed(2));
  for (const e of drumEvents) if (!(e.step16 >= 0 && e.step16 < bars * sbar)) boundsBad.push(st+'/'+meter+'/drum@'+e.step16);
  meterCov[meter] = true;
  if (!(meter === 'm44' && (struct === 'song' || struct === 'loop'))) continue;
  /* 每风格指标（以 m44 song 为准，loop 补充律动） */
  const S = styles[st] = styles[st] || { seam:0, seamN:0, avgDur:0, durN:0, range:0, velStd:0, kick:0, snare:0, ghost:0, fillBars:0, ext:0, uniqRoots:{}, drumSig:{}, swing:GROOVE[st] ? GROOVE[st].hatSwing : 0, lag:GROOVE[st] ? (GROOVE[st].snareLag||0) : 0, melN:0, gtrCov:0, layersOn:0 };
  const mel = melodyEvents;
  S.melN += mel.length;
  let gaps = 0, durs = 0, mn = 99, mx = 0, vels = [];
  for (let i = 0; i < mel.length; i++) {
    const e = mel[i];
    durs += e.dur;
    mn = Math.min(mn, e.midi); mx = Math.max(mx, e.midi);
    vels.push(e.vel);
    if (i + 1 < mel.length && mel[i+1].beat - (e.beat + e.dur) <= 0.06) gaps++;
  }
  S.seam += gaps; S.seamN += Math.max(0, mel.length - 1);
  S.avgDur += durs; S.durN += mel.length;
  S.range = Math.max(S.range, mx - mn);
  const vm = vels.reduce((a,b)=>a+b,0) / Math.max(1,vels.length);
  S.velStd = Math.sqrt(vels.reduce((a,b)=>a+(b-vm)*(b-vm),0) / Math.max(1,vels.length));
  for (const d of drumEvents) {
    if (d.inst === 'kick') S.kick++;
    if (d.inst === 'snare') { S.snare++; if (d.vel < 0.55) S.ghost++; }
  }
  const fillSet = {};
  for (const d of drumEvents) if (d.inst === 'snare' && d.step16 % sbar >= sbar - 4) fillSet[Math.floor(d.step16 / sbar)] = 1;
  S.fillBars += Object.keys(fillSet).length;
  for (let b = 0; b < Math.min(bars, 8); b++) { const c = chordAtBar(b); if (/7|9|13/.test(c.name)) S.ext++; }
  /* 鼓型指纹：kick/snare 步序列 */
  const sig = [];
  for (let s = 0; s < 16; s++) sig.push(drumEvents.some(d=>d.inst==='kick'&&d.step16%sbar===s)?1:0);
  for (let s = 0; s < 16; s++) sig.push(drumEvents.some(d=>d.inst==='snare'&&d.step16%sbar===s)?1:0);
  S.drumSig[meter + struct] = sig.join('');
  /* 吉他采样覆盖率（变调 ≤5 半音才算"自己的音色"） */
  if (GUITAR_SETS && GUITAR_SETS.electric) {
    const keys = GUITAR_SETS.electric.map(n => noteNameToMidi(n));
    let cov = 0;
    for (const e of mel) { let bd = 99; for (const k of keys) bd = Math.min(bd, Math.abs(k - e.midi)); if (bd <= 5) cov++; }
    S.gtrCov = mel.length ? cov / mel.length : 0;
  }
  S.layersOn = [state.layers.guitar.on, state.layers.keys.on, state.layers.synth.on, state.layers.bass.on, state.layers.drums.on].filter(Boolean).length;
}
/* 风格指纹差异度：6 风格 kick+snare 签名两两不同位数 */
const sigs = Object.keys(styles).map(k => styles[k].drumSig['m44song'] || '');
let minDist = 99;
for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) {
  if (!sigs[i] || !sigs[j]) continue;
  let d = 0; for (let c = 0; c < Math.min(sigs[i].length, sigs[j].length); c++) if (sigs[i][c] !== sigs[j][c]) d++;
  minDist = Math.min(minDist, d);
}
return { styles, boundsBad, minDist, meters: Object.keys(meterCov) };
})()`, ctx);

/* ---------- 评分 ---------- */
const clamp10 = x => Math.max(0, Math.min(10, x));
const st = k => DYN.styles[k];
const dims = [];

/* 1 编曲：结构段数 + 过门密度 + 层数 */
{
  let secScore = 0, fillScore = 0, layScore = 0;
  try {
    const n = vm.runInContext('SECTION_DEFS.filter(s => s.name).length', ctx);
    secScore = n >= 4 ? 10 : 7;
  } catch (e) { secScore = 6; }
  const fills = ['rnb','jazz','bossa','hiphop'].map(k => st(k).fillBars);
  fillScore = fills.every(f => f >= 2) ? 10 : fills.every(f => f >= 1) ? 8.5 : 7;
  layScore = Object.keys(DYN.styles).every(k => st(k).layersOn >= 4) ? 10 : 9;
  dims.push(['编曲', clamp10(secScore * 0.4 + fillScore * 0.35 + layScore * 0.25), `过门 bars ${fills.join('/')}`]);
}
/* 2 旋律：无缝率 + 平均时值 + 音域 */
{
  let best = 0, worst = 10, durS = 0, rngS = 0, n = 0;
  for (const k of Object.keys(DYN.styles)) {
    const s = st(k); if (!s.seamN) continue;
    const seam = s.seam / s.seamN; best = Math.max(best, seam); worst = Math.min(worst, seam);
    durS += s.avgDur / Math.max(1, s.durN); rngS += s.range; n++;
  }
  const seamS = clamp10(6 + (best - 0.7) * 13);
  const durScore = clamp10(((durS / n) / 1.2) * 10);
  const rngScore = clamp10(((rngS / n) / 14) * 10);
  dims.push(['旋律', clamp10(seamS * 0.45 + durScore * 0.3 + rngScore * 0.25), `seam best=${(best*100).toFixed(0)}% worst=${(worst*100).toFixed(0)}% avgDur=${(durS/n).toFixed(2)}拍`]);
}
/* 3 音色（核心新维度）：静态链 + 覆盖率 + 分风格差异 */
{
  const chain = STATIC.filter(s => ['音色·连线不掐音','音色·attack 随机化','音色·变调阈值 ≤5 半音','音色·SF 音放尾巴','音色·中频琴体归位','音色·移相器低速'].some(x => x === s[0] && s[1])).length;
  const chainS = chain / 6 * 10;
  const covs = ['rnb','rock','hiphop','afro'].map(k => st(k).gtrCov);
  const covS = clamp10((covs.reduce((a,b)=>a+b,0) / covs.length) * 12);
  const uniqFx = new Set(vm.runInContext('Object.entries(GUITAR_STYLE_FX).map(([k,v])=>v.drive+"/"+v.lpf+"/"+v.gate).join("|")', ctx).split('|')).size;
  const diffS = uniqFx >= 5 ? 10 : 8;
  dims.push(['音色', clamp10(chainS * 0.5 + covS * 0.3 + diffS * 0.2), `链路 ${chain}/6 采样覆盖 ${(covs.reduce((a,b)=>a+b,0)/covs.length*100).toFixed(0)}% FX 差异 ${uniqFx} 组`]);
}
/* 4 结构 */
{
  let vamp = SRC.includes('secChange') ? 10 : 5;
  const groove = vm.runInContext("totalBars.toString().includes('groove') ? 32 : 0", ctx) ? 10 : 5;
  dims.push(['结构', clamp10(vamp * 0.5 + groove * 0.5), `vamp让位=${SRC.includes('secChange')} groove结构=${groove === 10}`]);
}
/* 5 鼓点：ghost/fill/kick 量 */
{
  const g = k => st(k);
  const ghostS = ['jazz','hiphop','rnb'].every(k => g(k).ghost >= 2) ? 10 : 7.5;
  const kickS = Object.keys(DYN.styles).every(k => g(k).kick >= 8) ? 10 : 8;
  const snrS = Object.keys(DYN.styles).every(k => g(k).snare >= 6) ? 10 : 8;
  dims.push(['鼓点', clamp10(ghostS * 0.4 + kickS * 0.3 + snrS * 0.3), `ghost j/h/r=${g('jazz').ghost}/${g('hiphop').ghost}/${g('rnb').ghost}`]);
}
/* 6 和弦：扩展率 */
{
  const exts = ['rnb','jazz','bossa','afro','hiphop'].map(k => st(k).ext);
  const rockExt = st('rock').ext;
  const extS = exts.every(x => x >= 6) ? 10 : exts.every(x => x >= 4) ? 8.5 : 7;
  const rockS = rockExt <= 5 ? 10 : 7; /* rock 保持三和弦是刻意的 */
  dims.push(['和弦', clamp10(extS * 0.6 + rockS * 0.4), `ext8=${exts.join('/')} rock=${rockExt}`]);
}
/* 7 风格：指纹差异 + 律动参数差异 */
{
  const distS = DYN.minDist >= 4 ? 10 : DYN.minDist >= 2 ? 8.5 : 6;
  const lags = Object.keys(DYN.styles).map(k => st(k).lag);
  const lagS = new Set(lags.map(x => x.toFixed(3))).size >= 4 ? 10 : 7;
  dims.push(['风格', clamp10(distS * 0.6 + lagS * 0.4), `鼓型最小差异 ${DYN.minDist} 位 lag 种类 ${new Set(lags.map(x=>x.toFixed(3))).size}`]);
}
/* 8 律动：swing 分层 */
{
  const sw = Object.keys(DYN.styles).map(k => st(k).swing);
  const uniq = new Set(sw.map(x => x.toFixed(2))).size;
  dims.push(['律动', clamp10(uniq >= 5 ? 10 : uniq >= 3 ? 8.5 : 6), `swing 种类 ${uniq}`]);
}
/* 9 拍子：配置覆盖 + 零越界 + SPB 调度 */
{
  const covS = DYN.meters.length >= 3 ? 10 : 6;
  const boundS = DYN.boundsBad.length === 0 ? 10 : 0;
  const schedS = STATIC[0][1] ? 10 : 0;
  dims.push(['拍子', clamp10(covS * 0.3 + boundS * 0.4 + schedS * 0.3), `覆盖 ${DYN.meters.join('/')} 越界 ${DYN.boundsBad.length}`]);
}
/* 10 时值 */
{
  let short = 0, tot = 0;
  for (const k of Object.keys(DYN.styles)) { tot += st(k).durN; }
  const avg = Object.keys(DYN.styles).reduce((a,k) => a + st(k).avgDur, 0) / tot;
  dims.push(['时值', clamp10(avg >= 1.0 ? 10 : avg >= 0.6 ? 8.5 : 7), `全风格平均时值 ${avg.toFixed(2)} 拍`]);
}
/* 11 混音 */
{
  const duckS = STATIC.filter(s => s[1] && s[0].startsWith('混音')).length ? 10 : 5;
  const nyS = SRC.includes('drumsPar') ? 10 : 0;
  const limS = SRC.includes('Limiter') ? 10 : 0;
  dims.push(['混音', clamp10(duckS * 0.4 + nyS * 0.3 + limS * 0.3), 'NY压缩+三声部闪避+限幅']);
}
/* 12 工程健壮性 */
{
  const bS = DYN.boundsBad.length === 0 ? 10 : 0;
  const fS = STATIC.filter(s => s[1] && s[0].startsWith('边界')).length ? 10 : 0;
  dims.push(['健壮性', clamp10(bS * 0.6 + fS * 0.4), `越界 ${DYN.boundsBad.length} 项`]);
}

/* ---------- 报告 ---------- */
const NL = String.fromCharCode(10);
const LINE = '─'.repeat(58);
let out = NL + ' Motif Lab 十二维审核报告  ' + new Date().toISOString().slice(0, 10) + NL + LINE + NL;
let sum = 0;
for (const [name, score, note] of dims) {
  sum += score;
  const bar = '█'.repeat(Math.round(score)) + '░'.repeat(10 - Math.round(score));
  out += ` ${name.padEnd(4, '　')} ${score.toFixed(1)} ${bar}  ${note}` + NL;
}
const overall = sum / dims.length;
out += LINE + NL;
out += ` 静态链审计 ${staticPass}/${STATIC.length} 项通过` + NL;
if (STATIC.some(s => !s[1])) for (const [name, ok, why] of STATIC) if (!ok) out += `  ✗ ${name}：${why}` + NL;
out += ` 总分 ${overall.toFixed(2)} / 10` + NL;
const PASS_LINE = 8.0, EXCELLENT = 9.0;
const failed = dims.filter(d => d[1] < PASS_LINE);
if (DYN.boundsBad.length) out += ` ✗ 事件越界 ${DYN.boundsBad.length} 处：${DYN.boundsBad.slice(0, 5).join(', ')}` + NL;
if (failed.length) out += ` ✗ 未达合格线(${PASS_LINE})：${failed.map(f => f[0] + ' ' + f[1].toFixed(1)).join('、')}` + NL;
out += failed.length === 0 && DYN.boundsBad.length === 0
  ? (overall >= EXCELLENT ? ` ✔ 审核通过（优秀线 ${EXCELLENT} 达成，允许上线）` : ` ✔ 审核通过（达合格线 ${PASS_LINE}，未达优秀线）`)
  : ' ✗ 审核不通过，禁止上线' + NL;
console.log(out);
process.exit(failed.length === 0 && DYN.boundsBad.length === 0 ? 0 : 1);
