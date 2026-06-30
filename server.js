// =====================================================================
// تحدي ضياء — كأس العالم 2026
// السيرفر الرئيسي — يجيب النتائج تلقائياً من الإنترنت ويحسب النقاط
// =====================================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data', 'predictions.json');
const SOURCE_URL = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// =====================================================================
// MATCH NUMBER MAPPING — official FIFA match numbers per round
// =====================================================================
const ROUND_MATCH_NUMS = {
  r32:   [73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88],
  r16:   [89, 90, 91, 92, 93, 94, 95, 96],
  qf:    [97, 98, 99, 100],
  sf:    [101, 102],
  final: [104],
};

// R16 official pairing: which two R32 match winners play each other
// Index is position in r32 array (0=M73, 1=M74, 2=M75, ... 15=M88)
// R16 match 89 (idx 0) = W74(idx1) vs W77(idx4)
// R16 match 90 (idx 1) = W73(idx0) vs W75(idx2)
// R16 match 91 (idx 2) = W76(idx3) vs W78(idx5)
// R16 match 92 (idx 3) = W79(idx6) vs W80(idx7)
// R16 match 93 (idx 4) = W83(idx10) vs W84(idx11)
// R16 match 94 (idx 5) = W81(idx8) vs W82(idx9)
// R16 match 95 (idx 6) = W86(idx13) vs W88(idx15)
// R16 match 96 (idx 7) = W85(idx12) vs W87(idx14)
const R16_PAIRS = [
  [1, 4],   // M89: W74 vs W77
  [0, 2],   // M90: W73 vs W75
  [3, 5],   // M91: W76 vs W78
  [6, 7],   // M92: W79 vs W80
  [10, 11], // M93: W83 vs W84
  [8, 9],   // M94: W81 vs W82
  [13, 15], // M95: W86 vs W88
  [12, 14], // M96: W85 vs W87
];

// QF official pairing (based on R16 winners)
// QF97 = W89 vs W90, QF98 = W93 vs W94, QF99 = W91 vs W92, QF100 = W95 vs W96
const QF_PAIRS = [
  [0, 1], // QF97: W89 vs W90
  [4, 5], // QF98: W93 vs W94
  [2, 3], // QF99: W91 vs W92
  [6, 7], // QF100: W95 vs W96
];

// SF official pairing
// SF101 = W97 vs W98, SF102 = W99 vs W100
const SF_PAIRS = [
  [0, 1], // SF101: W97 vs W98
  [2, 3], // SF102: W99 vs W100
];

// Team name translation: English (source) -> Arabic (app)
const TEAM_AR = {
  "Mexico": "المكسيك", "South Africa": "جنوب أفريقيا", "Czech Republic": "جمهورية التشيك", "South Korea": "كوريا الجنوبية",
  "Canada": "كندا", "Bosnia & Herzegovina": "البوسنة والهرسك", "Qatar": "قطر", "Switzerland": "سويسرا",
  "Brazil": "البرازيل", "Morocco": "المغرب", "Haiti": "هايتي", "Scotland": "اسكتلندا",
  "USA": "الولايات المتحدة", "Paraguay": "باراغواي", "Australia": "أستراليا", "Turkey": "تركيا",
  "Germany": "ألمانيا", "Curaçao": "كوراساو", "Ivory Coast": "كوت ديفوار", "Ecuador": "الإكوادور",
  "Netherlands": "هولندا", "Japan": "اليابان", "Sweden": "السويد", "Tunisia": "تونس",
  "Belgium": "بلجيكا", "Egypt": "مصر", "Iran": "إيران", "New Zealand": "نيوزيلندا",
  "Spain": "إسبانيا", "Cape Verde": "الرأس الأخضر", "Saudi Arabia": "السعودية", "Uruguay": "أوروغواي",
  "France": "فرنسا", "Senegal": "السنغال", "Iraq": "العراق", "Norway": "النرويج",
  "Argentina": "الأرجنتين", "Algeria": "الجزائر", "Austria": "النمسا", "Jordan": "الأردن",
  "Portugal": "البرتغال", "DR Congo": "الكونغو الديمقراطية", "Uzbekistan": "أوزبكستان", "Colombia": "كولومبيا",
  "England": "إنجلترا", "Croatia": "كرواتيا", "Ghana": "غانا", "Panama": "بنما",
};
function toArabic(name) {
  return TEAM_AR[name] || name;
}

