const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];
let sim=true,liveMode=false,started=Date.now(),calibrated=false,personN=2,gameRunning=false,gameOver=false,score=0,speed=5,obstacles=[],player={y:0,vy:0,grounded:true},lastFrame=0,camStream=null,camCanvas=document.createElement('canvas'),camCtx=camCanvas.getContext('2d',{willReadFrequently:true}),lastPixels=null,motionCooldown=0,animationId=null;
const toast=(m)=>{let t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)};
$('#dismissNotice').onclick=()=>$('.notice').remove();$('#themeInfo').onclick=()=>toast('ATHENA RF: واجهة أولية. البيانات الحالية محاكاة وليست قراءات حسّاس فعلية.');
const pages={overview:['مركز المراقبة الذكي','تصوّر تجريبي لاستشعار الحركة عبر تغيّرات إشارة Wi‑Fi'],room:['الغرفة ثلاثية الأبعاد','عرض مكاني توضيحي — لا يمثل إحداثيات مستشعرة'],game:['مختبر الإشارات واللعبة','جرّب التحكم بلوحة المفاتيح أو كاميرا الكمبيوتر'],devices:['الأجهزة ومسار البيانات','تجهيزات الاتصال والمعالجة والتدريب']};
$$('.nav').forEach(btn=>btn.onclick=()=>{ $$('.nav').forEach(n=>n.classList.toggle('active',n===btn));let v=btn.dataset.view;$('#pageTitle').textContent=pages[v][0];$('#pageDescription').textContent=pages[v][1];$('#overviewView').hidden=!(v==='overview'||v==='room');$('#peopleGrid').hidden=!(v==='overview'||v==='room');$('#gameView').hidden=v!=='game';$('#devicesView').hidden=v!=='devices';if(v==='room'){$('#roomStage').scrollIntoView({behavior:'smooth',block:'center'});$('#roomStage').classList.add('expanded')}else $('#roomStage').classList.remove('expanded');if(v==='game')drawGame(0);});
function drawMiniBars(){let el=$('#miniBars');el.innerHTML='';for(let i=0;i<22;i++){let n=document.createElement('i');n.style.height=(20+Math.random()*80)+'%';el.appendChild(n)}}
function drawSignalMini(){let el=$('#signalMini');let vals=Array.from({length:46},()=>10+Math.random()*80);el.innerHTML=`<svg width="100%" height="25" viewBox="0 0 300 25" preserveAspectRatio="none"><polyline fill="none" stroke="#50dcf4" stroke-width="1.5" points="${vals.map((v,i)=>`${i*300/(vals.length-1)},${25-v*.24}`).join(' ')}"/></svg>`}
function chart(){let c=$('#signalChart'),dpr=window.devicePixelRatio||1,w=c.clientWidth,h=245;c.width=w*dpr;c.height=h*dpr;let x=c.getContext('2d');x.scale(dpr,dpr);x.clearRect(0,0,w,h);x.strokeStyle='#1e344a';x.lineWidth=1;for(let i=0;i<6;i++){let y=12+i*(h-25)/5;x.beginPath();x.moveTo(4,y);x.lineTo(w-4,y);x.stroke()}for(let i=0;i<8;i++){let xx=8+i*(w-16)/7;x.beginPath();x.moveTo(xx,10);x.lineTo(xx,h-20);x.stroke()}const line=(color,amp,base,phase)=>{x.beginPath();x.strokeStyle=color;x.lineWidth=1.8;for(let i=0;i<w;i+=2){let val=base+Math.sin(i*.046+phase)*amp+Math.sin(i*.135+phase*1.7)*amp*.34+(Math.random()-.5)*amp*.17;let y=Math.min(h-20,Math.max(12,val));if(i===0)x.moveTo(i,y);else x.lineTo(i,y)}x.stroke()};line('#50dcf4',23,h*.44,Date.now()/1100);line('#ad8cff',19,h*.65,Date.now()/1600+2);x.fillStyle='#6e88a4';x.font='9px IBM Plex Mono';x.fillText('t −30s',4,h-4);x.fillText('NOW',w-30,h-4)}
function updateSim(){if(!sim||liveMode)return;let motion=Math.max(4,Math.min(95,Math.round(28+Math.sin(Date.now()/1800)*22+Math.random()*14)));$('#motionValue').innerHTML=motion+'<span class="unit">%</span>';$('#motionMeter').style.width=motion+'%';$('#motionLabel').textContent=motion>65?'مرتفع':motion>35?'متوسط':'منخفض';$('#rssiValue').innerHTML='−'+(43+Math.round(Math.random()*9))+' <span class="unit">dBm</span>';$('#variance').textContent=(.18+Math.random()*.7).toFixed(2);$('#samples').textContent=18+Math.round(Math.random()*5);$('#personCount').textContent=String(personN).padStart(2,'0');$('#uptime').textContent=new Date(Date.now()-started).toISOString().slice(11,19);$('#clock').textContent=new Date().toLocaleTimeString('en-GB');drawMiniBars();drawSignalMini();chart();let a=$('#avatarOne'),b=$('#avatarTwo');if(a)a.setAttribute('transform',`translate(${330+Math.sin(Date.now()/1300)*18} ${185+Math.cos(Date.now()/1000)*7})`);if(b)b.setAttribute('transform',`translate(${480+Math.sin(Date.now()/1700+2)*23} ${224+Math.cos(Date.now()/1200)*8})`);let rows=$$('.person-row');rows.forEach((r,i)=>{let val=Math.round(16+Math.abs(Math.sin(Date.now()/1600+i*2))*70);let b=r.querySelector('.person-metric b');if(b)b.textContent=val+'%';let pose=r.querySelector('.pose');if(pose)pose.firstChild.textContent=val>64?'مشي ':val>38?'حركة ':'واقف '});}
setInterval(updateSim,1000);window.addEventListener('resize',chart);drawMiniBars();drawSignalMini();chart();
$('#calibrate').onclick=()=>{let b=$('#calibrate');b.disabled=true;b.textContent='جارٍ المعايرة…';$('#calibText').textContent='جمع خط أساس تجريبي لمدة 3 ثوانٍ';setTimeout(()=>{calibrated=true;b.disabled=false;b.textContent='إعادة المعايرة';$('#calibText').textContent='اكتملت معايرة المحاكاة';toast('اكتملت معايرة العرض التجريبي؛ لم تُعاير إشارة CSI فعلية.')},3000)};
$('#roomExpand').onclick=()=>$('#roomStage').classList.toggle('expanded');$('#recenter').onclick=()=>{$('#avatarOne').setAttribute('transform','translate(345 185)');$('#avatarTwo').setAttribute('transform','translate(480 224)');toast('تمت إعادة ضبط المشهد التوضيحي')};$$('.room-control').forEach(b=>b.onclick=()=>{$$('.room-control').forEach(x=>x.classList.toggle('active',x===b));let s=$('#roomStage');s.classList.toggle('view-skeleton',b.dataset.room==='skeleton');s.classList.toggle('view-paths',b.dataset.room==='paths');toast(b.dataset.room==='heat'?'عرض تأثير الإشارة التوضيحي':b.dataset.room==='skeleton'?'عرض الهيكل الافتراضي':'عرض مسارات افتراضية')});
$('#addPerson').onclick=()=>{if(personN>=5){toast('الحد الأقصى في المحاكاة 5 أشخاص');return}personN++;let list=$('#personList'),r=document.createElement('div');r.className='person-row';r.innerHTML=`<div class="person-symbol ${personN%2?'cyan-symbol':'purple-symbol'}">${String(personN).padStart(2,'0')}</div><div class="person-details"><b>شخص افتراضي ${String(personN).padStart(2,'0')}</b><small>منطقة A · حالة تجريبية</small></div><span class="pose">واقف <i></i></span><div class="person-metric"><small>الحركة</small><b>20%</b></div><button class="kebab" aria-label="حذف الشخص">×</button>`;r.querySelector('.kebab').onclick=()=>{r.remove();personN--;$('#personCount').textContent=String(personN).padStart(2,'0')};list.appendChild(r);$('#personCount').textContent=String(personN).padStart(2,'0');toast('أُضيف عنصر افتراضي — ليس اكتشافًا من الحساس')};
// Dinosaur-style game. The game physics are local and keyboard/button controlled.
const gc=$('#gameCanvas'),gx=gc.getContext('2d');let gameWidth=900,gameHeight=300;
function drawGame(dt=0){let w=gc.clientWidth||900,h=300;gc.width=Math.round(w*(devicePixelRatio||1));gc.height=Math.round(h*(devicePixelRatio||1));gx.setTransform(gc.width/900,0,0,gc.height/300,0,0);gx.clearRect(0,0,900,300);let bg=gx.createLinearGradient(0,0,0,300);bg.addColorStop(0,'#0b1b2b');bg.addColorStop(1,'#0a1422');gx.fillStyle=bg;gx.fillRect(0,0,900,300);gx.fillStyle='#162b3f';for(let i=0;i<28;i++){let xx=(i*41-(gameRunning?score*2:0)%41);gx.fillRect(xx,32+(i*17)%80,2,2)}gx.strokeStyle='#2a475e';gx.lineWidth=2;gx.beginPath();gx.moveTo(0,244);gx.lineTo(900,244);gx.stroke();gx.strokeStyle='#203c53';gx.setLineDash([9,10]);gx.beginPath();gx.moveTo(0,263);gx.lineTo(900,263);gx.stroke();gx.setLineDash([]);
// player pixel dinosaur
let py=244-player.y;gx.fillStyle='#58d9eb';gx.fillRect(95,py-38,24,27);gx.fillRect(110,py-52,19,20);gx.fillRect(124,py-45,14,8);gx.fillStyle='#0b1826';gx.fillRect(122,py-47,3,3);gx.fillStyle='#58d9eb';if(player.grounded){let leg=(Math.floor(Date.now()/110)%2);gx.fillRect(99,py-12,7,12);gx.fillRect(111+(leg?3:0),py-12,7,12)}else{gx.fillRect(100,py-12,7,11);gx.fillRect(114,py-8,7,7)}gx.fillRect(87,py-31,10,5);
if(gameRunning){if(Date.now()>motionCooldown&&Math.random()<.012){obstacles.push({x:920,w:16+Math.random()*10,h:21+Math.random()*22})}obstacles.forEach(o=>{o.x-=speed;gx.fillStyle='#a58bff';gx.fillRect(o.x,244-o.h,o.w,o.h);gx.fillRect(o.x-4,244-o.h+9,4,7)});obstacles=obstacles.filter(o=>o.x>-40);if(player.y>0||player.vy!==0){player.y+=player.vy;player.vy-=.68;if(player.y<=0){player.y=0;player.vy=0;player.grounded=true}}score+=dt*.007;$('#score').textContent=String(Math.floor(score)).padStart(5,'0');for(let o of obstacles){if(o.x<119&&o.x+o.w>92&&player.y<o.h-2){gameRunning=false;gameOver=true;$('#gameOverlay').textContent='انتهت الجولة — اضغط ابدأ لإعادة اللعب';$('#gameOverlay').style.display='grid';break}}speed=Math.min(9,5+score/1500)}else {obstacles=[];player={y:0,vy:0,grounded:true};}if(gameRunning)animationId=requestAnimationFrame(t=>{let delta=t-lastFrame;lastFrame=t;drawGame(delta)});}
function jump(){if(gameRunning&&player.grounded){player.vy=11;player.grounded=false}}function startGame(){score=0;speed=5;obstacles=[];gameOver=false;gameRunning=true;lastFrame=performance.now();$('#gameOverlay').style.display='none';$('#startGame').textContent='↻ إعادة اللعبة';cancelAnimationFrame(animationId);animationId=requestAnimationFrame(t=>{lastFrame=t;drawGame(16)})}
$('#startGame').onclick=()=>startGame();$('#jumpButton').onclick=jump;window.addEventListener('keydown',e=>{if((e.code==='Space'||e.code==='ArrowUp')&&!$('#gameView').hidden){e.preventDefault();if(!gameRunning)startGame();else jump()}});drawGame();
// Optional local-only camera motion trigger (pixel-difference detector, not AI pose tracking).
$('#cameraButton').onclick=async()=>{if(camStream){camStream.getTracks().forEach(t=>t.stop());camStream=null;$('#motionVideo').hidden=true;$('#cameraButton').textContent='◎ تفعيل كاميرا الحركة';$('#cameraState').textContent='الكاميرا متوقفة — لا يتم رفع الفيديو أو حفظه';lastPixels=null;toast('تم إيقاف الكاميرا');return}try{camStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:320,height:240},audio:false});let v=$('#motionVideo');v.srcObject=camStream;v.hidden=false;await v.play();camCanvas.width=64;camCanvas.height=48;$('#cameraButton').textContent='■ إيقاف الكاميرا';$('#cameraState').textContent='الكاميرا تعمل محليًا — حرّك جسمك أمام العدسة لتجربة قفز تقريبي';toast('بدأت معالجة فرق الإطارات محليًا');detectCameraMotion()}catch(e){toast('تعذر تشغيل الكاميرا. افتح الواجهة عبر localhost واسمح بإذن الكاميرا.');$('#cameraState').textContent='تعذر الوصول للكاميرا: راجع إذن المتصفح أو استخدم Space.'}};
function detectCameraMotion(){if(!camStream)return;let v=$('#motionVideo');if(v.readyState>=2){camCtx.drawImage(v,0,0,64,48);let dat=camCtx.getImageData(0,0,64,48).data;let cur=[];let diff=0;if(lastPixels){for(let i=0,j=0;i<dat.length;i+=4,j++){let gray=(dat[i]*.3+dat[i+1]*.59+dat[i+2]*.11);cur.push(gray);diff+=Math.abs(gray-lastPixels[j])}}else {for(let i=0;i<dat.length;i+=4)cur.push(dat[i]*.3+dat[i+1]*.59+dat[i+2]*.11)}lastPixels=cur;let amount=diff/cur.length;if(amount>18&&Date.now()>motionCooldown){motionCooldown=Date.now()+1000;if(!gameRunning)startGame();else jump();$('#cameraState').textContent=`تم رصد تغيّر بصري عام (${Math.round(amount)}) — تحكم تجريبي، وليس تتبع وضعية AI.`}}setTimeout(detectCameraMotion,100)}
window.addEventListener('beforeunload',()=>{if(camStream)camStream.getTracks().forEach(t=>t.stop())});

