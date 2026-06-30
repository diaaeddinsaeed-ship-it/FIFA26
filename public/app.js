// =====================================================================
// تحدي ضياء — كأس العالم 2026 — Frontend
// كل النقاط تُحسب تلقائياً من السيرفر بناءً على نتائج حقيقية من الإنترنت
// =====================================================================

var API = ""; // same-origin, served by our own server

// R32 fixture names are fetched dynamically from the server (which resolves
// "best 3rd place" slots automatically once group stage results are known).

var FL={
  "ألمانيا":"🇩🇪","فرنسا":"🇫🇷","إسبانيا":"🇪🇸","البرتغال":"🇵🇹","هولندا":"🇳🇱",
  "بلجيكا":"🇧🇪","إنجلترا":"🏴","كرواتيا":"🇭🇷","السويد":"🇸🇪","النرويج":"🇳🇴",
  "سويسرا":"🇨🇭","النمسا":"🇦🇹","البرازيل":"🇧🇷","الأرجنتين":"🇦🇷","كولومبيا":"🇨🇴",
  "المكسيك":"🇲🇽","الولايات المتحدة":"🇺🇸","كندا":"🇨🇦","اليابان":"🇯🇵",
  "أستراليا":"🇦🇺","المغرب":"🇲🇦","السنغال":"🇸🇳","مصر":"🇪🇬","غانا":"🇬🇭",
  "كوت ديفوار":"🇨🇮","جنوب أفريقيا":"🇿🇦","الرأس الأخضر":"🇨🇻","الجزائر":"🇩🇿",
  "الكونغو الديمقراطية":"🇨🇩","باراغواي":"🇵🇾","البوسنة والهرسك":"🇧🇦","الإكوادور":"🇪🇨",
  "كوريا الجنوبية":"🇰🇷","جمهورية التشيك":"🇨🇿","قطر":"🇶🇦","اسكتلندا":"🏴",
  "هايتي":"🇭🇹","تركيا":"🇹🇷","كوراساو":"🇨🇼","اليابان":"🇯🇵","تونس":"🇹🇳",
  "إيران":"🇮🇷","نيوزيلندا":"🇳🇿","السعودية":"🇸🇦","أوروغواي":"🇺🇾","النرويج":"🇳🇴",
  "الأردن":"🇯🇴","أوزبكستان":"🇺🇿","بنما":"🇵🇦"
};
function fl(t){return FL[t]||"🏳";}

var ROUNDS=["r32","r16","qf","sf","final"];
var RNAMES={r32:"دور الـ32",r16:"دور الـ16",qf:"ربع النهائي",sf:"نصف النهائي",final:"النهائي"};
var SAVE_KEY="diaa_wc2026_userid";

// ================================================================
// STATE
// ================================================================
function genUserId(){
  return "u"+Date.now()+"_"+Math.random().toString(36).substr(2,9);
}
function getUserId(){
  var id = localStorage.getItem(SAVE_KEY);
  if(!id){ id = genUserId(); localStorage.setItem(SAVE_KEY, id); }
  return id;
}

var S = {
  userId: getUserId(),
  phase:"intro", userName:"", userPhoto:null, locked:false,
  preds:{r32:[],r16:[],qf:[],sf:[],final:[]},
  liveResults:{r32:[],r16:[],qf:[],sf:[],final:[]},
  score:{pts:0,correct:0,total:0,details:[]},
  lastFetch:null,
  leaderboard:[]
};

// ================================================================
// SERVER COMMUNICATION
// ================================================================
function apiGet(url, cb){
  var xhr = new XMLHttpRequest();
  xhr.open("GET", url, true);
  xhr.onreadystatechange = function(){
    if(xhr.readyState !== 4) return;
    try{
      var data = JSON.parse(xhr.responseText);
      cb(null, data);
    }catch(e){ cb(e); }
  };
  xhr.onerror = function(){ cb(new Error("network error")); };
  xhr.send();
}
function apiPost(url, body, cb){
  var xhr = new XMLHttpRequest();
  xhr.open("POST", url, true);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.onreadystatechange = function(){
    if(xhr.readyState !== 4) return;
    try{
      var data = JSON.parse(xhr.responseText);
      cb(null, data);
    }catch(e){ cb(e); }
  };
  xhr.onerror = function(){ cb(new Error("network error")); };
  xhr.send(JSON.stringify(body));
}