// =====================================================================
// PREDICTIONS STORAGE — كل توقعات المشاركين
// =====================================================================
function loadPredictions() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { users: {} };
  }
}
function savePredictions(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// =====================================================================
// LIVE RESULTS CACHE — النتائج الفعلية من الإنترنت
// =====================================================================
let liveResultsCache = { r32: [], r16: [], qf: [], sf: [], final: [] };
let r32FixtureNames = []; // [{h, a, date}, ...] resolved team names for R32
let lastFetchTime = null;
let lastFetchError = null;

async function fetchLiveResults() {
  try {
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const matches = json.matches || [];

    // Build a map: match num -> winner (Arabic name)
    const numToWinner = {};
    for (const m of matches) {
      if (!m.num || !m.score || !m.score.ft) continue;
      const [s1, s2] = m.score.ft;
      let winner = null;
      if (m.score.p) {
        // penalties decide it
        winner = m.score.p[0] > m.score.p[1] ? m.team1 : m.team2;
      } else if (m.score.et) {
        winner = m.score.et[0] > m.score.et[1] ? m.team1 : m.team2;
      } else if (s1 !== s2) {
        winner = s1 > s2 ? m.team1 : m.team2;
      }
      if (winner) {
        numToWinner[m.num] = toArabic(winner);
      }
    }

    // Map to round-indexed arrays our app expects
    const newResults = { r32: [], r16: [], qf: [], sf: [], final: [] };
    for (const round in ROUND_MATCH_NUMS) {
      const nums = ROUND_MATCH_NUMS[round];
      nums.forEach((num, idx) => {
        if (numToWinner[num]) {
          newResults[round][idx] = numToWinner[num];
        }
      });
    }

    // Build R32 fixture names (team1/team2 as resolved by source —
    // shows placeholder like "3A/B/C/D/F" until groups are final, then real team)
    const numToMatch = {};
    for (const m of matches) {
      if (m.num) numToMatch[m.num] = m;
    }
    const newFixtures = ROUND_MATCH_NUMS.r32.map(num => {
      const m = numToMatch[num];
      if (!m) return { h: '؟', a: '؟', date: '' };
      return {
        h: toArabic(m.team1) || m.team1,
        a: toArabic(m.team2) || m.team2,
        date: m.date || '',
      };
    });
    r32FixtureNames = newFixtures;

    liveResultsCache = newResults;
    lastFetchTime = new Date().toISOString();
    lastFetchError = null;
    console.log(`[${lastFetchTime}] Results updated successfully`);
  } catch (e) {
    lastFetchError = e.message;
    console.error('Failed to fetch live results:', e.message);
  }
}

// Fetch immediately, then every 30 minutes
fetchLiveResults();
setInterval(fetchLiveResults, 30 * 60 * 1000);

// =====================================================================
// SCORE CALCULATION
// =====================================================================
const ROUNDS = ['r32', 'r16', 'qf', 'sf', 'final'];
const NEXT_ROUND = { r32: 'r16', r16: 'qf', qf: 'sf', sf: 'final' };

function getWinner(match, actualResult) {
  // Returns actual winner if known, otherwise user's pick, otherwise '؟'
  return actualResult || (match && match.pick) || '؟';
}

function isSub(match, actualResult) {
  // Returns true if actual winner differs from user's prediction
  return !!(actualResult && match && match.pick && actualResult !== match.pick);
}

function rebuildBracket(preds, actual) {
  const r32 = (preds.r32 || []).map(p => ({ h: p.h || '؟', a: p.a || '؟', pick: p.pick || '', sub: false }));
  const r32Actual = actual.r32 || [];

  // Build R16 using official FIFA bracket pairing
  const r16 = R16_PAIRS.map((pair, idx) => {
    const [i1, i2] = pair;
    const m1 = r32[i1] || {};
    const m2 = r32[i2] || {};
    const act1 = r32Actual[i1];
    const act2 = r32Actual[i2];
    const h = getWinner(m1, act1);
    const a = getWinner(m2, act2);
    const origPred = (preds.r16 || [])[idx] || {};
    let pick = origPred.pick || '';
    const sub = isSub(m1, act1) || isSub(m2, act2);
    if (pick && pick !== h && pick !== a) pick = '';
    return { h, a, pick, sub };
  });

  const r16Actual = actual.r16 || [];

  // Build QF using official FIFA bracket pairing
  const qf = QF_PAIRS.map((pair, idx) => {
    const [i1, i2] = pair;
    const m1 = r16[i1] || {};
    const m2 = r16[i2] || {};
    const act1 = r16Actual[i1];
    const act2 = r16Actual[i2];
    const h = getWinner(m1, act1);
    const a = getWinner(m2, act2);
    const origPred = (preds.qf || [])[idx] || {};
    let pick = origPred.pick || '';
    const sub = isSub(m1, act1) || isSub(m2, act2);
    if (pick && pick !== h && pick !== a) pick = '';
    return { h, a, pick, sub };
  });

  const qfActual = actual.qf || [];

  // Build SF using official pairing
  const sf = SF_PAIRS.map((pair, idx) => {
    const [i1, i2] = pair;
    const m1 = qf[i1] || {};
    const m2 = qf[i2] || {};
    const act1 = qfActual[i1];
    const act2 = qfActual[i2];
    const h = getWinner(m1, act1);
    const a = getWinner(m2, act2);
    const origPred = (preds.sf || [])[idx] || {};
    let pick = origPred.pick || '';
    const sub = isSub(m1, act1) || isSub(m2, act2);
    if (pick && pick !== h && pick !== a) pick = '';
    return { h, a, pick, sub };
  });

  const sfActual = actual.sf || [];

  // Build Final
  const sf0 = sf[0] || {}; const sf1 = sf[1] || {};
  const act_sf0 = sfActual[0]; const act_sf1 = sfActual[1];
  const fh = getWinner(sf0, act_sf0);
  const fa = getWinner(sf1, act_sf1);
  const origFinal = (preds.final || [])[0] || {};
  let fpick = origFinal.pick || '';
  const fsub = isSub(sf0, act_sf0) || isSub(sf1, act_sf1);
  if (fpick && fpick !== fh && fpick !== fa) fpick = '';
  const finalMatch = [{ h: fh, a: fa, pick: fpick, sub: fsub }];

  return { r32, r16, qf, sf, final: finalMatch };
}

function calcUserScore(predictions, actual) {
  const preds = predictions.preds;
  const rebuilt = rebuildBracket(preds, actual);

  let pts = 0, correct = 0, total = 0;
  const details = [];

  for (const round of ROUNDS) {
    const matches = rebuilt[round] || [];
    const acts = actual[round] || [];
    let roundPts = 0;
    const roundCorrect = [];
    const roundWrong = [];

    matches.forEach((m, i) => {
      if (!m.pick) return;
      const act = acts[i];
      if (!act) return;
      total++;
      if (m.pick === act) {
        const p = m.sub ? 1 : 2;
        roundPts += p;
        pts += p;
        correct++;
        roundCorrect.push(m.pick);
      } else {
        roundWrong.push(`توقعت ${m.pick} والفائز الفعلي ${act}`);
      }
    });

    details.push({ round, points: roundPts, correct: roundCorrect, wrong: roundWrong });
  }

  return { pts, correct, total, details, rebuilt };
}

// =====================================================================
// API ROUTES
// =====================================================================

// Get current live results
app.get('/api/results', (req, res) => {
  res.json({
    success: true,
    results: liveResultsCache,
    lastFetch: lastFetchTime,
    error: lastFetchError,
  });
});

// Get R32 fixture team names (resolved as groups finish)
app.get('/api/fixtures', (req, res) => {
  res.json({
    success: true,
    fixtures: r32FixtureNames,
    lastFetch: lastFetchTime,
  });
});

// Force refresh results from source
app.post('/api/results/refresh', async (req, res) => {
  await fetchLiveResults();
  res.json({ success: !lastFetchError, results: liveResultsCache, lastFetch: lastFetchTime, error: lastFetchError });
});

// Save a user's predictions
app.post('/api/predictions/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const { userName, userPhoto, preds, locked, lockedAt } = req.body;
    const data = loadPredictions();
    const existing = data.users[userId];

    // مرة قُفلت التوقعات، ما حدا (ولا حتى المستخدم نفسه) يقدر يفك القفل
    const wasLocked = existing && existing.locked;
    const finalLocked = wasLocked ? true : !!locked;
    const finalLockedAt = wasLocked ? existing.lockedAt : (locked ? (lockedAt || new Date().toISOString()) : null);

    // لو مقفول، تجاهل أي تعديل على preds وخلي القديمة
    const finalPreds = wasLocked ? existing.preds : preds;

    data.users[userId] = {
      userId, userName, userPhoto,
      preds: finalPreds,
      locked: finalLocked,
      lockedAt: finalLockedAt,
      updatedAt: new Date().toISOString(),
    };
    savePredictions(data);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get a single user's predictions + their live score
app.get('/api/predictions/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const data = loadPredictions();
    const user = data.users[userId];
    if (!user) return res.json({ success: true, user: null });
    const score = calcUserScore(user, liveResultsCache);
    res.json({ success: true, user, score: { pts: score.pts, correct: score.correct, total: score.total, details: score.details } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Leaderboard — كل المشاركين مع نقاطهم (محسوبة تلقائياً)
app.get('/api/leaderboard', (req, res) => {
  try {
    const data = loadPredictions();
    const board = Object.values(data.users).map(user => {
      const score = calcUserScore(user, liveResultsCache);
      const champion = user.preds.final && user.preds.final[0] ? user.preds.final[0].pick : '';
      return {
        userId: user.userId,
        userName: user.userName,
        userPhoto: user.userPhoto,
        locked: user.locked,
        lockedAt: user.lockedAt || null,
        pts: score.pts,
        correct: score.correct,
        total: score.total,
        champion,
      };
    });
    board.sort((a, b) => b.pts - a.pts);
    res.json({ success: true, leaderboard: board, lastFetch: lastFetchTime });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, lastFetch: lastFetchTime, error: lastFetchError });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`تحدي ضياء server running on port ${PORT}`);
});
