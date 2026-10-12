# Motif Lab · 电吉他动机旋律生成器

用自然语言描述一个音乐动机（如"上行级进、明亮开阔"），即刻生成带完整编曲的电吉他旋律作品——鼓、贝斯、电钢琴、Pad 自动编配，和弦走向可改、逐轨可编辑、可导出 MIDI/WAV，也可用浏览器内置 AI 渲染成"唱片级"音频。

**在线使用**：https://edison-zhangzhi.github.io/motif-lab/
纯静态网页，零安装、零后端、免费。首次访问后所有采样进入离线缓存（Service Worker），第二次打开秒开。

---

## 功能一览

### 1. 自然语言动机 → 旋律
输入中文/英文描述（上行下行、密度、时值、忧郁蓝调、跳进幅度等都会被解析并真实影响音符），生成 A A' B A'' 乐句结构的电吉他旋律。生成结果直接落在**钢琴卷帘**上，可点格增删音、拖动改位置/时值。

### 2. 十种风格，全部对标真实热歌
每种风格的鼓型、BPM、swing 量、贝斯型、和声语汇均来自标志性曲目的实测/转写：

| 风格 | 对标 | 特征 |
|---|---|---|
| RnB / Neo-Soul | Daniel Caesar《Best Part》 | 拖拍 backbeat、maj9 调式漂流 |
| Jazz | 《Fly Me to the Moon》 | spang-a-lang ride、walking bass |
| Rock | AC/DC《Back in Black》 | 标准 backbeat、power chord |
| Bossa Nova | 《The Girl from Ipanema》 | surdo 鼓点 + bossa clave |
| Afro（Afrobeat） | Fela Kuti《Zombie》 | Tony Allen 复节奏、Dorian vamp |
| Hip-Hop / Trap | 《SICKO MODE》 | half-time 军鼓、32 分 hi-hat 滚奏、808 滑音 |
| Funk | James Brown《Funky Drummer》 | 精确转写的 ghost 网 + slap 贝斯 |
| Soul / Gospel | Bill Withers《Lovely Day》 | 重 backbeat、IV-IVm-I 福音解决 |
| Reggae | Bob Marley《Stir It Up》 | one-drop（第 1 拍必须空）、反拍 skank |
| Afrobeats | Wizkid《Essence》 | tresillo kick、log-drum 切分 |

风格可多选自动融合（按小节交替各风格的节奏型/音阶/律动）。

### 3. 和弦系统进行
37 种和弦性质（七/九/十一/十三/挂留/变化和弦），罗马数字级数显示 + 功能分组讲解。改级数或性质后**旋律自动重配**。内置 30+ 条热歌同款走向预设（Best Part、Redbone、Ipanema、Superstition、SICKO MODE……）。

### 4. 轨道编辑器（库乐队式）
生成结果不是黑盒：五条轨（旋律/键盘/贝斯/Pad/鼓）全部可在网格上直接编辑——点格子加删音、鼓轨连点循环力度、键盘轨点选触发和弦、Pad 按小节开关，播放中编辑即时生效，支持翻页与逐轨重置。

### 5. 双子引擎
- **▶ 播放（引擎 A）**：Tone.js + 真实采样实时播放——定位是"作曲草稿纸"，按下即播。
- **🎙 渲染成唱片（引擎 B）**：MusicGen 神经音频生成（浏览器内置模型，免费），自动后制母带（高通/挖泥/存在感/空气感/砖墙限幅）+ 频谱体检打分，可下载 WAV。

### 6. 导出
⬇ MIDI（全编配分轨）· ⬇ WAV（含频谱体检）· 📋 复制和弦走向。

---

## 技术架构

```
index.html ─┬─ theory.js   乐理核心：37 和弦定义、10 风格参数、热歌鼓型/走向预设
            ├─ cells.js    动机细胞库（10 风格 × riff 乐句片段）
            ├─ specs.js    SPEC 卡：每风格参考曲/BPM/和声语法/声音目标
            ├─ rules.js    作曲规则器：密度预算/军鼓白名单/时值规则（设计意图 > 修正）
            ├─ app.js      主引擎：作曲层（纯函数）→ 排程层 → 混音层 → AI 渲染层
            ├─ audit.js    十七维质量门禁（node audit.js，≥8.0 才允许上线）
            └─ sw.js       Service Worker 离线缓存
```