function showBar(state, msg){
  var b = document.getElementById("nbar");
  b.className = state; b.style.display = "flex"; b.innerHTML = "";
  if(state === "syncing"){ var sp=document.createElement("div"); sp.className="spinner"; b.appendChild(sp); }
  var tx = document.createElement("span"); tx.textContent = " " + msg; b.appendChild(tx);
  if(state !== "syncing"){ setTimeout(function(){ b.style.display="none"; }, 4000); }
}

// ================================================================
// SYNC RESULTS FROM SERVER (which fetches from internet automatically)
// ================================================================
function syncResults(silent){
  if(!silent) showBar("syncing", "🔄 يتم تحديث النتائج...");
  apiGet(API + "/api/results", function(err, data){
    if(err || !data.success){
      if(!silent) showBar("err", "❌ خطأ في الاتصال بالسيرفر");
      return;
    }
    S.liveResults = data.results;
    S.lastFetch = data.lastFetch;
    saveAndPushScore();
    render();
    if(!silent) showBar("ok", "✅ تم التحديث");
  });
}

function saveAndPushScore(){
  // Push our predictions to server, get back computed score
  apiPost(API + "/api/predictions/" + S.userId, {
    userName: S.userName,
    userPhoto: S.userPhoto,
    preds: S.preds,
    locked: S.locked
  }, function(err, data){
    if(err) return;
    // Now fetch our score
    apiGet(API + "/api/predictions/" + S.userId, function(err2, data2){
      if(err2 || !data2.success || !data2.score) return;
      S.score = data2.score;
      updateBanner();
    });
  });
}

function loadFromServer(cb){
  apiGet(API + "/api/predictions/" + S.userId, function(err, data){
    if(!err && data && data.success && data.user){
      S.userName = data.user.userName || "";
      S.userPhoto = data.user.userPhoto || null;
      S.preds = data.user.preds || S.preds;
      S.locked = !!data.user.locked;
      if(data.score) S.score = data.score;
    }
    if(cb) cb();
  });
}

function loadLeaderboard(cb){
  apiGet(API + "/api/leaderboard", function(err, data){
    if(!err && data && data.success){
      S.leaderboard = data.leaderboard;
    }
    if(cb) cb();
  });
}

// Auto-sync every 2 minutes
function startAutoSync(){
  setInterval(function(){ syncResults(true); }, 2*60*1000);
}

// ================================================================
// LOCAL STORAGE BACKUP (in case server data not loaded yet)
// ================================================================
function saveLocal(){
  try{
    localStorage.setItem("diaa_wc2026_backup", JSON.stringify({
      userName:S.userName, userPhoto:S.userPhoto, preds:S.preds, locked:S.locked
    }));
  }catch(e){}
}
function loadLocalBackup(){
  try{
    var raw = localStorage.getItem("diaa_wc2026_backup");
    if(!raw) return;
    var d = JSON.parse(raw);
    if(d.userName) S.userName = d.userName;
    if(d.userPhoto) S.userPhoto = d.userPhoto;
    if(d.preds) S.preds = d.preds;
    if(d.locked) S.locked = d.locked;
  }catch(e){}
}

function initR32(){
  if(S.preds.r32.length === 0){
    for(var i=0;i<16;i++){
      S.preds.r32.push({h:"؟",a:"؟",pick:""});
    }
  }
}

