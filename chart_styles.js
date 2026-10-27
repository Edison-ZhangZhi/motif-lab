/* Billboard 2026-10-24 Hot 100 Top 10：公开和声骨架的原创风格规则。
 * progression 仅含级数与和弦性质，不含原曲旋律、歌词、音频或官方 Guitar Pro 谱。
 * sourceUrl 用于核对榜单期次与排名；guitarProNotes 是原创编曲/记谱建议，非官方 GTP。
 * 浏览器：CHART_STYLES、validateChartHarmony；CommonJS：require('./chart_styles.js')。
 */
'use strict';

const CHART_STYLES = [
  {
    id: 'hot100-20261024-01-patient-zero', rank: 1, title: 'Patient Zero', artist: 'Taylor Swift',
    bpm: 92, key: 'G', mode: 'major', style: 'soul',
    progression: [{ d: 4, q: 'maj7' }, { d: 1, q: 'maj7' }, { d: 6, q: 'min7' }, { d: 5, q: '7' }],
    allowedDegrees: ['IV', 'I', 'vi', 'V', 'V7'], tempoRange: [84, 100],
    register: { melody: [60, 81], bass: [36, 55], voicing: [55, 76] },
    bassPolicy: '根音为主，IV-I 可用级进连接；V 到 I 保留导音，不让贝斯持续填满每拍。',
    drumPolicy: '克制的 soul backbeat；主歌轻 ghost，副歌再开放踩镲与加花。',
    density: { intro: 0.3, verse: 0.45, preChorus: 0.58, chorus: 0.72, bridge: 0.42, outro: 0.28 },
    timbre: { keys: '温暖 Rhodes，副歌轻叠加风琴', guitar: '清音分解与短延音双音', pad: '低电平宽 Pad，避免遮盖人声区' },
    guitarProNotes: '原创记谱建议：4/4，每槽一小节；采用公开转录和声骨架，非官方谱、非官方 GTP，不转录原旋律。',
    sourceUrl: 'https://www.billboard.com/charts/hot-100/2026-10-24/',
  },
  {
    id: 'hot100-20261024-02-choosin-texas', rank: 2, title: "Choosin' Texas", artist: 'Ella Langley',
    bpm: 112, key: 'Db', mode: 'major', style: 'rock',
    progression: [{ d: 4, q: 'add9' }, { d: 1, q: 'maj' }, { d: 6, q: 'min7' }, { d: 5, q: '7' }],
    allowedDegrees: ['IV', 'I', 'vi', 'V', 'V7'], tempoRange: [104, 120],
    register: { melody: [58, 79], bass: [35, 52], voicing: [52, 74] },
    bassPolicy: '根音与五音的八分音符骨架；句尾才走向三音或导音，避免 walking bass。',
    drumPolicy: '直八分、清晰 2/4 拍 backbeat；四小节一次短 fill，不使用 swing。',
    density: { intro: 0.38, verse: 0.48, preChorus: 0.62, chorus: 0.82, bridge: 0.5, outro: 0.4 },
    timbre: { guitar: '轻过载双轨节奏吉他，主歌闷音、副歌开放', keys: '少量钢琴或风琴填充', pad: '默认关闭或极低电平' },
    guitarProNotes: '原创记谱建议：Db 大调可标 5 个降号，双吉他不要写成官方分谱；公开转录骨架，非官方 GTP。',
    sourceUrl: 'https://www.billboard.com/charts/hot-100/2026-10-24/',
  },
  {
    id: 'hot100-20261024-03-boston', rank: 3, title: 'Boston', artist: 'STELLA LEFTY',
    bpm: 126, key: 'C', mode: 'major', style: 'rock',
    progression: [{ d: 1, q: 'maj' }, { d: 2, q: 'min7' }, { d: 4, q: 'add9' }, { d: 1, q: 'maj' }],
    allowedDegrees: ['I', 'ii', 'IV', 'V'], tempoRange: [116, 136],
    register: { melody: [60, 84], bass: [36, 55], voicing: [55, 79] },
    bassPolicy: '八分根音推进，ii-IV 可经过三音；换和弦第一拍优先根音。',
    drumPolicy: '明快直拍 rock；verse 闭镲，chorus 开镲/ride，避免每小节密集 fill。',
    density: { intro: 0.42, verse: 0.55, preChorus: 0.68, chorus: 0.88, bridge: 0.52, outro: 0.45 },
    timbre: { guitar: '清音至轻过载的开放和弦，副歌双轨', bass: '圆润电贝斯，少量滑音', drums: '近场鼓、短房间混响' },
    guitarProNotes: '原创记谱建议：I-ii-IV-I 每槽一小节；仅公开转录和声骨架，非官方谱，不含原曲旋律。',
    sourceUrl: 'https://www.billboard.com/charts/hot-100/2026-10-24/',
  },
  {
    id: 'hot100-20261024-04-been-by-now', rank: 4, title: 'Been by Now', artist: 'Morgan Wallen',
    bpm: 120, key: 'Bb', mode: 'major', style: 'rock',
    progression: [{ d: 2, q: 'min7' }, { d: 1, q: 'maj' }, { d: 3, q: 'min7' }, { d: 4, q: 'add9' }, { d: 6, q: 'min7' }],
    allowedDegrees: ['ii', 'I', 'iii', 'IV', 'vi', 'V'], tempoRange: [108, 128],
    register: { melody: [57, 79], bass: [34, 53], voicing: [53, 74] },
    bassPolicy: 'ii-I 以反向级进连接；iii 是经过和声，可省略或用根音短经过，不强调成终止。',
    drumPolicy: '中速直拍 backbeat；五槽循环按五小节理解，不强行填成四小节。',
    density: { intro: 0.35, verse: 0.5, preChorus: 0.64, chorus: 0.8, bridge: 0.46, outro: 0.36 },
    timbre: { guitar: '清音 arpeggio 加轻过载副歌层', keys: '窄音区钢琴加倍，不堆满中频', steel: '可选高音区长音色彩，勿模仿原句' },
    guitarProNotes: '原创记谱建议：iii 为可选经过和弦；公开转录骨架，非官方 GTP，不复制原曲旋律或装饰。',
    sourceUrl: 'https://www.billboard.com/charts/hot-100/2026-10-24/',
  },
  {
    id: 'hot100-20261024-05-dracula', rank: 5, title: 'Dracula', artist: 'Tame Impala & JENNIE',
    bpm: 115, key: 'Eb', mode: 'minor', style: 'rnb',
    progression: [{ d: 1, q: 'min9' }, { d: 2, acc: -1, q: 'maj7' }],
    allowedDegrees: ['i', 'bII', 'V', 'v'], tempoRange: [104, 122],
    register: { melody: [58, 82], bass: [32, 51], voicing: [51, 75] },
    bassPolicy: 'i 与 bII 根音形成半音张力；bII 视作 Neapolitan 色彩，避免额外连续半音低音。',
    drumPolicy: '半速感 backbeat 与稀疏切分；用留白突出双和弦循环，副歌不机械加密。',
    density: { intro: 0.26, verse: 0.4, preChorus: 0.52, chorus: 0.68, bridge: 0.34, outro: 0.25 },
    timbre: { synth: '暗色模拟 Pad 与短脉冲，bII 适度滤波打开', bass: '圆润合成贝斯/电贝斯混合', guitar: '轻 modulation 双音，不写密集独奏' },
    guitarProNotes: '原创记谱建议：bII 标 Neapolitan 大和弦；公开转录骨架，非官方谱/GTP，不含原曲旋律。',
    sourceUrl: 'https://www.billboard.com/charts/hot-100/2026-10-24/',
  },
  {
    id: 'hot100-20261024-06-nicole-kidman', rank: 6, title: 'Nicole Kidman', artist: 'ADÉLA',
    bpm: 141, key: 'G', mode: 'minor', style: 'hiphop',
    progression: [{ d: 4, q: 'min7' }, { d: 5, q: 'min7' }, { d: 1, q: 'min7' }],
    allowedDegrees: ['iv7', 'v7', 'i7', 'iv', 'v', 'i', 'V'], tempoRange: [130, 150],
    register: { melody: [55, 79], bass: [31, 50], voicing: [50, 72] },
    bassPolicy: '自然小调 v7 不强行升成 V7；808 以根音为主，段尾允许短滑音。',
    drumPolicy: '141 BPM 可按半速 backbeat 编配；hat 滚奏只在过渡处，kick 避开连续低频拥挤。',
    density: { intro: 0.25, verse: 0.48, preChorus: 0.6, chorus: 0.78, bridge: 0.32, outro: 0.24 },
    timbre: { synth: '冷色短 pluck 与暗 Pad，三和弦色彩优先', bass: '受控 808，保留起音', drums: '干 clap/snare，亮 hat 但限制高频密度' },
    guitarProNotes: '原创记谱建议：iv7-v7-i7 为自然小调语汇；公开转录骨架，非官方 GTP，不提供原旋律。',
    sourceUrl: 'https://www.billboard.com/charts/hot-100/2026-10-24/',
  },
  {
    id: 'hot100-20261024-07-hate-that-i-made-you-love-me', rank: 7, title: 'hate that i made you love me', artist: 'Ariana Grande',
    bpm: 96, key: 'Bb', mode: 'minor', style: 'rnb',
    progression: [{ d: 1, q: 'min9' }, { d: 5, q: '7' }, { d: 6, acc: -1, q: 'maj7' }, { d: 3, acc: -1, q: 'maj7' }],
    allowedDegrees: ['i', 'V', 'V7', 'bVI', 'bIII', 'v'], tempoRange: [86, 104],
    register: { melody: [58, 84], bass: [34, 53], voicing: [53, 77] },
    bassPolicy: 'V 使用大属和弦时突出导音解决；bVI-bIII 保持平滑低音，不让 808 连续滑满。',
    drumPolicy: '松弛 RnB backbeat，主歌稀疏 ghost；和声换点前减少装饰。',
    density: { intro: 0.24, verse: 0.42, preChorus: 0.56, chorus: 0.74, bridge: 0.38, outro: 0.26 },
    timbre: { keys: 'Rhodes min9/maj7 voicing，三音以上放中区', guitar: '少量清音双音与泛音式点缀', pad: '暗色空气 Pad，bridge 减层' },
    guitarProNotes: '原创记谱建议：V 为和声小调借用，bVI/bIII 是自然小调色彩；公开转录骨架，非官方谱。',
    sourceUrl: 'https://www.billboard.com/charts/hot-100/2026-10-24/',
  },
  {
    id: 'hot100-20261024-08-stupid-song', rank: 8, title: 'stupid song', artist: 'Olivia Rodrigo',
    bpm: 128, key: 'B', mode: 'major', style: 'rock',
    progression: [
      { d: 1, q: 'maj' }, { d: 4, q: 'maj' }, { d: 5, q: 'maj' }, { d: 1, q: 'maj' },
      { d: 6, q: 'min' }, { d: 4, q: 'maj' }, { d: 2, q: 'min' }, { d: 5, q: '7' },
    ],
    allowedDegrees: ['I', 'IV', 'V', 'V7', 'vi', 'ii'], tempoRange: [118, 140],
    register: { melody: [59, 83], bass: [35, 54], voicing: [54, 78] },
    bassPolicy: 'I-IV-V 用根音八分推进；vi-IV-ii-V 保留功能走向，避免多余经过和弦。',
    drumPolicy: '直拍高能 rock，主歌可收为闭镲八分；副歌 crash 只标段落起点。',
    density: { intro: 0.48, verse: 0.58, preChorus: 0.72, chorus: 0.92, bridge: 0.5, outro: 0.55 },
    timbre: { guitar: '开放强力和弦与失真双轨，保持三和弦可辨', bass: ' picks 质感、根音为主', drums: '有力 backbeat、短 room' },
    guitarProNotes: '原创记谱建议：前四槽与后四槽是两个可选和声段，不表示原曲完整结构；公开转录骨架，非官方 GTP。',
    sourceUrl: 'https://www.billboard.com/charts/hot-100/2026-10-24/',
  },
  {
    id: 'hot100-20261024-09-bby-wow', rank: 9, title: 'BbY WOW', artist: 'KAROL G 等',
    bpm: 120, key: 'B', mode: 'minor', style: 'afrobeats',
    progression: [{ d: 4, q: 'min7' }, { d: 1, q: 'min7' }, { d: 3, acc: -1, q: 'maj7' }, { d: 5, q: 'min7' }],
    allowedDegrees: ['iv', 'i', 'III', 'bIII', 'v', 'V'], tempoRange: [108, 124],
    register: { melody: [57, 81], bass: [35, 52], voicing: [52, 74] },
    bassPolicy: 'iv-i-III-v 用短根音与切分休止；自然小调 v 保持小三，不自动改大属。',
    drumPolicy: '120 BPM 采用 syncopated kick、clap 与密 shaker；打击乐层随段落增减而非一直全开。',
    density: { intro: 0.32, verse: 0.52, preChorus: 0.64, chorus: 0.84, bridge: 0.4, outro: 0.35 },
    timbre: { keys: '短 marimba/pluck 琶音，避免长混响', bass: '圆润 sub 与短滑音', percussion: 'shaker、rim、轻 conga 分层' },
    guitarProNotes: '原创记谱建议：III 在此按自然小调三级大和弦；公开转录骨架，非官方谱/GTP，不含原旋律。',
    sourceUrl: 'https://www.billboard.com/charts/hot-100/2026-10-24/',
  },
  {
    id: 'hot100-20261024-10-babydoll', rank: 10, title: 'Babydoll', artist: 'Dominic Fike',
    bpm: 84, key: 'D', mode: 'minor', style: 'rnb',
    progression: [{ d: 1, q: 'min9' }, { d: 5, q: '7' }, { d: 4, q: 'min7' }],
    allowedDegrees: ['i', 'V', 'V7', 'iv', 'v'], tempoRange: [76, 94],
    register: { melody: [57, 81], bass: [38, 55], voicing: [53, 76] },
    bassPolicy: 'V-iv 不是传统终止，保留色彩即可；根音短句与休止优先，避免持续 walking。',
    drumPolicy: '84 BPM 轻 backbeat 和 sparse ghost；chorus 以开镲与和声层增能，不靠堆 fill。',
    density: { intro: 0.24, verse: 0.4, preChorus: 0.5, chorus: 0.66, bridge: 0.34, outro: 0.24 },
    timbre: { guitar: '温暖清音短分解，轻 chorus', keys: '柔 Rhodes 低力度填充', bass: '圆润近场电贝斯，保留滑音但不过量' },
    guitarProNotes: '原创记谱建议：i-V-iv 每槽一小节；公开转录和声骨架，非官方 Guitar Pro 谱，不转录原旋律。',
    sourceUrl: 'https://www.billboard.com/charts/hot-100/2026-10-24/',
  },
];

