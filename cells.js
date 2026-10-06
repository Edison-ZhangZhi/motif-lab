/* ============================================================
 * cells.js — 风格动机细胞库与对齐指标（Phase 2/3）
 * 细胞 = 节奏骨架(r: 16分起止) + 音程骨架(iv: 相对首音半音)
 * 来源：歌单歌曲的创作语法（AC/DC/GNR 五声riff、D'Angelo 切分圆滑、
 *       Jobim 阶梯模进、Fela 问答短句、爵士摇摆音阶），不含任何原曲旋律
 * ============================================================ */
'use strict';

const CELL_LIB = {
  rock: [
    { w: 3, r: [0, 2, 4, 6],      iv: [0, 3, 5, 3] },        // 八分五声上行
    { w: 3, r: [0, 2, 4, 6],      iv: [0, -2, -5, -2] },     // 下行
    { w: 2, r: [0, 4, 6],         iv: [0, 7, 3] },            // 跳+回补
    { w: 2, r: [0, 2, 6, 8],      iv: [0, 3, 10, 7] },       // 大跳回补
    { w: 2, r: [0, 6, 8, 10, 12, 14], iv: [0, -2, -4, -5, -7, -5] }, // riff 级进下行
    { w: 1, r: [0, 4],            iv: [0, 12] },              // 八度锤
    { w: 2, r: [0, 3, 6, 8, 11, 14], iv: [0, 0, 3, 5, 3, 0] }, // riff 重复+尾跳(GNR式)
    { w: 2, r: [0, 2, 3, 6, 10, 12, 14], iv: [0, 3, 5, 3, 0, -2, -5] }, // 附点感问答
  ],
  rnb: [
    { w: 3, r: [0, 3, 8, 11],     iv: [0, 2, -3, 2] },       // 切分圆滑
    { w: 2, r: [0, 6, 10],        iv: [0, 3, 7] },
    { w: 2, r: [0, 4, 11, 14],    iv: [0, 5, 3, -2] },       // 大跳后级进回补
    { w: 2, r: [0, 8],            iv: [0, -5] },              // 双音呼吸
    { w: 2, r: [0, 2, 3, 6, 8, 11], iv: [0, 2, 1, 3, 2, -2] }, // 高密度级进（4.5音/小节）
    { w: 2, r: [0, 3, 6, 10, 12, 14], iv: [0, 1, 3, 2, 4, 3] }, // 半音经过细胞
    { w: 1, r: [0, 2, 3, 6],      iv: [0, 1, 0, 2] },        // 半音辅助音
    { w: 1, r: [0, 3, 6, 10, 12], iv: [0, 2, 4, 3, 7] },
    { w: 2, r: [0, 3, 8, 14, 16, 19, 24, 30], iv: [0, 2, -3, 2, 0, 2, -3, -5] }, // 两小节呼应长句
    { w: 2, r: [0, 6, 11, 16, 22, 27], iv: [0, 5, 3, 7, 5, 2] }, // 跨小节大跳弧线
  ],
  jazz: [
    { w: 3, r: [0, 4, 8, 12],     iv: [0, 4, 7, 3] },        // 和弦音分解
    { w: 2, r: [0, 6, 10, 14],    iv: [0, 3, -2, 2] },       // 趋近环绕
    { w: 2, r: [0, 2, 4, 6, 8, 10, 12, 14], iv: [0, 2, 1, -2, 2, 4, -1, 2] }, // 摇摆音阶流
    { w: 2, r: [0, 8, 12],        iv: [0, 7, 4] },
    { w: 2, r: [0, 4, 6, 10, 12, 16, 20, 22], iv: [0, 4, 3, 7, 4, 2, 4, 3] }, // 环绕趋近长句
    { w: 2, r: [0, 6, 14, 18, 22, 26], iv: [0, 3, 9, 7, 5, 4] }, // 五度圈下行
  ],
  bossa: [
    { w: 3, r: [0, 3, 6, 8, 11],  iv: [0, 2, 4, 2, 4] },     // 阶梯上行(模进)
    { w: 3, r: [0, 3, 6, 10, 13], iv: [0, -2, -4, -2, -5] }, // 下行回应
    { w: 2, r: [0, 6, 11, 14],    iv: [0, 3, 2, 5] },
    { w: 1, r: [0, 8],            iv: [0, 7] },
    { w: 2, r: [0, 3, 6, 8, 11, 16, 19, 22, 24], iv: [0, 2, 4, 2, 4, 5, 4, 2, 0] }, // 两小节阶梯往返
    { w: 2, r: [0, 6, 11, 16, 21, 26, 29], iv: [0, 3, 2, 4, 2, -2, -4] }, // 波浪回应
  ],
  hiphop: [
    { w: 3, r: [0, 6],         iv: [0, -2] },        // 双音黑暗hook
    { w: 3, r: [0, 3, 8],      iv: [0, 3, -2] },     // 稀疏问句
    { w: 2, r: [0, 8],         iv: [0, -5] },        // 五度呼吸
    { w: 2, r: [0, 6, 10, 12], iv: [0, 2, -2, -5] }, // 短动机+回落
    { w: 1, r: [0, 12],        iv: [0, 0] },
    { w: 2, r: [0, 8, 16, 22], iv: [0, -2, 0, 3] },   // 长音 hook + 尾句
    { w: 2, r: [0, 3, 8, 16, 19, 24], iv: [0, 3, -2, 0, 2, -2] }, // 双问句
  ],
  afro: [
    { w: 3, r: [0, 3, 6],         iv: [0, 2, -3] },          // 问句(短)
    { w: 3, r: [0, 6, 10],        iv: [0, -5, -3] },         // 答句
    { w: 2, r: [0, 3, 6, 10],     iv: [0, 3, 5, 3] },
    { w: 2, r: [0, 2, 3, 6],      iv: [0, 2, 0, 3] },        // 十六分细胞
    { w: 1, r: [0, 12],           iv: [0, 0] },              // 持续音
    { w: 2, r: [0, 3, 6, 16, 19, 22], iv: [0, 2, -3, 0, -5, -3] }, // 跨小节问答
    { w: 2, r: [0, 2, 6, 8, 16, 18, 22, 24], iv: [0, 2, 3, 2, 5, 3, 2, 0] }, // 十六分推进+回落
  ],
};

