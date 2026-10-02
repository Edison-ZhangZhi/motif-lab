/* ============================================================
 * theory.js — 乐理数据内核
 * 音符 / 音阶 / 和弦库（七·九·十一·十三·属变化和弦）/ 风格数据 / 经典走向
 * ============================================================ */
'use strict';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const pcName = pc => NOTES[((pc % 12) + 12) % 12];
const pcNameFlat = pc => FLAT_NOTES[((pc % 12) + 12) % 12];
const midiName = m => pcName(m) + (Math.floor(m / 12) - 1);
const midiNameFlat = m => pcNameFlat(m) + (Math.floor(m / 12) - 1);

/* ---------- 调式：音程结构 + 每级默认和弦 ---------- */
const MODES = {
  major:      { name: '自然大调',   offsets: [0, 2, 4, 5, 7, 9, 11],
                degQ: ['maj', 'min', 'min', 'maj', '7', 'min', 'm7b5'] },
  minor:      { name: '自然小调',   offsets: [0, 2, 3, 5, 7, 8, 10],
                degQ: ['min', 'm7b5', 'maj', 'min', '7', 'maj', '7'] },
  dorian:     { name: '多利亚',     offsets: [0, 2, 3, 5, 7, 9, 10],
                degQ: ['min', 'min', 'maj', '7', 'min', 'm7b5', 'maj'] },
  mixolydian: { name: '混合利底亚', offsets: [0, 2, 4, 5, 7, 9, 10],
                degQ: ['7', 'min', 'm7b5', 'maj', 'min', 'min', 'maj'] },
  lydian:     { name: '利底亚',     offsets: [0, 2, 4, 6, 7, 9, 11],
                degQ: ['maj', '7', 'min', 'm7b5', 'maj', 'min', 'min'] },
};