const CHART_MAJOR_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const CHART_MINOR_OFFSETS = [0, 2, 3, 5, 7, 8, 10];
const CHART_NOTE_PCS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHART_QUALITY_INTERVALS = {
  maj: [0, 4, 7], '': [0, 4, 7], M: [0, 4, 7], add9: [0, 4, 7, 14],
  '6': [0, 4, 7, 9], '69': [0, 4, 7, 9, 14], maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14], maj13: [0, 4, 7, 11, 14, 21],
  min: [0, 3, 7], m: [0, 3, 7], '-': [0, 3, 7], min7: [0, 3, 7, 10], m7: [0, 3, 7, 10],
  min9: [0, 3, 7, 10, 14], m9: [0, 3, 7, 10, 14], min11: [0, 3, 7, 10, 14, 17], m11: [0, 3, 7, 10, 14, 17],
  min6: [0, 3, 7, 9], m6: [0, 3, 7, 9], minMaj7: [0, 3, 7, 11], 'm(maj7)': [0, 3, 7, 11],
  '7': [0, 4, 7, 10], '9': [0, 4, 7, 10, 14], '13': [0, 4, 7, 10, 14, 21],
  sus2: [0, 2, 7], sus4: [0, 5, 7], '7sus4': [0, 5, 7, 10],
  dim: [0, 3, 6], dim7: [0, 3, 6, 9], '°': [0, 3, 6], '°7': [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10], 'm7(b5)': [0, 3, 6, 10], 'ø7': [0, 3, 6, 10], aug: [0, 4, 8], '+': [0, 4, 8],
};
const CHART_ROMAN_DEGREES = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };

