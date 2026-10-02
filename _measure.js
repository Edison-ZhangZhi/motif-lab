const fs=require('fs');
// 1. 每风格调度的总声部数（节点数≈声部数，手机 CPU 直接相关）
eval(fs.readFileSync('theory.js','utf8'));
eval(fs.readFileSync('cells.js','utf8'));
const code = fs.readFileSync('app.js','utf8');
// 截取到调度前需要的函数
eval(code.slice(0, code.indexOf('/* ---------- 走带调度')));
global.document={addEventListener(){},querySelector(){return null},querySelectorAll(){return[]},getElementById(){return null},createElement(){return null}};
global.window={addEventListener(){}}; global.navigator={};
state.layers.synth={on:true,vol:.45,patch:'halo'};
console.log('=== 每风格循环内调度的总声部数（=一次性创建的音频节点数）===');
for (const st of ['rnb','jazz','rock','bossa','afro']) {
  state.styles=[st]; state.motiveText='';
  const setup={rnb:{keys:'comp'},jazz:{keys:'comp'},rock:{keys:'auto'},bossa:{keys:'auto'},afro:{keys:'auto'}};
  state.layers.keys.patch=setup[st].keys;
  state.slots = PRESETS[0].slots.map(s=>({d:s.d,acc:s.acc||0,q:s.q}));
  state.keyRoot=9; state.mode='major';
  buildChordTimeline(); genMelody(); genBass(); genKeys(); genSynthPad(); genDrums();
  const keysNotes = keysEvents.reduce((a,e)=>a+e.notes.length,0);
  const padNotes = synthEvents.reduce((a,e)=>a+e.notes.length,0);
  const total = melodyEvents.length + bassEvents.length + keysNotes + padNotes + drumEvents.length;
  console.log(`${st}: 旋律${melodyEvents.length} 键${keysEvents.length}事件/${keysNotes}音 鼓${drumEvents.length} Pad${padNotes}音 → 共 ${total} 节点/循环`);
}