关键设计：

- **渐进式采样加载**：自写 SoundFont 加载器，逐音解码、每音让出主线程、当前乐曲用到的音高优先——按下播放立即出声，真实采样逐个无缝切入（v20 根治"出一声卡死"的解码风暴）。
- **统一摇摆网格**：全声部（旋律/键盘/贝斯/Pad/鼓）共享同一 swing 后网格函数，鼓件微时值在其上叠加；MIDI 导出与实时播放完全同网格。
- **和声工程**：开放排列 voicing（最低音 E3、声部间距约束、九和弦省五音/drop-2）、RnB 真去根音（3-7-9）、voicing 主动避让旋律音区。
- **热歌鼓型库**：每种风格"主型 + 双变体"轮换，ghost 力度随机、开镲制音（choke）、非线性 fill、kick-bass pocket 吸合。
- **测量驱动调音**：audit.js 十七维门禁包含浑浊度、音区撞音、鼓力度方差、kick-bass 对齐率、旋律方向性等听感相关维度——门禁不过不允许上线。

## 本地运行

任意静态服务器即可，例如：

```bash
node -e "const h=require('http'),f=require('fs'),p=require('path');h.createServer((q,s)=>{let f2=p.join('.',q.url.split('?')[0]);if(f2==='.')f2='index.html';f.readFile(f2,(e,d)=>{if(e){s.writeHead(404);s.end()}else{s.end(d)}})}).listen(8080)"
# 打开 http://localhost:8080
```

## 质量门禁与部署

```bash
node audit.js     # 十七维审核，≥8.0 才允许推送
```

部署：GitHub Pages（main 分支根目录），推送即上线。版本徽章 + 资源 `?v=N` 查询参数是硬规矩（防浏览器缓存旧代码）。

## 版本简史