function loadFixtures(cb){
  apiGet(API + "/api/fixtures", function(err, data){
    if(!err && data && data.success && data.fixtures){
      data.fixtures.forEach(function(f, i){
        if(S.preds.r32[i] && !S.preds.r32[i].pick){
          // Only update names if not already picked (preserve user's locked-in matches)
          S.preds.r32[i].h = f.h;
          S.preds.r32[i].a = f.a;
          S.preds.r32[i].d = f.date;
        } else if(S.preds.r32[i]){
          S.preds.r32[i].d = f.date;
        }
      });
    }
    if(cb) cb();
  });
}

function save(){
  saveLocal();
  saveAndPushScore();
}

// ================================================================
// SCORE DISPLAY (computed server-side, just display here)
// ================================================================
function updateBanner(){
  document.getElementById("bnPts").textContent = S.score.pts;
  document.getElementById("bnCor").textContent = S.score.correct + "/" + S.score.total;
  var fc = S.preds.final[0];
  document.getElementById("bnChamp").textContent = (fc && fc.pick) ? fc.pick : "؟";
}

function allPicked(arr){
  if(!arr || arr.length===0) return false;
  for(var i=0;i<arr.length;i++){ if(!arr[i] || !arr[i].pick) return false; }
  return true;
}

function rebuildNext(from){
  var toMap={r32:"r16",r16:"qf",qf:"sf",sf:"final"};
  var toKey=toMap[from]; if(!toKey) return;
  var src=S.preds[from]||[];
  var ex=S.preds[toKey]||[];
  var next=[];
  for(var i=0;i<src.length;i+=2){
    var h=src[i]&&src[i].pick?src[i].pick:"؟";
    var a=src[i+1]&&src[i+1].pick?src[i+1].pick:"؟";
    var old=ex[next.length]||{};
    var pick=(old.pick&&(old.pick===h||old.pick===a))?old.pick:"";
    next.push({h:h,a:a,pick:pick});
  }
  S.preds[toKey]=next;
}
function rebuildAll(){ rebuildNext("r32"); rebuildNext("r16"); rebuildNext("qf"); rebuildNext("sf"); }

function go(ph){
  S.phase = ph;
  save();
  if(ph === "leaderboard") loadLeaderboard(render);
  else render();
}

// ================================================================
// DOM HELPERS
// ================================================================
function el(tag,cls,txt){ var e=document.createElement(tag); if(cls)e.className=cls; if(txt!==undefined)e.textContent=txt; return e; }
function btn(cls,txt,fn){ var b=el("button",cls,txt); if(fn)b.onclick=fn; return b; }

// ================================================================
// RENDER
// ================================================================
function render(){
  updateBanner(); renderHeader(); renderTabs();
  var wrap = document.getElementById("wrap"); wrap.innerHTML = "";
  var ph = S.phase;
  if(ph==="intro") renderIntro(wrap);
  else if(ph==="r32") renderRound(wrap,"r32");
  else if(ph==="r16") renderRound(wrap,"r16");
  else if(ph==="qf") renderRound(wrap,"qf");
  else if(ph==="sf") renderRound(wrap,"sf");
  else if(ph==="final") renderFinal(wrap);
  else if(ph==="leaderboard") renderLeaderboard(wrap);
}

function renderHeader(){
  var h = document.getElementById("hdr"); h.innerHTML = "";
  if(S.userName){
    var row = el("div","hrow");
    if(S.userPhoto){
      var img=document.createElement("img"); img.src=S.userPhoto;
      img.style.cssText="width:28px;height:28px;border-radius:50%;object-fit:cover;border:1.5px solid #C9A84C";
      row.appendChild(img);
    }
    var tx=el("div");
    tx.appendChild(el("div","htitle","🏆 "+S.userName));
    tx.appendChild(el("div","hsub","تحدي ضياء · كأس العالم 2026"));
    row.appendChild(tx); h.appendChild(row);
  }else{
    h.appendChild(el("div","htitle","⚽ تحدي ضياء — كأس العالم 2026"));
    h.appendChild(el("div","hsub","الأدوار الإقصائية · 32 فريق"));
  }
}