/* ---------- 和弦库：qualityKey -> { 显示名, 音程, 组, 延伸音标记 } ---------- */
const CHORDS = {
  /* 大和弦系 */
  maj:     { label: '大三',        sym: '',       iv: [0, 4, 7],             grp: 'maj'  },
  add9:    { label: '大 add9',     sym: 'add9',   iv: [0, 4, 7, 14],         grp: 'maj'  },
  '6':     { label: '大六',        sym: '6',      iv: [0, 4, 7, 9],          grp: 'maj'  },
  '69':    { label: '六九',        sym: '6/9',    iv: [0, 4, 7, 9, 14],      grp: 'maj'  },
  maj7:    { label: '大七',        sym: 'maj7',   iv: [0, 4, 7, 11],         grp: 'maj'  },
  maj9:    { label: '大九',        sym: 'maj9',   iv: [0, 4, 7, 11, 14],     grp: 'maj'  },
  maj13:   { label: '大十三',      sym: 'maj13',  iv: [0, 4, 7, 11, 14, 21], grp: 'maj'  },
  'maj7#11': { label: '大七升十一', sym: 'maj7(#11)', iv: [0, 4, 7, 11, 18],  grp: 'maj'  },
  sus2:    { label: '挂二',        sym: 'sus2',   iv: [0, 2, 7],             grp: 'sus'  },
  sus4:    { label: '挂四',        sym: 'sus4',   iv: [0, 5, 7],             grp: 'sus'  },
  /* 小和弦系 */
  min:     { label: '小三',        sym: 'm',      iv: [0, 3, 7],             grp: 'min'  },
  minAdd9: { label: '小 add9',     sym: 'm(add9)', iv: [0, 3, 7, 14],        grp: 'min'  },
  min6:    { label: '小六',        sym: 'm6',     iv: [0, 3, 7, 9],          grp: 'min'  },
  min69:   { label: '小六九',      sym: 'm6/9',   iv: [0, 3, 7, 9, 14],      grp: 'min'  },
  min7:    { label: '小七',        sym: 'm7',     iv: [0, 3, 7, 10],         grp: 'min'  },
  min9:    { label: '小九',        sym: 'm9',     iv: [0, 3, 7, 10, 14],     grp: 'min'  },
  min11:   { label: '小十一',      sym: 'm11',    iv: [0, 3, 7, 10, 14, 17], grp: 'min'  },
  min13:   { label: '小十三',      sym: 'm13',    iv: [0, 3, 7, 10, 14, 21], grp: 'min'  },
  minMaj7: { label: '小大七',      sym: 'm(maj7)', iv: [0, 3, 7, 11],        grp: 'min'  },
  /* 属和弦系 */
  '7':     { label: '属七',        sym: '7',      iv: [0, 4, 7, 10],         grp: 'dom'  },
  '9':     { label: '属九',        sym: '9',      iv: [0, 4, 7, 10, 14],     grp: 'dom'  },
  '13':    { label: '属十三',      sym: '13',     iv: [0, 4, 7, 10, 14, 21], grp: 'dom'  },
  '7sus4': { label: '属七挂四',    sym: '7sus4',  iv: [0, 5, 7, 10],         grp: 'dom'  },
  '9sus4': { label: '属九挂四',    sym: '9sus4',  iv: [0, 5, 7, 10, 14],     grp: 'dom'  },
  '13sus4': { label: '属十三挂四', sym: '13sus4', iv: [0, 5, 7, 10, 14, 21], grp: 'dom'  },
  '7b5':   { label: '属七降五',    sym: '7(b5)',  iv: [0, 4, 6, 10],         grp: 'dom'  },
  '7#5':   { label: '属七升五',    sym: '7(#5)',  iv: [0, 4, 8, 10],         grp: 'dom'  },
  '7b9':   { label: '属七降九',    sym: '7(b9)',  iv: [0, 4, 7, 10, 13],     grp: 'dom'  },
  '7#9':   { label: '属七升九',    sym: '7(#9)',  iv: [0, 4, 7, 10, 15],     grp: 'dom'  },
  '7#11':  { label: '属七升十一',  sym: '7(#11)', iv: [0, 4, 7, 10, 18],     grp: 'dom'  },
  '7b13':  { label: '属七降十三',  sym: '7(b13)', iv: [0, 4, 7, 10, 20],     grp: 'dom'  },
  '7b9b13': { label: '属七变化',   sym: '7(b9,b13)', iv: [0, 4, 7, 10, 13, 20], grp: 'dom' },
  /* 减 / 半减 */
  dim:     { label: '减三',        sym: 'dim',    iv: [0, 3, 6],             grp: 'dim'  },
  dim7:    { label: '减七',        sym: 'dim7',   iv: [0, 3, 6, 9],          grp: 'dim'  },
  m7b5:    { label: '半减七',      sym: 'm7(b5)', iv: [0, 3, 6, 10],         grp: 'dim'  },
  m9b5:    { label: '半减九',      sym: 'm9(b5)', iv: [0, 3, 6, 10, 13],     grp: 'dim'  },
  /* 增 */
  aug:     { label: '增三',        sym: 'aug',    iv: [0, 4, 8],             grp: 'aug'  },
};

/* 和弦性质下拉分组（供 UI 使用） */
const CHORD_GROUPS = [
  { grp: 'maj',  title: '大和弦系' },
  { grp: 'min',  title: '小和弦系' },
  { grp: 'dom',  title: '属和弦系' },
  { grp: 'dim',  title: '减 / 半减' },
  { grp: 'sus',  title: '挂留' },
  { grp: 'aug',  title: '增和弦' },
];

/* ---------- 音阶（旋律音高池） ---------- */
const SCALES = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  pentMinor:  [0, 3, 5, 7, 10],
  pentMajor:  [0, 2, 4, 7, 9],
  blues:      [0, 3, 5, 6, 7, 10],
};

/* 和弦 → 推荐音阶（和弦音阶理论） */
function scalePCsForChord(rootPC, qKey, keyRootPC, mode) {
  const grp = CHORDS[qKey].grp;
  const keyScale = SCALES[mode].map(iv => (keyRootPC + iv) % 12);
  let base;
  if (grp === 'maj')  base = SCALES.lydian;      // 大和弦 → 利底亚（#11 色彩）
  else if (grp === 'min' && /^(min|minAdd9|min6|min69|min7|min9|min11|min13|minMaj7)$/.test(qKey)) base = SCALES.dorian;
  else if (grp === 'dom') base = SCALES.mixolydian;
  else if (grp === 'dim') base = (qKey === 'dim7') ? [0, 2, 3, 5, 6, 8, 9, 11] : SCALES.locrian || [0, 2, 3, 5, 6, 8, 10];
  else base = SCALES.major; // sus / aug fallback
  let pcs = base.map(iv => (rootPC + iv) % 12);
  // 融合调性音阶，保证不跑偏
  return Array.from(new Set([...pcs, ...keyScale]));
}

