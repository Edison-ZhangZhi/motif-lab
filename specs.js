/* ============================================================
 * specs.js — 风格规格卡（SPEC）统一视图
 * 体系核心：风格 = 数据。每张卡汇总该风格在所有引擎表中的规格，
 * 并记录参考曲指纹。引擎读表工作，本文件是"一份权威答案"。
 * 新增风格 = 加一张卡 + 各表补条目 + 过 audit 的规格完整性检查。
 * ============================================================ */
'use strict';

const SPEC_META = {
  rnb: {
    name: 'RnB / Neo-Soul', family: 'soul',
    referenceSongs: ["D'Angelo - Untitled", 'Frank Ocean - Thinkin Bout You', 'Daniel Caesar - Best Part / Who Knows', '方大同《爱爱爱》《黑洞里》', '陶喆《沙滩》《怪天气》'],
    bpmRange: [70, 95], groove: '推-拉张力（鼓 +10ms 推 / 和声 +20ms 躺）· 军鼓习惯性拖后',
    harmony: '调式混合（♭VI/♭VII 借和弦）· 半音滑接 · 1-6-2-5 / 漂流 / 半音下行链',
    soundTarget: '圆润微过载吉他 · Rhodes · 大空间 · 幽灵音鼓',
  },
  jazz: {
    name: 'Jazz', family: 'swing',
    referenceSongs: ['Wes Montgomery', 'Freddie Green', 'Jim Hall', 'Grant Green', 'Joe Pass', 'Jobim 系（吉他族六首）'],
    bpmRange: [95, 140], groove: '摇摆 2.39:1（41%）· 独奏在镲后 · 军鼓 comping 应答',
    harmony: 'ii-V-I · shell voicing · 趋近音 · 副属连接',
    soundTarget: '空心琴体（最暗档）· 颤音琴 · 鼓刷 · feather 底鼓',
  },
  rock: {
    name: 'Rock', family: 'guitar',
    referenceSongs: ['AC/DC - Back in Black / TNT', "GNR - Sweet Child O' Mine", 'Nirvana - Smells Like Teen Spirit', 'Pink Floyd - Another Brick', 'Green Day - Wake Me Up When September Ends'],
    bpmRange: [100, 145], groove: '直拍 · 重 backbeat · 每 4 小节加花 · 零摇摆',
    harmony: '五声 riff 细胞 · ♭VII 进行 · 十二小节布鲁斯 · 强力和弦',
    soundTarget: '失真墙（drive 30/双轨）· room 鼓 · 闷音刷弦 · 干近',
  },
  bossa: {
    name: 'Bossa Nova', family: 'latin',
    referenceSongs: ['Antônio Carlos Jobim - The Girl from Ipanema', 'Milton Banana 鼓型传统', 'Getz/Gilberto 专辑系'],
    bpmRange: [70, 85], groove: '直八分（律动感来自切分不来自摇摆）· rim 反拍不打正拍',
    harmony: '阶梯模进（antecedent/consequent）· ii-V-I 亮色 · 大七/九',
    soundTarget: '尼龙指弹 batida（最亮档）· 鼓刷/边击 · shaker · 轻混响',
  },
  afro: {
    name: 'Afrobeat / Afro', family: 'groove',
    referenceSongs: ['Fela Kuti - Water No Get Enemy', 'Tony Allen 鼓型', 'Burna Boy / Tems / Tyla《Water》系当代', '尼成（Afro-fusion）'],
    bpmRange: [95, 115], groove: '鼓略早于网格 +6ms · Son Clave · 每 16 小节 break · shekere 抛物线强调',
    harmony: 'i-♭VII 循环 · 亮色 I-V-vi-IV · 问答句落音呼应',
    soundTarget: 'highlife 切分吉他 · shekere/bell 分层 · 康加对答 · 打击乐群前置',
  },
  funk: {
    name: 'Funk', family: 'groove',
    referenceSongs: ['The Meters', 'James Brown', 'P-Funk', 'Vulfpeck'],
    bpmRange: [96, 110], groove: '十六分幽灵音 · 切分 stab · 直拍微摆',
    harmony: 'Ⅰ9-Ⅳ9 九和弦循环 · 布鲁斯音阶素材',
    soundTarget: '闷音 wah chop · clavinet/铜管 stab · slap 贝斯 · 干而有劲',
  },
  soul: {
    name: 'Soul / Gospel', family: 'soul',
    referenceSongs: ['Aretha Franklin', 'Al Green', 'Etta James', '福音合唱团传统'],
    bpmRange: [60, 85], groove: '十二拍慢灵魂 · 大 backbeat · Swing 30%',
    harmony: '1-6-4-5 福音进行 · 大七/九和弦 · 调式混合',
    soundTarget: '宽长音吉他 · Hammond/Rhodes · 大空间教堂感',
  },
  reggae: {
    name: 'Reggae', family: 'island',
    referenceSongs: ['Bob Marley', 'Peter Tosh', 'Dub 传统'],
    bpmRange: [70, 90], groove: 'One-drop（kick/军鼓同落第3拍）· 反拍切分',
    harmony: '小调 i-♭VII-♭VI-V · 反拍扫弦和声',
    soundTarget: '反拍 skank 吉他 · dub 深贝斯 · rim/沙锤 · 温暖模拟',
  },
  afrobeats: {
    name: 'Afrobeats', family: 'groove',
    referenceSongs: ['Tyla - Water', 'Wizkid', 'Burna Boy', 'Rema'],
    bpmRange: [98, 115], groove: 'log-drum 式切分 808 kick · 密 shaker · 高重复',
    harmony: '亮色 I-V-vi-IV · 五声 hook',
    soundTarget: '明亮拨弦琶音 · 滑音 808 · clap/shaker · 阳光电台混音',
  },
  hiphop: {
    name: 'Rap / Hip-Hop (Trap)', family: 'beat',
    referenceSongs: ['Metro Boomin / Future 系', 'The Meters', 'Dilla / Dre / .Paak（吉他族）', 'Frank Ocean 式暗色 hook'],
    bpmRange: [130, 150], groove: '半速（军鼓第 3 拍）· hat 滚奏/三连音 · 细分变化即律动',
    harmony: '小调 i-♭VI-iv-♭VII · 黑暗 hook · 稀疏',
    soundTarget: 'chop 美学（lpf 4200/gate）· 滑音 808 · 暗黑 pad 主角',
  },
};