/* 由细胞库推导音程目标直方图（对齐仪表基准） */
function ivTargetHistogram(styleKey) {
  const h = {};
  for (const c of (CELL_LIB[styleKey] || [])) {
    for (let i = 1; i < c.iv.length; i++) {
      const d = c.iv[i] - c.iv[i - 1];
      h[d] = (h[d] || 0) + c.w;
    }
  }
  return h;
}

/* 对齐指标：生成旋律 vs 风格规格 */
function alignMetrics(styleKey) {
  const evs = melodyEvents;
  if (!evs.length || !CELL_LIB[styleKey]) return null;
  /* 1. 音程直方图余弦相似（同 2 小节组内相邻音） */
  const target = ivTargetHistogram(styleKey);
  const gen = {};
  for (let i = 1; i < evs.length; i++) {
    if (Math.floor(evs[i].beat / 8) !== Math.floor(evs[i - 1].beat / 8)) continue;
    const d = clamp(evs[i].midi - evs[i - 1].midi, -12, 12);
    if (d !== 0) gen[d] = (gen[d] || 0) + 1;
  }
  let dot = 0, gm = 0, tm = 0;
  for (const k of Object.keys(gen)) { gm += gen[k] * gen[k]; }
  for (const k of Object.keys(target)) { tm += target[k] * target[k]; }
  for (const k of Object.keys(gen)) { if (target[k]) dot += gen[k] * target[k]; }
  const ivMatch = (gm && tm) ? Math.round(dot / (Math.sqrt(gm) * Math.sqrt(tm)) * 100) : 0;
  /* 2. 节奏分布余弦相似（生成 onset 直方图 vs 细胞库聚合） */
  const th = {};
  for (const cc of (CELL_LIB[styleKey] || [])) for (const o of cc.r) { const k = o % 16; th[k] = (th[k] || 0) + cc.w; }
  const gh = {};
  for (const e of evs) { if (e.dur >= 2) continue; const k = Math.round(e.beat * 4) % 16; gh[k] = (gh[k] || 0) + 1; }
  let d2 = 0, g2 = 0, t2 = 0;
  for (const k of Object.keys(gh)) g2 += gh[k] * gh[k];
  for (const k of Object.keys(th)) t2 += th[k] * th[k];
  for (const k of Object.keys(gh)) { if (th[k]) d2 += gh[k] * th[k]; }
  const rhythmCov = (g2 && t2) ? Math.round(d2 / (Math.sqrt(g2) * Math.sqrt(t2)) * 100) : 0;
  /* 3. 强拍和弦音占比 */
  let strong = 0, strongCt = 0;
  for (const e of evs) {
    const on16 = Math.round(e.beat * 4) % 16;
    if (on16 % 4 !== 0) continue;
    strong++;
    const ch = chordTimeline[Math.floor(e.beat / 4)];
    if (ch && ch.pcs.includes(e.midi % 12)) strongCt++;
  }
  const chordPct = strong ? Math.round(strongCt / strong * 100) : 0;
  return { ivMatch, rhythmCov, chordPct };
}