function chartPcName(pc, flat) {
  const sharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const flats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  return (flat ? flats : sharp)[((pc % 12) + 12) % 12];
}

function chartParseKey(value) {
  if (Number.isFinite(value)) return ((value % 12) + 12) % 12;
  const match = /^([A-Ga-g])([#♯b♭-])?(?:\s*(?:major|minor|maj|min|大调|小调))?$/.exec(String(value == null ? '' : value).trim());
  if (!match) return null;
  let pc = CHART_NOTE_PCS[match[1].toUpperCase()];
  if (match[2] === '#' || match[2] === '♯') pc++;
  if (match[2] === 'b' || match[2] === '♭' || match[2] === '-') pc--;
  return ((pc % 12) + 12) % 12;
}

function chartNormalizeMode(value) {
  const mode = String(value || 'major').toLowerCase();
  if (['major', 'maj', 'ionian', '大调'].includes(mode)) return 'major';
  if (['minor', 'min', 'aeolian', 'naturalminor', 'natural_minor', '小调'].includes(mode)) return 'minor';
  return null;
}

function chartParseRoman(text, keyPC, mode) {
  const source = String(text).trim().replace(/♭/g, 'b').replace(/♯/g, '#').replace(/−/g, '-');
  const parts = source.split('/');
  const match = /^(b+|#+)?(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(parts[0]);
  if (!match) return null;
  const degree = CHART_ROMAN_DEGREES[match[2].toUpperCase()];
  const accidental = (match[1] || '').split('').reduce((sum, c) => sum + (c === '#' ? 1 : -1), 0);
  const offsets = mode === 'minor' && !accidental ? CHART_MINOR_OFFSETS : CHART_MAJOR_OFFSETS;
  const rootPC = (keyPC + offsets[degree - 1] + accidental + 12) % 12;
  const suffix = match[3] || '';
  let quality;
  if (/^(dim|°)/.test(suffix)) quality = suffix.includes('7') ? 'dim7' : 'dim';
  else if (/^(ø|m7b5|m7\(b5\))/.test(suffix)) quality = 'm7b5';
  else if (match[2] === match[2].toLowerCase()) quality = suffix.includes('9') ? 'min9' : suffix.includes('7') ? 'min7' : 'min';
  else quality = suffix.includes('maj9') ? 'maj9' : suffix.includes('maj7') || suffix.includes('△7') ? 'maj7' : suffix.includes('9') ? '9' : suffix.includes('7') ? '7' : 'maj';
  const romanBase = (accidental < 0 ? 'b'.repeat(-accidental) : '#'.repeat(accidental)) + match[2];
  return { rootPC, quality, degree, accidental, romanBase, slash: parts[1] || '', symbol: source };
}

function chartParseChordSymbol(text, keyPC, mode) {
  const source = String(text).trim().replace(/♭/g, 'b').replace(/♯/g, '#');
  const parts = source.split('/');
  const match = /^([A-Ga-g])(b+|#+)?(.*)$/.exec(parts[0]);
  if (!match) return null;
  let rootPC = CHART_NOTE_PCS[match[1].toUpperCase()];
  for (const c of match[2] || '') rootPC += c === '#' ? 1 : -1;
  rootPC = ((rootPC % 12) + 12) % 12;
  let quality = match[3] || 'maj';
  if (quality === 'm' || quality === 'min' || quality === '-') quality = 'min';
  if (quality === 'M') quality = 'maj';
  if (!CHART_QUALITY_INTERVALS[quality]) return { invalidQuality: quality, rootPC, symbol: source };
  return { rootPC, quality, slash: parts[1] || '', symbol: source, keyPC, mode };
}

function chartParseDegree(value, keyPC, mode) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const degree = Math.trunc(value);
    if (degree < 1 || degree > 7) return null;
    const offsets = mode === 'minor' ? CHART_MINOR_OFFSETS : CHART_MAJOR_OFFSETS;
    return { rootPC: (keyPC + offsets[degree - 1]) % 12, quality: degree === 1 || degree === 4 || degree === 5 ? 'maj' : 'min', degree, accidental: 0, romanBase: String(degree), slash: '' };
  }
  if (value && typeof value === 'object') {
    if (Number.isFinite(value.d)) {
      const degree = Math.trunc(value.d);
      if (degree < 1 || degree > 7) return null;
      const accidental = Number.isFinite(value.acc) ? Math.trunc(value.acc) : 0;
      const quality = value.q && value.q !== 'auto' ? value.q : (mode === 'minor' ? (degree === 1 || degree === 4 || degree === 5 ? 'min' : degree === 2 ? 'dim' : 'maj') : (degree === 1 || degree === 4 || degree === 5 ? 'maj' : degree === 7 ? 'dim' : 'min'));
      if (!CHART_QUALITY_INTERVALS[quality]) return { invalidQuality: quality, degree, accidental, symbol: JSON.stringify(value) };
      const rootPC = (keyPC + CHART_MAJOR_OFFSETS[degree - 1] + accidental + 12) % 12;
      return { rootPC, quality, degree, accidental, romanBase: (accidental < 0 ? 'b'.repeat(-accidental) : '#'.repeat(accidental)) + ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][degree - 1], slash: value.bass || '' };
    }
    if (Number.isFinite(value.rootPC)) {
      const quality = value.qKey || value.quality || 'maj';
      if (!CHART_QUALITY_INTERVALS[quality]) return { invalidQuality: quality, rootPC: value.rootPC, symbol: value.name || JSON.stringify(value) };
      return { rootPC: ((value.rootPC % 12) + 12) % 12, quality, slash: value.bass || '', symbol: value.name || value.roman || 'rootPC' };
    }
    if (value.name || value.symbol || value.roman) return chartParseDegree(value.symbol || value.name || value.roman, keyPC, mode);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  return chartParseRoman(value, keyPC, mode) || chartParseChordSymbol(value, keyPC, mode);
}

function chartChordPCs(chord) {
  return CHART_QUALITY_INTERVALS[chord.quality].map(interval => (chord.rootPC + interval) % 12);
}

function chartQualityGroup(quality) {
  if (/^(dim|m7b5|m7\(b5\)|°|ø)/.test(quality)) return 'dim';
  if (/^(min|m(?!aj)|-)/.test(quality)) return 'minor';
  return 'major';
}

function chartLocateDegree(chord, keyPC, mode) {
  if (chord.degree != null) return;
  for (const accidental of [0, -1, 1, -2, 2]) {
    for (let degree = 1; degree <= 7; degree++) {
      const offsets = mode === 'minor' && !accidental ? CHART_MINOR_OFFSETS : CHART_MAJOR_OFFSETS;
      if ((keyPC + offsets[degree - 1] + accidental + 12) % 12 !== chord.rootPC) continue;
      chord.degree = degree;
      chord.accidental = accidental;
      return;
    }
  }
}

function chartDegreeMatches(chord, allowed, keyPC, mode) {
  const expected = chartParseRoman(allowed, keyPC, mode);
  if (!expected || expected.rootPC !== chord.rootPC) return false;
  return chartQualityGroup(expected.quality) === chartQualityGroup(chord.quality);
}

function chartParseBass(value, chord, keyPC, mode) {
  if (value == null || value === '') return chord.rootPC;
  if (Number.isFinite(value)) {
    const pc = ((value % 12) + 12) % 12;
    if (value >= 1 && value <= 7 && Number.isInteger(value)) return (keyPC + CHART_MAJOR_OFFSETS[value - 1]) % 12;
    return pc;
  }
  if (typeof value === 'string') {
    if (/^[1357]$/.test(value.trim())) {
      const intervals = CHART_QUALITY_INTERVALS[chord.quality];
      const chordToneIndex = { 1: 0, 3: 1, 5: 2, 7: 3 }[value.trim()];
      return intervals[chordToneIndex] == null ? null : (chord.rootPC + intervals[chordToneIndex]) % 12;
    }
    const bassChord = chartParseChordSymbol(value, keyPC, mode);
    if (bassChord && !bassChord.invalidQuality && bassChord.quality === 'maj') return bassChord.rootPC;
    const roman = chartParseRoman(value, keyPC, mode);
    if (roman) return roman.rootPC;
  }
  return null;
}

function chartEventMidi(event) {
  if (Number.isFinite(event)) return event;
  if (!event || typeof event !== 'object') return null;
  if (Number.isFinite(event.midi)) return event.midi;
  if (Number.isFinite(event.note)) return event.note;
  return null;
}

function validateChartHarmony(input, preset) {
  const result = { score: 100, errors: [], warnings: [], licenses: [], suggestions: [] };
  const objectInput = input && !Array.isArray(input) && typeof input === 'object' ? input : {};
  const degrees = Array.isArray(input) ? input : objectInput.degrees;
  const selected = typeof preset === 'string' ? CHART_STYLES.find(item => item.id === preset) : preset;
  const keyValue = objectInput.key != null ? objectInput.key : selected && selected.key;
  const modeValue = objectInput.mode != null ? objectInput.mode : selected && selected.mode;
  const keyPC = chartParseKey(keyValue);
  const mode = chartNormalizeMode(modeValue);
  if (keyPC == null) result.errors.push('缺少或无法识别调性 key（例如 G、Bb、F#）。');
  if (!mode) result.errors.push('mode 仅支持 major / minor。');
  if (!Array.isArray(degrees) || degrees.length === 0) {
    result.errors.push('degrees 为空：至少提供一个罗马级数、实际和弦符号或 {d, acc, q} 槽位。');
    result.score = 0;
    result.suggestions.push('传入 preset.progression，或提供 {key, mode, degrees}。');
    return result;
  }
  if (keyPC == null || !mode) {
    result.score = 0;
    result.suggestions.push('补全合法 key 与 major/minor mode 后重新检查。');
    return result;
  }

  const allowed = selected && Array.isArray(selected.allowedDegrees) ? selected.allowedDegrees : [];
  const chords = degrees.map((value, index) => {
    const chord = chartParseDegree(value, keyPC, mode);
    if (!chord) {
      result.errors.push(`第 ${index + 1} 个和弦无法识别。`);
      return null;
    }
    if (chord.invalidQuality) {
      result.errors.push(`第 ${index + 1} 个和弦性质不支持：${chord.invalidQuality}。`);
      return null;
    }
    chartLocateDegree(chord, keyPC, mode);
    chord.pcs = chartChordPCs(chord);
    chord.index = index;
    return chord;
  });

  const bassDegrees = Array.isArray(objectInput.bassDegrees) ? objectInput.bassDegrees : [];
  for (const chord of chords) {
    if (!chord) continue;
    const i = chord.index;
    const ownLabel = (chord.symbol || `槽位 ${i + 1}`).split('/')[0];
    if (allowed.length && !allowed.some(item => chartDegreeMatches(chord, item, keyPC, mode))) {
      result.warnings.push(`${ownLabel} 不在 ${selected.id || '当前预设'} 的 allowedDegrees 中；请确认是有意偏离而非误写。`);
    }
    if (mode === 'minor' && chord.degree === 5 && chartQualityGroup(chord.quality) === 'major') {
      result.licenses.push(`第 ${i + 1} 个 V 大和弦：和声小调导音许可，不改判为调外错误。`);
    }
    if (mode === 'minor' && chord.degree === 5 && chartQualityGroup(chord.quality) === 'minor') {
      result.licenses.push(`第 ${i + 1} 个自然小调 v：许可，不强制替换为 V。`);
    }
    if (mode === 'minor' && chord.degree === 2 && chord.accidental === -1 && chartQualityGroup(chord.quality) === 'major') {
      const permitted = !allowed.length || allowed.some(item => /^bII/i.test(item));
      (permitted ? result.licenses : result.warnings).push(`第 ${i + 1} 个 bII：Neapolitan 大和弦色彩${permitted ? '许可' : '可用，但超出当前预设'}。`);
    }
    if (mode === 'major' && chord.degree === 3 && chartQualityGroup(chord.quality) === 'minor') {
      const previous = chords[i - 1], next = chords[i + 1];
      const passing = (previous && previous.degree === 2) || (next && next.degree === 4) || (previous && previous.degree === 1 && next && next.degree === 4);
      (passing ? result.licenses : result.warnings).push(`第 ${i + 1} 个 iii：${passing ? '经过和声许可' : '可用，建议放在 I/ii 与 IV 之间'}。`);
    }
    const bassValue = bassDegrees.length ? bassDegrees[i] : chord.slash;
    if (bassValue != null && bassValue !== '') {
      const bassPC = chartParseBass(bassValue, chord, keyPC, mode);
      if (bassPC == null) result.errors.push(`${ownLabel} 的斜线和弦/低音无法识别。`);
      else if (!chord.pcs.includes(bassPC)) result.errors.push(`${ownLabel} 的低音 ${chartPcName(bassPC, keyPC % 12 === 10 || keyPC % 12 === 1)} 不是和弦音；斜线和弦不能只换任意调内低音。`);
      else if (bassPC !== chord.rootPC) result.licenses.push(`${ownLabel}/${chartPcName(bassPC)}：合法转位低音。`);
    }
  }

  const events = Array.isArray(objectInput.melodyEvents) ? objectInput.melodyEvents.slice() : [];
  const normalizedEvents = events.map((event, index) => ({ event, index, midi: chartEventMidi(event) })).filter(item => item.midi != null && Number.isFinite(item.midi));
  normalizedEvents.sort((a, b) => {
    const ab = a.event && Number.isFinite(a.event.beat) ? a.event.beat : a.index;
    const bb = b.event && Number.isFinite(b.event.beat) ? b.event.beat : b.index;
    return ab - bb;
  });
  for (let i = 0; i < normalizedEvents.length; i++) {
    const item = normalizedEvents[i], event = item.event;
    if (!event || typeof event !== 'object') continue;
    const beat = Number.isFinite(event.beat) ? event.beat : i * 4;
    const duration = Number.isFinite(event.dur) ? event.dur : Number.isFinite(event.duration) ? event.duration : 1;
    if (duration <= 0) {
      result.errors.push(`旋律事件 ${i + 1} 的 dur 必须大于 0。`);
      continue;
    }
    const explicitIndex = Number.isFinite(event.chordIndex) ? Math.trunc(event.chordIndex) : null;
    const chordIndex = explicitIndex == null ? Math.floor(Math.max(0, beat) / 4) % chords.length : ((explicitIndex % chords.length) + chords.length) % chords.length;
    const current = chords[chordIndex];
    if (!current) continue;
    const pc = ((item.midi % 12) + 12) % 12;
    const strong = Math.abs(beat * 4 - Math.round(beat * 4)) < 1e-6 && Math.round(beat * 4) % 4 === 0;
    if (strong && !current.pcs.includes(pc)) result.warnings.push(`旋律事件 ${i + 1} 在第 ${chordIndex + 1} 和弦强拍使用非三/七和弦音；九音等延伸可保留，但应检查解决。`);
    const nextIndex = (chordIndex + 1) % chords.length;
    const nextChord = chords[nextIndex];
    const boundary = explicitIndex == null ? (Math.floor(Math.max(0, beat) / 4) + 1) * 4 : beat + 4;
    if (!nextChord || beat + duration <= boundary + 1e-6 || nextChord.pcs.includes(pc)) continue;
    const nextEvent = normalizedEvents[i + 1];
    const resolves = nextEvent && Math.abs(nextEvent.midi - item.midi) <= 2 && nextChord.pcs.includes(((nextEvent.midi % 12) + 12) % 12) && (Number.isFinite(nextEvent.event.beat) ? nextEvent.event.beat >= boundary - 1e-6 : true);
    if (resolves) result.licenses.push(`旋律事件 ${i + 1}：跨和弦不协和音随后级进解决，按挂留/经过音许可。`);
    else result.errors.push(`旋律事件 ${i + 1}：音高跨入第 ${nextIndex + 1} 和弦后冲突且未级进解决；请缩短时值、改音或在新和弦内解决。`);
  }

  if (!result.errors.length && !result.warnings.length) result.suggestions.push('和声骨架通过；编配时仍按段落密度增减织体，不要机械增加音符。');
  if (result.warnings.length) result.suggestions.push('warnings 是人工复核项，不等于禁用；licenses 记录的合法色彩无需“纠正”。');
  result.score = Math.max(0, Math.round(100 - result.errors.length * 20 - result.warnings.length * 5));
  return result;
}

if (typeof globalThis !== 'undefined') {
  globalThis.CHART_STYLES = CHART_STYLES;
  globalThis.validateChartHarmony = validateChartHarmony;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHART_STYLES, validateChartHarmony };
}