function renderTabs(){
  var tabsEl = document.getElementById("tabs"); tabsEl.innerHTML = "";
  var keys = ["intro","r32","r16","qf","sf","final","leaderboard"];
  var lbls = {"intro":"👤","r32":"دور32","r16":"دور16","qf":"ربع","sf":"نصف","final":"🏆","leaderboard":"📊 الترتيب"};
  for(var i=0;i<keys.length;i++){
    var k = keys[i];
    var done = k!=="leaderboard" && allPicked(S.preds[k]);
    var isActive = S.phase === k;
    var t = el("button","tab"+(isActive?" active":"")+(done&&!isActive?" done":""));
    t.textContent = (done&&!isActive?"✓ ":"")+lbls[k];
    (function(key){ t.onclick=function(){ go(key); }; })(k);
    tabsEl.appendChild(t);
  }
}

// ================================================================
// INTRO
// ================================================================
function renderIntro(wrap){
  var card = el("div","card"); card.appendChild(el("div","chd","👤 معلوماتي"));
  var cbd = el("div","cbd");
  cbd.appendChild(el("span","lbl","صورتي (اختياري)"));
  var prow = el("div"); prow.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:14px";
  var circ = el("div","pcircle");
  if(S.userPhoto){ var img=document.createElement("img"); img.src=S.userPhoto; circ.appendChild(img); }
  else { circ.appendChild(el("span",null,"📷")); }
  var finp = document.createElement("input"); finp.type="file"; finp.accept="image/*";
  finp.onchange = function(){
    var file=this.files[0]; if(!file) return;
    var r=new FileReader();
    r.onload=function(){ S.userPhoto=r.result; save(); render(); };
    r.readAsDataURL(file);
  };
  circ.appendChild(finp); prow.appendChild(circ);
  var ptxt = el("div");
  ptxt.appendChild(el("div",null,"اضغط لاختيار صورة")).style.cssText="font-size:12px;color:#8899AA";
  if(S.userPhoto){
    var delB = btn(null,"✕ حذف",function(){ S.userPhoto=null; save(); render(); });
    delB.style.cssText = "font-size:11px;color:#ff6b6b;background:none;border:none;cursor:pointer;padding:0;margin-top:4px;font-family:inherit";
    ptxt.appendChild(delB);
  }
  prow.appendChild(ptxt); cbd.appendChild(prow);
  cbd.appendChild(el("span","lbl","اسمك"));
  var ninp = document.createElement("input"); ninp.type="text"; ninp.value=S.userName; ninp.placeholder="مثال: ضياء الدين سعيد";
  ninp.oninput = function(){ S.userName=this.value; save(); renderHeader(); };
  cbd.appendChild(ninp); card.appendChild(cbd); wrap.appendChild(card);

  var info = el("div","infobox");
  info.innerHTML = "<b style='color:#C9A84C'>⚽ قواعد التحدي:</b><br>"+
    "✅ توقعك صح = <b style='color:#E8E8E8'>2 نقطة</b><br>"+
    "🔄 الفريق الصح بس جاء بديلاً = <b style='color:#FFD700'>1 نقطة</b><br>"+
    "❌ توقعك غلط = 0 نقطة<br>"+
    "🤖 النتائج والنقاط تُحدّث تلقائياً من الإنترنت — بدون أي تدخل بشري";
  wrap.appendChild(info);

  if(S.lastFetch){
    var ls = el("div",null,"آخر تحديث للنتائج: "+new Date(S.lastFetch).toLocaleString("ar"));
    ls.style.cssText = "font-size:11px;color:#4CAF50;text-align:center;margin-bottom:8px";
    wrap.appendChild(ls);
  }
  wrap.appendChild(btn("btn btnsync","🔄 تحديث النتائج الآن",function(){ syncResults(false); }));
  if(S.locked) wrap.appendChild(el("div","lkbanner","🔒 توقعاتك محفوظة ومقفولة"));
  wrap.appendChild(btn("btn btng","ابدأ التوقعات ← دور الـ32",function(){ go("r32"); }));
  wrap.appendChild(btn("btn","📊 شوف ترتيب كل المشاركين",function(){ go("leaderboard"); }));
}