/* 统一装配：一份权威规格（运行时懒装配，跨文件引用） */
function getSpec(styleKey) {
  const meta = SPEC_META[styleKey];
  if (!meta) return null;
  const mel = (typeof STYLES !== 'undefined' && STYLES[styleKey] && STYLES[styleKey].mel) || {};
  return {
    key: styleKey,
    name: meta.name,
    family: meta.family,
    referenceSongs: meta.referenceSongs,
    bpmRange: meta.bpmRange,
    groove: meta.groove,
    harmony: meta.harmony,
    soundTarget: meta.soundTarget,
    /* 引擎表引用（单一事实源仍在各表，此处为装配视图） */
    setup: typeof STYLE_SETUP !== 'undefined' ? STYLE_SETUP[styleKey] : null,
    tone: typeof STYLE_TONE !== 'undefined' ? STYLE_TONE[styleKey] : null,
    fx: typeof STYLE_FX !== 'undefined' ? STYLE_FX[styleKey] : null,
    timing: typeof TIMING_PROFILE !== 'undefined' ? TIMING_PROFILE[styleKey] : null,
    kit: typeof DRUM_KITS !== 'undefined' ? DRUM_KITS[styleKey] : null,
    budget: typeof DRUM_BUDGET !== 'undefined' ? DRUM_BUDGET[styleKey] : null,
    melDna: mel,
    dnaDensity: mel.density, dnaStepP: mel.stepP, dnaDur: mel.durBias, dnaRep: mel.rep,
    cellCount: (typeof CELL_LIB !== 'undefined' && CELL_LIB[styleKey]) ? CELL_LIB[styleKey].length : 0,
    extColors: (typeof STYLES !== 'undefined' && STYLES[styleKey]) ? STYLES[styleKey].ext : null,
    presets: (typeof PRESETS !== 'undefined') ? PRESETS.filter(p => p.styles && p.styles.includes(styleKey)).map(p => p.name) : [],
  };
}

/* 规格完整性：一张卡所有关键件齐全（供 audit 与 UI 使用） */
function specCompleteness(styleKey) {
  const s = getSpec(styleKey);
  if (!s) return { ok: false, missing: ['spec-meta'] };
  const missing = [];
  if (!s.setup) missing.push('STYLE_SETUP');
  if (!s.tone) missing.push('STYLE_TONE');
  if (!s.fx) missing.push('STYLE_FX');
  if (!s.timing) missing.push('TIMING_PROFILE');
  if (!s.kit) missing.push('DRUM_KITS');
  if (!s.budget && s.budget !== 0) missing.push('DRUM_BUDGET');
  if (!s.melDna || !Object.keys(s.melDna).length) missing.push('mel-DNA');
  if (s.cellCount < 4) missing.push('cells<4');
  if (!s.referenceSongs || !s.referenceSongs.length) missing.push('参考曲');
  if (!s.presets.length) missing.push('预设');
  return { ok: missing.length === 0, missing };
}