// Public hooks used by live.js. In hardware mode we never overlay simulated values.
window.athenaSetLiveMode = (enabled) => {
  liveMode = !!enabled;
  sim = !liveMode;
  if (liveMode) {
    const stat = document.querySelector('.stat-card .trend');
    if (stat) stat.textContent = 'غير متاح في الإصدار 0.2';
    const noticeTitle = document.querySelector('.notice b');
    const noticeBody = document.querySelector('.notice div span');
    if (noticeTitle) noticeTitle.textContent = 'تنبيه: المشهد والأشخاص ما زالوا افتراضيين';
    if (noticeBody) noticeBody.textContent = 'قد يعرض الرسم عينات CSI فعلية عند وصولها؛ لكن العدد والموقع والوضعية والنبض والتنفس غير مقاسة في هذا الإصدار.';
    const roomCopy = document.querySelector('.room-panel .panel-head p');
    if (roomCopy) roomCopy.textContent = 'مشهد ثلاثي الأبعاد للواجهة فقط — لا يعرض إحداثيات مستشعرة';
    const roomChip = document.querySelector('.room-panel .live-chip');
    if (roomChip) roomChip.textContent = 'LAYOUT DEMO';
    const signalTitle = document.querySelector('.signal-panel .panel-head h2');
    if (signalTitle) signalTitle.textContent = 'تحليل CSI';
    const countFoot = document.querySelector('#personCount')?.closest('.stat-card')?.querySelector('.stat-foot');
    if (countFoot) countFoot.innerHTML = 'العدّ <span>غير متاح</span>';
    const motionFoot = document.querySelector('#motionValue')?.closest('.stat-card')?.querySelector('.stat-foot');
    if (motionFoot) motionFoot.innerHTML = 'درجة تصنيف النشاط <span>غير معايرة</span>';
    const rssiLabel = document.querySelector('#rssiValue')?.closest('.stat-card')?.querySelector('.stat-top span');
    if (rssiLabel) rssiLabel.textContent = 'قوة إشارة الحزمة المستقبلة';
    const topStatus = document.querySelector('#statusText');
    if (topStatus) topStatus.textContent = 'وضع البيانات الحقيقية';
    const head = document.querySelector('.signal-panel .panel-head p');
    if (head) head.textContent = 'عينات سعة CSI من ESP32-S3؛ ليست خريطة أشخاص.';
  } else {
    const topStatus = document.querySelector('#statusText');
    if (topStatus) topStatus.textContent = 'بيانات تجريبية';
    const noticeTitle = document.querySelector('.notice b');
    const noticeBody = document.querySelector('.notice div span');
    if (noticeTitle) noticeTitle.textContent = 'وضع المحاكاة مفعّل';
    if (noticeBody) noticeBody.textContent = 'الأرقام والحركة المعروضة تجريبية وليست قياسات حقيقية من القطعة. استخدم وضع البيانات الحقيقية لفحص اتصال CSI.';
    const head = document.querySelector('.signal-panel .panel-head p');
    if (head) head.textContent = 'رسم توضيحي للميزات — ليس CSI حقيقيًا';
    const roomCopy = document.querySelector('.room-panel .panel-head p');
    if (roomCopy) roomCopy.textContent = 'تصور إيزومتري — أشخاص افتراضيون';
    const roomChip = document.querySelector('.room-panel .live-chip');
    if (roomChip) roomChip.textContent = 'DEMO LIVE';
    const signalTitle = document.querySelector('.signal-panel .panel-head h2');
    if (signalTitle) signalTitle.textContent = 'تحليل الإشارة';
    const countFoot = document.querySelector('#personCount')?.closest('.stat-card')?.querySelector('.stat-foot');
    if (countFoot) countFoot.innerHTML = 'تقدير المحاكاة <span>ليس اكتشافًا فعليًا</span>';
    const motionFoot = document.querySelector('#motionValue')?.closest('.stat-card')?.querySelector('.stat-foot');
    if (motionFoot) motionFoot.innerHTML = 'مؤشر الحركة <span>0–100</span>';
    const rssiLabel = document.querySelector('#rssiValue')?.closest('.stat-card')?.querySelector('.stat-top span');
    if (rssiLabel) rssiLabel.textContent = 'قوة الإشارة التجريبية';
    const stat = document.querySelector('.stat-card .trend');
    if (stat) stat.textContent = '● نموذج تجريبي';
  }
};
window.athenaSetLiveState = (d) => {
  if (!d) return;
  const setText = (selector, value) => { const el = document.querySelector(selector); if (el) el.textContent = value; };
  setText('#liveFrames', String(d.frames_total ?? 0));
  setText('#recordedFrames', String(d.recording_frames ?? 0));
  setText('#mlModelState', d.model_loaded ? 'نموذج محمّل' : 'لا يوجد نموذج مُدرّب');
  const tag = document.querySelector('#modelTag');
  if (tag) tag.textContent = d.model_loaded ? 'MODEL LOADED' : 'MODEL NOT TRAINED';
  const framesAge = d.last_frame_age_s;
  const fresh = !!d.device_seen && framesAge != null && framesAge < 3;
  setText('#statusText', fresh ? (d.model_loaded ? 'CSI مباشر · نموذج جاهز' : 'CSI مباشر · بدون نموذج') : 'الخدمة متصلة · في انتظار CSI');
  setText('#connectionState', fresh ? 'CSI تستقبل' : 'في انتظار CSI');
  const onlineWord = document.querySelector('.online-word'); if (onlineWord) onlineWord.textContent = fresh ? 'متصل' : 'ينتظر';
  setText('#rssiValue', d.rssi_dbm == null ? '—' : `${d.rssi_dbm} dBm`);
  setText('#sourceName', fresh ? `ESP32-S3 · قناة ${d.channel ?? '—'}` : 'ESP32-S3 · لا توجد عينات حديثة');
  setText('#variance', d.amplitude_variance == null ? '—' : Number(d.amplitude_variance).toFixed(2));
  setText('#samples', Number(d.packet_rate_hz || 0).toFixed(1));
  setText('#personCount', '—');
  setText('#motionValue', '—');
  setText('#motionLabel', d.activity || (d.model_loaded ? 'في انتظار البيانات' : 'غير متاح — يحتاج تدريبًا'));
  const meter = document.querySelector('#motionMeter');
  if (meter) meter.style.width = d.model_confidence == null ? '0%' : `${Math.max(0,Math.min(100,Number(d.model_confidence)*100))}%`;
  const chartTag = document.querySelector('.signal-panel .tag');
  if (chartTag) chartTag.textContent = fresh ? 'CSI LIVE' : 'WAITING FOR CSI';
  const plot = document.querySelector('#signalChart');
  if (plot && Array.isArray(d.features) && d.features.length) {
    const ratio = window.devicePixelRatio || 1, w = plot.clientWidth || 600, h = 245;
    plot.width = Math.round(w * ratio); plot.height = Math.round(h * ratio);
    const ctx = plot.getContext('2d'); ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,w,h);
    ctx.strokeStyle = '#1e344a'; ctx.lineWidth = 1;
    for (let i=0;i<6;i++){const y=12+i*(h-25)/5;ctx.beginPath();ctx.moveTo(4,y);ctx.lineTo(w-4,y);ctx.stroke();}
    const vals=d.features.map(Number), max=Math.max(...vals,1), min=Math.min(...vals,0), span=Math.max(max-min,1);
    ctx.beginPath();ctx.strokeStyle='#50dcf4';ctx.lineWidth=1.8;
    vals.forEach((v,i)=>{const x=8+i*(w-16)/Math.max(vals.length-1,1),y=h-22-((v-min)/span)*(h-42);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
    ctx.fillStyle='#6e88a4';ctx.font='9px monospace';ctx.fillText('CSI amplitude · current frame',4,h-4);
  }
};