// ================================================================
// ROUND
// ================================================================
function renderRound(wrap,key){
  var matches = S.preds[key] || [];
  var actual = S.liveResults[key] || [];
  var isLocked = S.locked;
  var nextMap={r32:"r16",r16:"qf",qf:"sf",sf:"final"};
  var prevMap={r16:"r32",qf:"r16",sf:"qf"};
  var nextKey=nextMap[key]; var prevKey=prevMap[key];
  var done = allPicked(matches);
  var pickedCnt=0; for(var pi=0;pi<matches.length;pi++){ if(matches[pi]&&matches[pi].pick) pickedCnt++; }

  if(isLocked) wrap.appendChild(el("div","lkbanner","🔒 توقعاتك مقفولة — لا يمكن التعديل"));
  var hrow = el("div"); hrow.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px";
  var hl = el("span",null,RNAMES[key]+" — "+matches.length+" مباراة"); hl.style.cssText="font-size:12px;color:#8899AA";
  var hr = el("span",null,pickedCnt+"/"+matches.length); hr.style.cssText="font-size:12px;color:"+(done?"#4CAF50":"#C9A84C");
  hrow.appendChild(hl); hrow.appendChild(hr); wrap.appendChild(hrow);

  for(var i=0;i<matches.length;i++){
    var m = matches[i]; var act = actual[i] || "";
    var hasAct = act !== ""; var isCor = hasAct && m.pick === act; var isWrong = hasAct && m.pick && !isCor;
    var locked = isLocked || hasAct;
    var mc = el("div","mc"+(m.pick?" picked":""));
    var mhd = el("div","mhd");
    var mnum = el("span",null,(i+1)); mnum.style.color="#2A3A50"; mhd.appendChild(mnum);
    if(isCor) mhd.appendChild(el("span","rtag rtok","✓+2"));
    else if(isWrong) mhd.appendChild(el("span","rtag rtno","✗"));
    mc.appendChild(mhd);
    var mrow = el("div","mrow");
    var th = el("button","ts"+(m.pick===m.h?" W":m.pick?" L":"")+(locked?" dis":""));
    if(locked) th.disabled=true;
    (function(rk,idx,team){ th.onclick=function(){ pickTeam(rk,idx,team); }; })(key,i,m.h);
    th.appendChild(el("span","tflag",fl(m.h))); th.appendChild(el("span","tname",m.h));
    if(m.pick===m.h) th.appendChild(el("span","tchk","✓"));
    mrow.appendChild(th); mrow.appendChild(el("div","vs","VS"));
    var ta = el("button","ts"+(m.pick===m.a?" W":m.pick?" L":"")+(locked?" dis":""));
    if(locked) ta.disabled=true;
    (function(rk,idx,team){ ta.onclick=function(){ pickTeam(rk,idx,team); }; })(key,i,m.a);
    if(m.pick===m.a) ta.appendChild(el("span","tchk","✓"));
    var tan = el("span","tname",m.a); tan.style.textAlign="left"; ta.appendChild(tan); ta.appendChild(el("span","tflag",fl(m.a)));
    mrow.appendChild(ta); mc.appendChild(mrow);
    if(hasAct && !isCor) mc.appendChild(el("div","arow","الفائز الفعلي: "+act));
    wrap.appendChild(mc);
  }

  if(prevKey){ (function(pk){ wrap.appendChild(btn("btn","← "+RNAMES[pk],function(){ go(pk); })); })(prevKey); }
  if(nextKey && done){ (function(nk){ wrap.appendChild(btn("btn btng","التالي: "+RNAMES[nk]+" ←",function(){ rebuildAll(); go(nk); })); })(nextKey); }
  else if(nextKey && !done){ var db=btn("btn","اختر كل الفائزين أولاً",null); db.disabled=true; wrap.appendChild(db); }
}

