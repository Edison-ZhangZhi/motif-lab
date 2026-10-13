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
- **v30**：鼓融合修复——① 响度回归：头顶麦采样增益 1.5-1.7 → 0.8-1.0（太响压过其他声部）；② 立体声头顶麦下混成单声道——自带房间+鼓间串音是"不融合"主因，空间改由混音链统一给（像真实混音叠 close-mic 鼓件）；③ 混响发送再减（sendDrums 0.12→0.08、房间胶 0.26→0.18，采样自带房间）；④ 律动优先：鼓主压缩 -14/3→-12/2.5、并行碾碎副本 0.35→0.3——律动靠动态对比，压平了只剩响度。
- **v31**：残余塑料感清零——① 贝斯：弃 GM 指弹贝斯（25 年前采样=贝斯塑料感主犯），接入 tonejs-instruments bass-electric 真实电贝斯采样（17 音小三度网格就近映射+同音轮询+力度联动亮度，GM 保留兜底）；② Pad：弃全部 GM 合唱/弦乐垫（塑料重灾区），改用内置 Juno 式合成垫（supersaw+移相+合唱，风格差异仍由 padFilter 低通/PAD_BY_STYLE 保留），不再下载解码 GM pad（启动更快）；③ 键盘：hiphop/reggae 弃 GM polysynth 铺 → FM tine。吉他 Karoryfer 真采样保持不变。
- **v32**：编曲融合度修复——诊断脚本实测各风格"声部对齐"：① 贝斯锁鼓窗口 ±60ms→十六分音符（实测贝斯距底鼓均值 148ms，两张节奏图=低音区"各弹各的"主因；rnb 锁鼓率 21%→58%、funk 38%→70%、soul 39%→57%、afrobeats 30%→74%；afro/reggae 的刻意错位保留）；② 微时值引擎全部减半、军鼓拖拍减半（真鼓头顶麦采样瞬态偏慢，叠加旧偏移听感"鼓点对不上"；收紧=贴当代流行量化标准）；③ 鼓抖动 ±8→±5ms；④ 键盘避让旋律窗口保持 ±60ms（避免过度挪位）。
- **v33**：风格指纹审计 + Neo-Soul 校正——风格指纹提取实测：各风格鼓型/贝斯型/comp 节奏/和声与真身谱面对齐（rnb 贝斯 5 音/小节留白、jazz 4 音/小节 walking、bossa root-5 two-feel、reggae one-drop 等均正确）；唯一不符：rnb/soul 的 kick 用房间声学鼓（摇滚 punch），而 Neo-Soul 真身（Best Part/Lovely Day）是软圆闷的"枕头底鼓"→ 新增 pillow 档（3.6k 低通+短衰减+减力度），rnb/soul 的 kick 走枕头处理、军鼓稍收；叠加 808 次低音层=圆润真底鼓。
- **v34**：RnB 完全 Neo-Soul 化（参考当代 Neo-Soul 编曲语言）——① 鼓型：kick 1+2&+3e（0/7/10 步 Questlove 式切分），ghost 网加密（6/9/14/15 步）；② 贝斯型重写：sub 本位、3-4 音/小节、根音长音+3& 五音+4& 趋近（删除八度弹跳），增益 1.1→0.9（"感到"而非"听到"），锁鼓率实测升至 69%；③ Rhodes comp 全部改反拍（"&"上呼吸，正拍留给贝斯/鼓）；④ Pad 存在度 0.42→0.26（空间来自留白）；⑤ swing 10→12（57% 摇摆 16 分）；⑥ 和声加 7#9（Hendrix 和弦签名）；⑦ 贝斯低通更暗（sub 感）。
- **v35**：Jazz 复活 + Rock 卡顿 + RnB 和声学方大同——① "jazz 只有贝斯声"根因：jazz/bossa 吉他还走 GM 老采样（气若游丝）+ FM 颤音琴 -4dB + 鼓全 feather 力度 → 吉他改真采样、颤音琴 -4→-2、feather 0.3→0.45、军鼓 35%→55%、ride 提量，全部"轻但可闻"；② rock 卡顿：主链软削波去掉 2x 过采样（全混音 CPU 减半）；③ RnB 和声学方大同：默认走向从 ♭VII 漂移（Best Part 式，旋律难跟=听感"怪异"）换 **Ⅰmaj9-Ⅴ13-ⅵm9-Ⅳmaj9（《Love Song》1-5-6-4 语法）**，新增 rnb-fong 预设，漂移预设保留可选。
- **v36**：Bossa 十首经典重做 + RnB 十首参考补织体——① Bossa（参考 Ipanema/Corcovado/Desafinado/Chega de Saudade/Wave/One Note Samba/Águas de Março/Meditação/Triste/Summer Samba）：surdo kick 改只打 1/3 拍（去掉 2&/4& 前导）、rim 改标准 3-2 bossa clave（1& 2 2& 3& 4 = 步 2/4/6/10/12）、键盘/尼龙吉他改 João Gilberto batida（根音 1/3 长音 + 2&/3&/4& 和弦刺、根音亮刺轻）、互锁挪位对 bossa 豁免（batida 根音钉死）；② RnB（参考 Best Part/Untitled/Heartbreak Anniversary/Snooze/On & On/Brown Sugar/Love Song/Easy/Focus/Japanese Denim）：新增 clean 吉他和弦垫层（Rhodes 背后 1-2 刺/小节）——十首参考曲的共性织体；③ 所有 guitar: comp 层（rock 强力和弦/afro chop/rnb 吉他层）播放改为真采样优先，GM 只兜底。
- **v37**：现代 RnB/Soul 各声部综合升级（按 2026 trapsoul 制作规范对比后改动）——① 新增 **sub 层**：rnb/soul 真贝斯下方垫 -12 正弦（808 式低音质，Giveon/SZA 系；与 kick 侧链式闪避同步）；② rnb 新增 **e/ah 轻 16 分 ghost 帽**（力度 0.24-0.32，现代 trapsoul 滚奏织感）；③ soul 同步获得吉他和弦垫层 + Pad 存在度 0.50→0.35（现代福音灵魂更收敛）；④ 规范对照结论：kick 稀疏 1/3 拍 ✓（rnb 0/7/10 切分版）、snare 2/4+rim 叠层 ✓、和弦小调七和弦+转位展开 ✓、Rhodes 反拍 ✓、swing 10-15% ✓。
- **v38**：Neo-Soul 和声规范重做（学自 eMastered Neo-Soul 教程）——① voicing 修正：rnb 从"无根音 3-7-9 漂浮音簇"（爵士大编制 comping 语汇=小编制里"和声不对"的主因）改为**有根 shell（根-3-7-9，省五音保根）**——教程规范：shell 和弦保留和声锚点；② 默认走向换 **ⅱm9–Ⅴ13–Ⅰmaj9–ⅵm9（2-5-1-6，Isn't She Lovely/Stevie Wonder 语法）**——Neo-Soul 教科书走向，替换流行 RnB 的 1-5-6-4；③ 新增「Fallin' 式 ⅰ-ⅳ-ⅴ 小调」预设（Alicia Keys 语法）；1-5-6-4（方大同）、♭VII 漂移（Best Part）保留可选。