- **v13 及之前**：20 轮迭代把实时引擎推到 SoundFont GM 的物理极限，留下四件乐理资产与 audit 方法论。
- **v16**：大修——播放预热、引擎 B 修复（原引用不存在的包名，从未能工作）、voicing 开放排列、鼓律动重建、四风格参数表补齐、旋律死参数接通。
- **v17**：热歌实测风格库落地；修复两个和声级 bug（小调 ♭ 级双重降、键盘 voicing 整体偏高大三度）；导出精简；轨道编辑器上线。
- **v18**：Service Worker 离线缓存、音色门 4→2、播放中零解码。
- **v19**：播放防弹（门禁容错、错误可见、加载失败看门狗自救）。
- **v20**：按下即播 + 渐进式 SoundFont 加载器，根治"出一声卡死"。
- **v21**：根治"一播放就非常卡"——实测定位 Tone.js MetalSynth 每次触发吃 ~14ms 主线程（播放中 hats/rides 高频触发 = 主线程被吃掉 80%+），改为 Tone.Offline 离线渲染成 AudioBuffer 走采样播放（<0.1ms/次，live synth 保留兜底）；FM tine（keysEP）同病同治；SF 加载从"全量预载 11 音色×88 音（~1000 次 decode）"改 scheduleAll 按本曲实际音色按需加载（-60% 解码量）。播放回调主线程占用 17.6s→0.6s/20s。诊断用 ?perf=1 HUD 已随任务拆除。
- **v22**：加固——Tone.Offline 无 try/finally，回调异常会把全局 context 留在离线上下文（全站静音隐患），加 finally 强制恢复；修复"导出 WAV/MIDI 点击后立即 revokeObjectURL 在部分浏览器会取消下载"的竞态；移除性能诊断面板。
- **v23**：缓存幽灵根治——SW 对 HTML/sw.js 改网络优先（离线回退缓存），新版 SW 接管时自动刷新一次，另加版本探测兜底强制刷新；发版三件套：?v=N + 徽章 + index.html PAGE_VER。
- **v24**：DAW 式播放根治卡顿——编曲整体离线渲染成单条 AudioBuffer 播放（零排程零建节点，低端机不再爆）；MetalSynth/FM 电钢改用独立 OfflineContext（不再换全局 context 致静音/卡死）；采样总线与 SF 播放动态取 context；渲染失败自动回退实时播放。
- **v25**：实时播放音质优化——母带链升级（低频暖 +1.5dB / 1k 收敛 / 高频空气 +1.5dB / 限制器前 makeup +2.3dB 响度）、贝斯低通后 1.5kHz 宽峰补定义感、bossa 键盘弃 GM 电钢采样换 FM tine；轨道编辑器小白化——点格子即时发声（像玩鼓垫）+ 顶部操作反馈条 + 每轨一句人话提示 + 预览用真实调性根音。
- **v26**：渲染提速 + 去糊 + 编辑器游戏化——① 短编曲（<800 事件）直接实时排程播放零渲染等待，长编曲改动停顿 1.2s 后台预渲染（点播放零等待），渲染窗口内试听自动避让；② 去糊手术：鼓总线 320Hz 低中峰削 -2.5dB + 鼓混响发送 300Hz 高通 + 镲片空气感放开（11k→13.5k）+ kick_808 长尾收敛 1.6→1.3s，吉他 90Hz 高通 + 泥区再挖 + 存在感 +1.5dB；③ 轨道编辑器新增「新手模式」：大鼓垫/钢琴条/和弦垫 + 节拍器 + 点按量化录制 + 连击反馈，像玩节奏游戏一样编曲。
- **v27**：爆音根治 + 真实鼓组 + 响度——① RNB 播放"一炸一炸"根因修复：母带链加 tanh 软削波（DAC 硬削波兜底）+ 主压缩 attack 30→15ms + SF/鼓/808 全部起音软起（6/2/4ms）+ sfBright 滤波平滑 0.025→0.06s（拉链噪声）+ 808 子层起音 4ms；② 游戏模式无声修复：停止播放后恢复被静音的采样总线 + 建图即建采样总线 + 试听力度提升 + 节拍器音量 -16→-10；③ 鼓真实质感：RnB/Soul 弃合成 808 底鼓/镲换真实房间采样（塑料感主犯），对应 presence 防过热下调；④ 整体响度 +1.5dB（软削波兜底）。
- **v28**：鼓采样实测校正 + 军鼓去"炸麦"——用 MP3 帧头 global_gain 剖面实测定位：① "镲片没声音"根因：hat_closed 是 152s 长录音，代码只取开头 0.8s（gain≈56-67 近静音段）→ 采样起始点校正到 28.0s 处的孤立击打（gain 168）；kick_room 同样校正到 3.9s 处最响一击；截断逻辑改为按 offset 切段；② "军鼓炸麦"：rnb/soul 军鼓 snap（低码率脆裂采样）→ snare_room 真鼓采样，且鼓总线动态链温和化（主压缩 -16/3.5→-14/3、NY 并行压缩 -32/10/0.55→-26/6/0.35、饱和 0.12→0.06），重度碾碎副本正是"炸麦"失真来源。
- **v29**：Salamander 录音室鼓组全面替换——原鼓采样实测为 64kbps/24kHz 低码率 MP3（收音机音质，这就是"塑料感/难听"的根因）；从 GitHub 开源镜像引入 Alexander Holm 的 Salamander Drumkit（48k/24bit FLAC 真鼓录音，CC 开源可商用）：kick/snare/hihat/ride/crash 共 29 个采样，**力度分层（FF/F/P，P 层用真实 ghost 录音）+ 层内轮询**（真人鼓手手感）；所有声学风格（rock/jazz/bossa/afro/rnb/funk/soul/reggae）鼓组映射换真鼓，Hip-Hop/808 保留合成 808（曲风本体），brush/rim/打击乐保留；**节奏型/律动/Groove/swing 完全不变，只换发声采样**；加载器支持 .flac、按扩展名管理、重试只补缺。