// ================================================================
// FINAL
// ================================================================
function renderFinal(wrap){
  var m = (S.preds.final||[])[0] || {h:"؟",a:"؟",pick:""};
  var act = (S.liveResults.final||[])[0] || "";
  var hasAct = act !== ""; var isCor = hasAct && m.pick === act; var isWrong = hasAct && m.pick && !isCor;

  var ftitle = el("div"); ftitle.style.cssText = "text-align:center;padding:8px 0 16px";
  var fi = el("div",null,"🏆"); fi.style.fontSize="34px"; ftitle.appendChild(fi);
  var fh = el("div",null,"نهائي كأس العالم 2026"); fh.style.cssText="font-size:16px;font-weight:900;color:#C9A84C;margin-top:4px";
  ftitle.appendChild(fh);
  var fd = el("div",null,"19 يوليو · MetLife Stadium"); fd.style.cssText="font-size:10px;color:#334;margin-top:3px";
  ftitle.appendChild(fd); wrap.appendChild(ftitle);

  var mc = el("div","mc"+(m.pick?" picked":"")); mc.style.border="1px solid #C9A84C44"; mc.style.marginBottom="14px";
  var mhd = el("div","mhd"); mhd.appendChild(el("span",null,"البطل"));
  if(isCor) mhd.appendChild(el("span","rtag rtok","✓+2"));
  else if(isWrong) mhd.appendChild(el("span","rtag rtno","✗"));
  mc.appendChild(mhd);
  var mrow = el("div","mrow");
  var th = el("button","ts"+(m.pick===m.h?" W":m.pick?" L":"")+(hasAct?" dis":""));
  if(hasAct) th.disabled=true; th.onclick=function(){ pickTeam("final",0,m.h); };
  th.appendChild(el("span","tflag",fl(m.h)));
  var thn=el("span","tname",m.h); thn.style.fontSize="13px"; thn.style.fontWeight="700"; th.appendChild(thn);
  if(m.pick===m.h){ var tc=el("span",null,"🏆"); tc.style.fontSize="16px"; th.appendChild(tc); }
  mrow.appendChild(th); mrow.appendChild(el("div","vs","VS"));
  var ta = el("button","ts"+(m.pick===m.a?" W":m.pick?" L":"")+(hasAct?" dis":""));
  if(hasAct) ta.disabled=true; ta.onclick=function(){ pickTeam("final",0,m.a); };
  if(m.pick===m.a){ var tc2=el("span",null,"🏆"); tc2.style.fontSize="16px"; ta.appendChild(tc2); }
  var tan=el("span","tname",m.a); tan.style.fontSize="13px"; tan.style.fontWeight="700"; tan.style.textAlign="left";
  ta.appendChild(tan); ta.appendChild(el("span","tflag",fl(m.a)));
  mrow.appendChild(ta); mc.appendChild(mrow);
  if(hasAct && !isCor) mc.appendChild(el("div","arow","البطل الفعلي: "+act));
  wrap.appendChild(mc);

  if(m.pick){
    var pw = el("div"); pw.style.cssText="text-align:center;margin-bottom:14px";
    pw.appendChild(el("div",null,"بطلي المتوقع")).style.cssText="font-size:11px;color:#445";
    var pw2=el("div",null,"🏆 "+m.pick); pw2.style.cssText="font-size:24px;font-weight:900;color:#C9A84C;margin-top:4px";
    pw.appendChild(pw2); wrap.appendChild(pw);
  }

  var scard = el("div","scorecard");
  scard.appendChild(el("div",null,"مجموع نقاطي")).style.cssText="font-size:11px;color:#445;margin-bottom:4px";
  scard.appendChild(el("div","bigs",String(S.score.pts)));
  var sc3=el("div",null,"🎯 "+S.score.correct+" توقع صحيح من "+S.score.total);
  sc3.style.cssText="font-size:13px;color:#4CAF50;font-weight:700;margin-top:8px";
  scard.appendChild(sc3); wrap.appendChild(scard);

  wrap.appendChild(btn("btn","← نصف النهائي",function(){ go("sf"); }));
  if(!S.locked && m.pick){
    wrap.appendChild(btn("btn btngrn","✅ موافق — تأكيد وقفل كل التوقعات",function(){
      if(confirm("بعد الموافقة ما بتنقدر تعدل. تأكيد؟")){ S.locked=true; save(); render(); }
    }));
  }
  if(S.locked){
    var lb=el("div",null,"🔒 توقعاتك مقفولة ومحفوظة");
    lb.style.cssText="font-size:12px;color:#4CAF50;text-align:center;padding:8px;background:#081808;border-radius:8px;margin-bottom:6px";
    wrap.appendChild(lb);
  }
  wrap.appendChild(btn("btn","📊 شوف ترتيب كل المشاركين",function(){ go("leaderboard"); }));
}

