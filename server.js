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

function rebuildBracket(preds, actual) {
  // Given user's r32 predictions, rebuild r16/qf/sf/final based on
  // their picks UNLESS the actual result contradicts — then propagate
  // the real winner forward (substitution logic), marking isSub=true.
  const r32src = (preds.r32 || []).map(p => ({ h: p.h || '؟', a: p.a || '؟', pick: p.pick || '' }));
  const rounds = { r32: r32src.map(p => ({ ...p, sub: false })) };

  for (let i = 0; i < ROUNDS.length - 1; i++) {
    const cur = ROUNDS[i];
    const next = ROUNDS[i + 1];
    const curMatches = rounds[cur] || [];
    const curActual = actual[cur] || [];
    const nextPreds = preds[next] || [];

    const nextMatches = [];
    for (let j = 0; j < curMatches.length; j += 2) {
      if (!curMatches[j]) continue;
      const m1 = curMatches[j] || { h: '؟', a: '؟', pick: '' };
      const m2 = curMatches[j + 1] || { h: '؟', a: '؟', pick: '' };

      // Determine actual winners (or predicted if not played yet)
      const act1 = curActual[j];
      const act2 = curActual[j + 1];

      const realHome = act1 || m1.pick || '؟';
      const realAway = act2 || m2.pick || '؟';

      const idx = nextMatches.length;
      const origPred = nextPreds[idx] || {};
      let pick = origPred.pick || '';
      let sub = false;

      // If actual result differs from what user predicted to advance, mark sub
      if (act1 && m1.pick && act1 !== m1.pick) sub = true;
      if (act2 && m2.pick && act2 !== m2.pick) sub = true;

      // If user's pick for this next match no longer matches either team, clear it
      if (pick && pick !== realHome && pick !== realAway) pick = '';

      nextMatches.push({ h: realHome, a: realAway, pick, sub });
    }
    rounds[next] = nextMatches;
  }

  return rounds;
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
    const { userName, userPhoto, preds, locked } = req.body;
    const data = loadPredictions();
    data.users[userId] = {
      userId, userName, userPhoto, preds,
      locked: !!locked,
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
