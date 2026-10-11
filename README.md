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