// ================================================================
// LEADERBOARD — ترتيب كل المشاركين (محسوب تلقائياً)
// ================================================================
function renderLeaderboard(wrap){
  var card = el("div","card");
  card.appendChild(el("div","chd","📊 ترتيب المشاركين"));
  var cbd = el("div","cbd"); cbd.style.padding = "0";

  if(!S.leaderboard || S.leaderboard.length === 0){
    var empty = el("div",null,"لسا ما في مشاركين. شارك التطبيق مع رفقاتك!");
    empty.style.cssText = "padding:20px;text-align:center;color:#667;font-size:13px";
    cbd.appendChild(empty);
  }else{
    S.leaderboard.forEach(function(u, idx){
      var row = el("div","lb-row");
      var rankCls = idx===0?"gold":idx===1?"silver":idx===2?"bronze":"";
      var rank = el("div","lb-rank "+rankCls, String(idx+1));
      row.appendChild(rank);

      var avatar;
      if(u.userPhoto){
        avatar = document.createElement("img");
        avatar.src = u.userPhoto;
        avatar.className = "lb-avatar";
      } else {
        avatar = el("div","lb-avatar","👤");
      }
      row.appendChild(avatar);

      var info = el("div","lb-info");
      info.appendChild(el("div","lb-name", u.userName || "مشترك"));
      var champTxt = u.champion ? ("🏆 "+u.champion) : "لم يحدد بطل بعد";
      info.appendChild(el("div","lb-champ", champTxt));
      row.appendChild(info);

      var ptsBox = el("div");
      ptsBox.style.cssText = "text-align:left";
      ptsBox.appendChild(el("div","lb-pts", String(u.pts)));
      ptsBox.appendChild(el("div","lb-correct", u.correct+"/"+u.total));
      row.appendChild(ptsBox);

      cbd.appendChild(row);
    });
  }
  card.appendChild(cbd); wrap.appendChild(card);
  wrap.appendChild(btn("btn btnsync","🔄 تحديث الترتيب",function(){ loadLeaderboard(render); }));
  wrap.appendChild(btn("btn","← عودة",function(){ go("intro"); }));
}

// ================================================================
// ACTIONS
// ================================================================
function pickTeam(key,idx,team){
  if(S.locked) return;
  if(!S.preds[key] || !S.preds[key][idx]) return;
  S.preds[key][idx].pick = team;
  rebuildAll(); save(); render();
}

// ================================================================
// INIT
// ================================================================
loadLocalBackup();
initR32();
render();

// Load real data from server, then start syncing
loadFromServer(function(){
  loadFixtures(function(){
    render();
    syncResults(true);
    startAutoSync();
  });
});