/* ---------- 风格数据：节奏型 / 鼓型 / 贝斯型 / 自动延伸音 ---------- */
const STYLES = {
  rnb: {
    name: 'RnB', scaleBias: 'pentMinor',
    mel: { stepP: 0.62, density: 0.38, durBias: 0.65, rep: 0.5, synco: 0.8, blue: false, regLo: 62, regHi: 86, maxLeap: 7 },
    rhythm: [
      [[0, 4], [6, 2], [8, 4], [14, 2]],
      [[0, 2], [3, 2], [8, 4], [11, 2], [14, 2]],
      [[4, 4], [10, 2], [12, 4]],
      [[0, 2], [6, 2], [8, 2], [11, 2], [14, 2]],
    ],
    ext: { maj: ['maj9', 'add9', 'maj13'], min: ['min9', 'min11', 'min13'], dom: ['13', '9', '13sus4'], dim: ['m7b5'], sus: ['9sus4'] },
    bass: 'groove', drums: 'rnb',
  },
  jazz: {
    name: 'Jazz', scaleBias: 'major',
    mel: { stepP: 0.7, density: 0.35, durBias: 0.45, rep: 0.35, synco: 0.6, blue: true, regLo: 62, regHi: 88, maxLeap: 8 },
    rhythm: [
      [[0, 4], [6, 2], [8, 4], [12, 2]],
      [[0, 2], [2, 2], [4, 4], [10, 2], [12, 4]],
      [[0, 4], [4, 4], [10, 2], [14, 2]],
      [[2, 2], [6, 2], [8, 4], [12, 2], [14, 2]],
    ],
    ext: { maj: ['maj9', 'maj13', 'maj7#11'], min: ['min9', 'min11'], dom: ['13', '9', '7b9', '7#9'], dim: ['m7b5', 'm9b5'], sus: ['9sus4'] },
    bass: 'walk', drums: 'jazz',
  },
  rock: {
    name: 'Rock', scaleBias: 'blues',
    mel: { stepP: 0.38, density: 0.5, durBias: 0.35, rep: 0.8, synco: 0.25, blue: true, regLo: 58, regHi: 82, maxLeap: 9 },
    rhythm: [
      [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]],
      [[0, 4], [4, 4], [8, 4], [12, 4]],
      [[0, 2], [2, 2], [4, 2], [7, 2], [8, 2], [10, 2], [12, 2], [14, 2]],
      [[0, 4], [6, 2], [8, 4], [14, 2]],
    ],
    ext: { maj: ['maj', 'add9', '6'], min: ['min', 'min7'], dom: ['7', '9', '7sus4'], dim: ['dim'], sus: ['7sus4'] },
    bass: 'eighth', drums: 'rock',
  },
  bossa: {
    name: 'Bossa Nova', scaleBias: 'major',
    mel: { stepP: 0.82, density: 0.5, durBias: 0.5, rep: 0.4, synco: 0.85, blue: false, regLo: 62, regHi: 86, maxLeap: 6 },
    rhythm: [
      [[0, 2], [3, 2], [6, 2], [8, 2], [11, 2], [14, 2]],
      [[0, 2], [6, 2], [8, 2], [11, 2], [14, 2]],
      [[3, 2], [6, 2], [8, 2], [11, 2], [14, 2]],
      [[0, 4], [11, 2], [14, 2]],
    ],
    ext: { maj: ['maj7', 'maj9'], min: ['min9', 'm9b5'], dom: ['9', '13', '7b9'], dim: ['m7b5'], sus: ['9sus4'] },
    bass: 'bossa', drums: 'bossa',
  },
  afro: {
    name: 'Afro', scaleBias: 'pentMinor',
    mel: { stepP: 0.5, density: 0.65, durBias: 0.25, rep: 0.8, synco: 0.6, blue: false, regLo: 60, regHi: 84, maxLeap: 7 },
    rhythm: [
      [[0, 1], [3, 1], [6, 2], [8, 1], [11, 1], [14, 2]],
      [[0, 2], [3, 1], [6, 1], [8, 2], [11, 1], [14, 1]],
      [[0, 1], [2, 1], [3, 1], [6, 2], [10, 1], [12, 2]],
      [[0, 2], [6, 2], [8, 2], [12, 2]],
    ],
    ext: { maj: ['maj7', '6', '69'], min: ['min7', 'min9'], dom: ['7', '13', '9'], dim: ['m7b5'], sus: ['7sus4'] },
    bass: 'afro', drums: 'afro',
  },
};

