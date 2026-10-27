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
    referenceBasis: '仅抽象公开转录与风格特征；不复刻旋律、歌词或录音，参考说明不代表官方谱。',
    bpmRange: [70, 105], groove: '推-拉张力（鼓 +10ms 推 / 和声 +20ms 躺）· 军鼓习惯性拖后',
    harmony: '调式混合（♭VI/♭VII）· 1-6-2-5 · 小调 i-V-♭VI-♭III；V 大属与自然小调 v 均按语境许可',
    harmonyRules: [' maj7/min9 以中音区 shell 为底，延伸音不挤在低音区', '跨和弦不协和旋律需级进解决；bII 仅作有意的 Neapolitan 色彩'],
    texture: 'Rhodes/柔吉他双音错位演奏；主歌以空隙为主，副歌加 Pad 与和声层而非全轨同步加密。',
    sectionDensity: { intro: 0.25, verse: 0.42, preChorus: 0.56, chorus: 0.72, bridge: 0.36, outro: 0.25 },
    soundTarget: '圆润微过载吉他 · Rhodes · 大空间 · 幽灵音鼓',
  },
  jazz: {
    name: 'Jazz', family: 'swing',
    referenceSongs: ['Wes Montgomery', 'Freddie Green', 'Jim Hall', 'Grant Green', 'Joe Pass', 'Jobim 系（吉他族六首）'],
    referenceBasis: '乐手与传统语汇的风格参考，不是原曲转录或官方谱。',
    bpmRange: [80, 160], groove: '摇摆 2.39:1（41%）· 独奏在镲后 · 军鼓 comping 应答；慢曲减少 swing 比例',
    harmony: 'ii-V-I · shell voicing · 趋近音 · 副属连接；三/七音优先，避免所有和弦机械堆九音',
    harmonyRules: ['V7 的导音与七音优先解决', '经过减和弦与副属属于风格许可，不按调外音直接报错'],
    texture: '吉他/钢琴 shell 与 walking bass 错开；comping 回答旋律空档，独奏段减少 Pad。',
    sectionDensity: { intro: 0.3, verse: 0.45, preChorus: 0.55, chorus: 0.7, bridge: 0.5, outro: 0.35 },
    soundTarget: '空心琴体（最暗档）· 颤音琴 · 鼓刷 · feather 底鼓',
  },
  rock: {
    name: 'Rock', family: 'guitar',
    referenceSongs: ['AC/DC - Back in Black / TNT', "GNR - Sweet Child O' Mine", 'Nirvana - Smells Like Teen Spirit', 'Pink Floyd - Another Brick', 'Green Day - Wake Me Up When September Ends'],
    referenceBasis: '只提炼直拍、riff 与配器特征；参考曲名不构成旋律或官方 Guitar Pro 转录。',
    bpmRange: [100, 145], groove: '直拍 · 重 backbeat · 每 4 小节加花 · 零摇摆；乡村/流行跨界仍保持八分推进',
    harmony: 'I-IV-V、I-ii-IV、IV-I-vi-V 与五声 riff · 强力和弦；iii 可作 I/ii 到 IV 的经过和声',
    harmonyRules: ['强力和弦省略三音时不据此判大小调错误', '斜线和弦低音必须为真实和弦音'],
    texture: '主歌闷音单轨或清音分解，预副歌逐步开放，副歌双轨开放和弦；Pad 默认让位吉他。',
    sectionDensity: { intro: 0.38, verse: 0.52, preChorus: 0.68, chorus: 0.88, bridge: 0.48, outro: 0.4 },
    soundTarget: '失真墙（drive 30/双轨）· room 鼓 · 闷音刷弦 · 干近',
  },
  bossa: {
    name: 'Bossa Nova', family: 'latin',
    referenceSongs: ['Antônio Carlos Jobim - The Girl from Ipanema', 'Milton Banana 鼓型传统', 'Getz/Gilberto 专辑系'],
    referenceBasis: '公开和声语汇与传统节奏参考，不复制原旋律，非官方谱。',
    bpmRange: [70, 100], groove: '直八分（律动感来自切分不来自摇摆）· rim 反拍不打正拍',
    harmony: '阶梯模进（antecedent/consequent）· ii-V-I 亮色 · 大七/九；半音经过属和弦需保留解决方向',
    harmonyRules: ['低音根音/五音交替，不在每拍堆和弦音', 'maj7/9 的三音与七音分置，避免低区二度簇'],
    texture: '尼龙吉他 batida 同时承担低音与和声；键盘只做薄层呼应，密集段优先加 shaker 而非加长音。',
    sectionDensity: { intro: 0.28, verse: 0.44, preChorus: 0.52, chorus: 0.64, bridge: 0.46, outro: 0.3 },
    soundTarget: '尼龙指弹 batida（最亮档）· 鼓刷/边击 · shaker · 轻混响',
  },
  afro: {
    name: 'Afrobeat / Afro', family: 'groove',
    referenceSongs: ['Fela Kuti - Water No Get Enemy', 'Tony Allen 鼓型', 'Burna Boy / Tems / Tyla《Water》系当代', '尼成（Afro-fusion）'],
    referenceBasis: '传统与当代 groove 的抽象参考；不包含原曲旋律或官方分谱。',
    bpmRange: [95, 120], groove: '鼓略早于网格 +6ms · Son Clave · 每 16 小节 break · shekere 抛物线强调',
    harmony: 'Dorian i-iv、i-♭VII 循环与亮色 I-V-vi-IV · 以节奏复层推进，和声不必频繁更换',
    harmonyRules: ['长 vamp 中自然小调 v 不强制改 V', '各声部使用共同和声骨架，切分不当作和声冲突'],
    texture: 'highlife 吉他、康加、bell 与铜管问答分层；段落先增减打击乐和回应声部，再改变和声密度。',
    sectionDensity: { intro: 0.35, verse: 0.58, preChorus: 0.68, chorus: 0.86, bridge: 0.42, outro: 0.38 },
    soundTarget: 'highlife 切分吉他 · shekere/bell 分层 · 康加对答 · 打击乐群前置',
  },
  funk: {
    name: 'Funk', family: 'groove',
    referenceSongs: ['The Meters', 'James Brown', 'P-Funk', 'Vulfpeck'],
    referenceBasis: '仅抽象 riff、九和弦与十六分律动特征；不是原曲转录或官方谱。',
    bpmRange: [90, 120], groove: '十六分幽灵音 · 切分 stab · 直拍微摆',
    harmony: 'I9-IV9、i9-iv9 与单和弦 vamp · 布鲁斯音阶素材；色彩变化服从 riff 重复',
    harmonyRules: ['九和弦省略五音可保留 identity', '自然小调/多利亚 v 不自动改成大属'],
    texture: '闷音吉他、clavinet 与贝斯各占不同十六分空位；副歌加铜管 stab，不让所有层同时持续。',
    sectionDensity: { intro: 0.38, verse: 0.6, preChorus: 0.68, chorus: 0.84, bridge: 0.46, outro: 0.4 },
    soundTarget: '闷音 wah chop · clavinet/铜管 stab · slap 贝斯 · 干而有劲',
  },
  soul: {
    name: 'Soul / Gospel', family: 'soul',
    referenceSongs: ['Aretha Franklin', 'Al Green', 'Etta James', '福音合唱团传统'],
    referenceBasis: '福音/灵魂乐共性参考，不复制演唱旋律、歌词或官方谱。',
    bpmRange: [60, 100], groove: '慢曲可用十二拍与大 backbeat · Swing 30%；中速流行灵魂乐可改直八分',
    harmony: 'I-vi-IV-V、IV-I-vi-V · 大七/九和弦 · IV-iv-I 调式混合；V 大属保留导音解决',
    harmonyRules: ['和弦转位服务贝斯平滑连接', '挂留旋律跨和弦时须在下一和弦内级进解决'],
    texture: 'Rhodes/Hammond 长音托底，吉他双音回应；副歌增加风琴与合唱感层，主歌保留人声空间。',
    sectionDensity: { intro: 0.28, verse: 0.44, preChorus: 0.58, chorus: 0.74, bridge: 0.4, outro: 0.3 },
    soundTarget: '宽长音吉他 · Hammond/Rhodes · 大空间教堂感',
  },
  reggae: {
    name: 'Reggae', family: 'island',
    referenceSongs: ['Bob Marley', 'Peter Tosh', 'Dub 传统'],
    referenceBasis: 'one-drop 与反拍和声的传统参考，不含原曲旋律或官方谱。',
    bpmRange: [65, 95], groove: 'One-drop（kick/军鼓同落第3拍）· 反拍切分',
    harmony: '小调 i-♭VII-♭VI-V、大调 I-IV-V · 反拍扫弦和声；V 与 v 按大/自然小调语境选择',
    harmonyRules: ['反拍短和弦不承担持续低音', 'dub 段可减和声层，不将留白判为缺失'],
    texture: '吉他/键盘反拍 skank 错开八度，深贝斯负责主线；bridge/outro 可用 dub 静音与延迟尾音减层。',
    sectionDensity: { intro: 0.25, verse: 0.42, preChorus: 0.5, chorus: 0.66, bridge: 0.3, outro: 0.24 },
    soundTarget: '反拍 skank 吉他 · dub 深贝斯 · rim/沙锤 · 温暖模拟',
  },
  afrobeats: {
    name: 'Afrobeats', family: 'groove',
    referenceSongs: ['Tyla - Water', 'Wizkid', 'Burna Boy', 'Rema'],
    referenceBasis: '当代 groove 与公开和声骨架参考，不复制 hook、歌词或官方分谱。',
    bpmRange: [96, 124], groove: '切分 kick/808 · 密 shaker · 高重复；120 BPM 附近仍以律动层增能而非盲目提速',
    harmony: '亮色 I-V-vi-IV、小调 iv-i-III-v 与 i-♭VI-♭III-♭VII · 五声 hook；自然小调 v 合法',
    harmonyRules: ['III 在小调表示自然三级大和弦，♭III 记法等价时不重复降根音', '短循环中换和弦先于旋律重音，跨和弦冲突需解决'],
    texture: '明亮短 pluck/marimba 琶音与 shaker 为持续层，verse 减 kick 和回应，chorus 加 clap、log-drum 与高音对答。',
    sectionDensity: { intro: 0.3, verse: 0.5, preChorus: 0.64, chorus: 0.82, bridge: 0.38, outro: 0.34 },
    soundTarget: '明亮拨弦琶音 · 滑音 808 · clap/shaker · 阳光电台混音',
  },
  hiphop: {
    name: 'Rap / Hip-Hop (Trap)', family: 'beat',
    referenceSongs: ['Metro Boomin / Future 系', 'The Meters', 'Dilla / Dre / .Paak（吉他族）', 'Frank Ocean 式暗色 hook'],
    referenceBasis: '制作语法与风格共性参考，不复制原曲采样、旋律、歌词或官方谱。',
    bpmRange: [120, 155], groove: '半速（军鼓第 3 拍）· hat 滚奏/三连音 · 细分变化即律动',
    harmony: '小调 i-♭VI-iv-♭VII、iv7-v7-i7 · 黑暗 hook · 稀疏；自然小调 v7 不强制升为大属',
    harmonyRules: ['三和弦循环保留 min7 色彩即可，避免低区堆延伸音', '808 滑音与和弦根音分离检查，不把合法八度/滑音当离调'],
    texture: '暗 Pad/短 pluck 二选一作主层，hook 与 808 留空错开；段落通过 mute、滤波和 hat 细分变化塑形。',
    sectionDensity: { intro: 0.22, verse: 0.44, preChorus: 0.56, chorus: 0.76, bridge: 0.3, outro: 0.22 },
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
    referenceBasis: meta.referenceBasis,
    bpmRange: meta.bpmRange,
    groove: meta.groove,
    harmony: meta.harmony,
    harmonyRules: meta.harmonyRules,
    texture: meta.texture,
    sectionDensity: meta.sectionDensity,
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