/* ---------- 鼓型（16 步进，1 = 击打） ---------- */
const DRUM_PATTERNS = {
  rock: {
    kick:  [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],
    ohat:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
    crash: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  rnb: {
    kick:  [1,0,0,0, 0,0,1,1, 0,0,1,0, 0,1,0,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
    hat:   [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    ohat:  [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
    ghost: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
  },
  jazz: {
    ride:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],
    kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hat:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
  },
  bossa: {
    kick:  [1,0,0,0, 0,0,1,0, 0,1,0,0, 1,0,0,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
  },
  afro: {
    kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    snare: [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,0,1,0],   /* son clave 音型 */
    hat:   [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    congaH:[0,0,0,1, 0,0,1,0, 0,0,0,1, 0,0,1,0],
    congaL:[0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,1],
  },
};

/* ---------- 经典和弦走向预设 ---------- */
/* slot: { d: 级数(1-7), acc: 升降(-1/0/1), q: 固定性质 或 'auto' } */
const PRESETS = [
  { id: 'rnb-1625', name: 'RnB 经典 1-6-2-5', styles: ['rnb', 'jazz'],
    desc: 'Ⅰmaj9–ⅵ11–ⅱ9–Ⅴ13：RnB/爵士最常用的循环，VI 级带来朦胧离调感。',
    slots: [{ d: 1, q: 'maj9' }, { d: 6, q: 'min11' }, { d: 2, q: 'min9' }, { d: 5, q: '13' },
            { d: 1, q: 'maj9' }, { d: 6, q: 'min11' }, { d: 2, q: 'min9' }, { d: 5, q: '9'}] },
  { id: 'jazz-2516', name: '爵士 2-5-1-6（Turnaround）', styles: ['jazz'],
    desc: 'ⅱ9–Ⅴ13–Ⅰ△9–ⅵ7：爵士最核心的 turnaround，五和弦用 13 音延展张力。',
    slots: [{ d: 2, q: 'min9' }, { d: 5, q: '13' }, { d: 1, q: 'maj9' }, { d: 6, q: 'min7' },
            { d: 2, q: 'min9' }, { d: 5, q: '7#9' }, { d: 1, q: 'maj9' }, { d: 6, q: 'min11' }] },
  { id: 'jazz-36251', name: '爵士 3-6-2-5-1', styles: ['jazz', 'rnb'],
    desc: 'ⅲ–ⅵ–ⅱ–Ⅴ–Ⅰ：加长版全音阶下行 turnaround， bebop 标配。',
    slots: [{ d: 3, q: 'min9' }, { d: 6, q: 'min9' }, { d: 2, q: 'min9' }, { d: 5, q: '13' }, { d: 1, q: 'maj9' }] },
  { id: 'jazz-rhythm', name: 'Rhythm Changes A 段', styles: ['jazz', 'bossa'],
    desc: 'Ⅰ–ⅵ–ⅱ–Ⅴ：爵士另一支柱，每和弦一小节。',
    slots: [{ d: 1, q: 'maj7' }, { d: 6, q: 'min7' }, { d: 2, q: 'min7' }, { d: 5, q: '7' },
            { d: 1, q: 'maj7' }, { d: 6, q: 'min7' }, { d: 2, q: 'min7' }, { d: 5, q: '7' }] },
  { id: 'bossa-251', name: 'Bossa 大调 ii-V-I', styles: ['bossa'],
    desc: 'ⅱm9–Ⅴ9–Ⅰ△7–Ⅵ7：巴萨诺瓦和声基础，副属 Ⅵ7 推向下一循环。',
    slots: [{ d: 2, q: 'min9' }, { d: 5, q: '9' }, { d: 1, q: 'maj7' }, { d: 6, q: '7' },
            { d: 2, q: 'min9' }, { d: 5, q: '13' }, { d: 1, q: 'maj9' }, { d: 6, q: '7' }] },
  { id: 'bossa-min', name: 'Bossa 小调 iiø-V-i', styles: ['bossa', 'jazz'],
    desc: 'ⅱø–Ⅴ7(b9)–ⅰm9：小调巴萨，半减和弦 + 降九属，忧郁拉丁味。建议切到自然小调。',
    slots: [{ d: 2, q: 'm7b5' }, { d: 5, q: '7b9' }, { d: 1, q: 'min9' }, { d: 6, q: 'maj7' },
            { d: 2, q: 'm7b5' }, { d: 5, q: '7b9' }, { d: 1, q: 'min9' }, { d: 6, q: 'maj7' }], mode: 'minor' },
  { id: 'blues-12', name: '12 小节布鲁斯', styles: ['rock', 'jazz'],
    desc: '全属七和弦：Ⅰ7–Ⅳ7–Ⅴ7 的 12 小节框架，摇滚/爵士布鲁斯基石。可切混合利底亚。',
    slots: [
      { d: 1, q: '7' }, { d: 1, q: '7' }, { d: 1, q: '7' }, { d: 1, q: '7' },
      { d: 4, q: '7' }, { d: 4, q: '7' }, { d: 1, q: '7' }, { d: 1, q: '7' },
      { d: 5, q: '7' }, { d: 4, q: '7' }, { d: 1, q: '7' }, { d: 5, q: '7' }], mode: 'mixolydian' },
  { id: 'rock-bVII', name: '摇滚 ♭VII 进行', styles: ['rock'],
    desc: 'Ⅰ–♭Ⅶ–Ⅳ：混合利底亚摇滚圣杯进行（如 Sweet Home Alabama）。建议切混合利底亚。',
    slots: [{ d: 1, q: 'maj' }, { d: 7, acc: -1, q: 'maj' }, { d: 4, q: 'maj' },
            { d: 1, q: 'maj' }, { d: 7, acc: -1, q: 'maj' }, { d: 4, q: 'maj' },
            { d: 1, q: 'maj' }, { d: 4, q: 'maj' }], mode: 'mixolydian' },
  { id: 'rock-min', name: '小调硬摇滚 i-♭VI-♭VII', styles: ['rock'],
    desc: 'ⅰm–♭Ⅵ–♭Ⅶ：小调摇滚/金属经典（如 Nirvana、Zombie）。建议切自然小调。',
    slots: [{ d: 1, q: 'min' }, { d: 6, acc: -1, q: 'maj' }, { d: 7, acc: -1, q: 'maj' },
            { d: 1, q: 'min' }, { d: 6, acc: -1, q: 'maj' }, { d: 7, acc: -1, q: 'maj' },
            { d: 6, acc: -1, q: 'maj' }, { d: 7, acc: -1, q: 'maj' }], mode: 'minor' },
  { id: 'afro-min', name: 'Afro 小调 i-♭VII-♭VI-V', styles: ['afro'],
    desc: 'ⅰm7–♭Ⅶ7–♭Ⅵ△7–Ⅴ7：Afrobeat / Afro Fusion 招牌循环，属七回拉主音。建议切多利亚。',
    slots: [{ d: 1, q: 'min7' }, { d: 7, acc: -1, q: '7' }, { d: 6, acc: -1, q: 'maj7' }, { d: 5, q: '7' },
            { d: 1, q: 'min7' }, { d: 7, acc: -1, q: '7' }, { d: 6, acc: -1, q: 'maj7' }, { d: 5, q: '7' }], mode: 'dorian' },
  { id: 'afro-grove', name: 'Afro 五声律动（双小节）', styles: ['afro', 'rnb'],
    desc: 'ⅰm7–Ⅳ7 对答 + ♭Ⅶ–Ⅳ–Ⅰ–Ⅴ 回转，五声音阶旋律的最佳土壤。',
    slots: [{ d: 1, q: 'min7' }, { d: 1, q: 'min7' }, { d: 4, q: '7' }, { d: 1, q: 'min7' },
            { d: 7, acc: -1, q: '7' }, { d: 4, q: '7' }, { d: 1, q: 'min7' }, { d: 5, q: '7' }], mode: 'dorian' },
  { id: 'pop-1564', name: '流行 1-5-6-4', styles: ['rnb', 'rock'],
    desc: 'Ⅰ–Ⅴ–ⅵ–Ⅳ：全球最知名走向，RnB 化可加 9/13 延伸音。',
    slots: [{ d: 1, q: 'add9' }, { d: 5, q: '9' }, { d: 6, q: 'min9' }, { d: 4, q: 'add9' },
            { d: 1, q: 'add9' }, { d: 5, q: '9' }, { d: 6, q: 'min9' }, { d: 4, q: 'maj9' }] },
  { id: 'rnb-mixture', name: 'RnB 调式混合 1-5-4-♭6（Daniel Caesar 式）', styles: ['rnb'],
    desc: 'Ⅰmaj7–ⅴm7–Ⅳmaj7–♭Ⅵmaj7：从同主音小调借和弦，《Best Part》式朦胧色彩。Daniel Caesar / D’Angelo 招牌语法。',
    slots: [{ d: 1, q: 'maj7' }, { d: 5, q: 'min7' }, { d: 4, q: 'maj7' }, { d: 6, acc: -1, q: 'maj7' },
            { d: 1, q: 'maj9' }, { d: 5, q: 'min9' }, { d: 4, q: 'maj9' }, { d: 6, acc: -1, q: 'maj7' }] },
  { id: 'rnb-chroma', name: 'RnB 半音滑接（陶喆式）', styles: ['rnb'],
    desc: 'Ⅰmaj9–♯Ⅰ°7–ⅱm9–Ⅴ13：高半音减七经过和弦，陶喆《十点半的飞机》式滑接语法，方大同《Love Song》同款离调感。',
    slots: [{ d: 1, q: 'maj9' }, { d: 1, acc: 1, q: 'dim7' }, { d: 2, q: 'min9' }, { d: 5, q: '13' },
            { d: 1, q: 'maj9' }, { d: 1, acc: 1, q: 'dim7' }, { d: 2, q: 'min9' }, { d: 5, q: '9' }] },
];

/* ---------- 级数显示 ---------- */
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'];
function romanNumeral(slot, qKey) {
  const accMark = slot.acc < 0 ? '♭' : slot.acc > 0 ? '♯' : '';
  let r = accMark + ROMAN[slot.d - 1];
  const c = CHORDS[qKey];
  const grp = c.grp;
  if (grp === 'min') r = r.toLowerCase();
  if (qKey === 'dim' || qKey === 'dim7') r += '°';
  if (qKey === 'm7b5' || qKey === 'm9b5') r += 'ø';
  if (grp === 'aug') r += '+';
  /* 延伸音上标 */
  const m = qKey.match(/(maj7#11|maj13|maj9|maj7|minAdd9|minMaj7|min69|min13|min11|min9|min7|min6|m9b5|m7b5|13sus4|9sus4|7sus4|add9|69|dim7|13|11|9|7|6)/);
  let ext = '';
  if (m) {
    const token = m[1];
    if (token.startsWith('maj')) ext = '△' + token.slice(3);
    else if (token === 'minMaj7') ext = '△7';
    else if (token === 'minAdd9') ext = 'add9';
    else if (token === 'm7b5') ext = '7';
    else if (token === 'm9b5') ext = '9';
    else if (token.startsWith('min')) ext = token.slice(3);
    else if (token === 'dim7') ext = '7';
    else ext = token;
  }
  return { roman: r, ext };
}

/* 级功能（大调体系） */
const DEG_FUNCTION = {
  major:      { 1: '主功能', 2: '下属功能', 3: '主功能（替代）', 4: '下属功能', 5: '属功能', 6: '主功能（替代）', 7: '属功能' },
  minor:      { 1: '主功能（小）', 2: '下属功能', 3: '主功能', 4: '下属功能', 5: '属功能', 6: '下属功能', 7: '属功能' },
  dorian:     { 1: '主功能（小）', 2: '下属功能', 3: '主功能', 4: '下属功能', 5: '主功能', 6: '下属功能', 7: '主功能' },
  mixolydian: { 1: '主功能', 2: '下属功能', 3: '主功能', 4: '下属功能', 5: '下属功能', 6: '主功能', 7: '下属功能（♭Ⅶ 色彩）' },
  lydian:     { 1: '主功能', 2: '属功能（Ⅱ7）', 3: '主功能', 4: '下属功能（#Ⅳø）', 5: '主功能', 6: '主功能', 7: '主功能' },
};

/* 调内升降级名 → 色块（半音提示） */
function slotRootPC(slot, keyRootPC, mode) {
  const off = MODES[slot.modeOverride || mode].offsets[slot.d - 1] + (slot.acc || 0);
  return (keyRootPC + off) % 12;
}
