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
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  },
}));

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

// =====================================================================
// MANUAL OVERRIDES — تدخل يدوي لو مصدر النتائج تأخر
// لا تلمس أي منطق موجود؛ هاي بس تُطبَّق فوق نتائج المصدر الخارجي
// =====================================================================
const ADMIN_PIN = 'diaa95';
const OVERRIDES_FILE = path.join(__dirname, 'data', 'overrides.json');

function loadOverrides() {
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
  } catch (e) {
    return { r32: [], r16: [], qf: [], sf: [], final: [] };
  }
}
function saveOverrides(data) {
  fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(data, null, 2));
}
// Apply saved manual overrides on top of whatever we fetched from the source
function applyOverrides(results) {
  const overrides = loadOverrides();
  for (const round of ROUNDS) {
    const ov = overrides[round] || [];
    ov.forEach((winner, idx) => {
      if (winner) {
        if (!results[round]) results[round] = [];
        results[round][idx] = winner;
      }
    });
  }
  return results;
}

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

    liveResultsCache = applyOverrides(newResults);
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
const PREV_ROUND = { r16: 'r32', qf: 'r16', sf: 'qf', final: 'sf' };

// Verified real FIFA World Cup 2026 knockout bracket dependencies
// (which two earlier matches feed into each next-round match), by
// official match number. This is NOT simple sequential pairing —
// confirmed against the official schedule (cup_finals.txt).
const BRACKET_FEEDS = {
  r16:   [[74, 77], [73, 75], [76, 78], [79, 80], [83, 84], [81, 82], [86, 88], [85, 87]],
  qf:    [[89, 90], [93, 94], [91, 92], [95, 96]],
  sf:    [[97, 98], [99, 100]],
  final: [[101, 102]],
};

function rebuildBracket(preds, actual) {
  // Given user's r32 predictions, rebuild r16/qf/sf/final based on
  // their picks UNLESS the actual result contradicts — then propagate
  // the real winner forward (substitution logic), marking isSub=true.
  const r32src = (preds.r32 || []).map(p => ({ h: p.h || '؟', a: p.a || '؟', pick: p.pick || '' }));
  const rounds = { r32: r32src.map(p => ({ ...p, sub: false })) };

  for (let i = 1; i < ROUNDS.length; i++) {
    const next = ROUNDS[i];
    const cur = PREV_ROUND[next];
    const curMatches = rounds[cur] || [];
    const curActual = actual[cur] || [];
    const nextPreds = preds[next] || [];
    const feeds = BRACKET_FEEDS[next];
    const baseNum = ROUND_MATCH_NUMS[cur][0];

    const nextMatches = feeds.map((pair, idx) => {
      const j = pair[0] - baseNum;
      const k = pair[1] - baseNum;
      const m1 = curMatches[j] || { h: '؟', a: '؟', pick: '' };
      const m2 = curMatches[k] || { h: '؟', a: '؟', pick: '' };

      // Determine actual winners (or predicted if not played yet)
      const act1 = curActual[j];
      const act2 = curActual[k];

      const realHome = act1 || m1.pick || '؟';
      const realAway = act2 || m2.pick || '؟';

      const origPred = nextPreds[idx] || {};
      let pick = origPred.pick || '';
      let sub = false;

      // Only treat this pick as a "substitution" if it specifically traces
      // back to the team that got swapped — not just because the OTHER
      // slot in this pairing had an unrelated upset. Also inherit sub
      // status along the correct lineage (e.g. a team that was itself
      // already a substitute in an earlier round stays a substitute).
      if (pick && pick === m1.pick) {
        if (act1 && act1 !== m1.pick) { sub = true; pick = act1; }
        else if (m1.sub) { sub = true; }
      } else if (pick && pick === m2.pick) {
        if (act2 && act2 !== m2.pick) { sub = true; pick = act2; }
        else if (m2.sub) { sub = true; }
      }

      return { h: realHome, a: realAway, pick, sub };
    });
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
    res.json({ success: true, user, score: { pts: score.pts, correct: score.correct, total: score.total, details: score.details, rebuilt: score.rebuilt } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Leaderboard — كل المشاركين مع نقاطهم (محسوبة تلقائياً)
app.get('/api/leaderboard', (req, res) => {
  try {
    const data = loadPredictions();
    const board = Object.values(data.users)
      .filter(user => !user.hidden) // حسابات مخفية ما بتظهر بالقائمة العامة، بس نقاطها بتضل تنحسب
      .map(user => {
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

// =====================================================================
// ADMIN OVERRIDE ROUTES — إدخال نتيجة يدوياً (PIN محمي)
// لا تؤثر إطلاقاً على توقعات المستخدمين المحفوظة (data/predictions.json)
// =====================================================================
app.get('/api/admin/overrides', (req, res) => {
  const { pin } = req.query;
  if (pin !== ADMIN_PIN) return res.status(401).json({ success: false, error: 'PIN غلط' });
  res.json({ success: true, overrides: loadOverrides(), teams: TEAM_AR, roundMatchNums: ROUND_MATCH_NUMS, fixtures: r32FixtureNames });
});

app.post('/api/admin/override', (req, res) => {
  const { pin, round, index, winner } = req.body;
  if (pin !== ADMIN_PIN) return res.status(401).json({ success: false, error: 'PIN غلط' });
  if (!ROUNDS.includes(round)) return res.status(400).json({ success: false, error: 'دور غير صحيح' });
  const overrides = loadOverrides();
  if (!overrides[round]) overrides[round] = [];
  overrides[round][index] = winner || null; // null clears the override for that match
  saveOverrides(overrides);
  // Reflect immediately in the live cache without waiting for the next scheduled fetch
  liveResultsCache = applyOverrides({ ...liveResultsCache });
  res.json({ success: true, overrides });
});

// List users (id + name only) so an admin page can pick who to delete
app.get('/api/admin/users', (req, res) => {
  const { pin } = req.query;
  if (pin !== ADMIN_PIN) return res.status(401).json({ success: false, error: 'PIN غلط' });
  const data = loadPredictions();
  const users = Object.values(data.users).map(u => ({ userId: u.userId, userName: u.userName }));
  res.json({ success: true, users });
});

// Delete a single user's saved predictions
app.delete('/api/admin/users/:userId', (req, res) => {
  const { pin } = req.query;
  if (pin !== ADMIN_PIN) return res.status(401).json({ success: false, error: 'PIN غلط' });
  const { userId } = req.params;
  const data = loadPredictions();
  if (!data.users[userId]) return res.status(404).json({ success: false, error: 'المستخدم مش موجود' });
  delete data.users[userId];
  savePredictions(data);
  res.json({ success: true });
});

// Same delete, but as a plain GET link you can just open in the browser —
// e.g. /api/admin/reset/USER_ID?secret=diaa95
app.get('/api/admin/reset/:userId', (req, res) => {
  const { secret } = req.query;
  if (secret !== ADMIN_PIN) return res.status(401).send('PIN غلط');
  const { userId } = req.params;
  const data = loadPredictions();
  if (!data.users[userId]) return res.status(404).send('المستخدم مش موجود: ' + userId);
  const name = data.users[userId].userName || userId;
  delete data.users[userId];
  savePredictions(data);
  res.send('تم حذف المستخدم: ' + name);
});

// Raw stored predictions for one user (for debugging) — shows exact stored strings
// e.g. /api/admin/raw/USER_ID?secret=diaa95
app.get('/api/admin/raw/:userId', (req, res) => {
  const { secret } = req.query;
  if (secret !== ADMIN_PIN) return res.status(401).send('PIN غلط');
  const { userId } = req.params;
  const data = loadPredictions();
  const user = data.users[userId];
  if (!user) return res.status(404).send('المستخدم مش موجود: ' + userId);
  const score = calcUserScore(user, liveResultsCache);
  res.type('text/plain').send(
    '=== RAW preds (كما خزنها المستخدم) ===\n' +
    JSON.stringify(user.preds, null, 2) +
    '\n\n=== LIVE RESULTS (النتائج الفعلية المخزنة بالسيرفر) ===\n' +
    JSON.stringify(liveResultsCache, null, 2) +
    '\n\n=== REBUILT (بعد تطبيق الاستبدال) ===\n' +
    JSON.stringify(score.rebuilt, null, 2)
  );
});

// HTML list of everyone + clickable delete/hide links, so you know what to put in the reset link above
// e.g. /api/admin/list?secret=diaa95
app.get('/api/admin/list', (req, res) => {
  const { secret } = req.query;
  if (secret !== ADMIN_PIN) return res.status(401).send('PIN غلط');
  const data = loadPredictions();
  const users = Object.values(data.users);
  const rows = users.map(u => `
    <div style="background:#0D1F3E;border:1px solid #1E3050;border-radius:10px;padding:12px;margin-bottom:10px;font-family:-apple-system,Arial,sans-serif">
      <div style="color:#C9A84C;font-weight:700;font-size:15px;margin-bottom:8px">
        ${u.userName || '(بدون اسم)'} ${u.hidden ? '<span style="color:#ff6b6b;font-size:12px">[مخفي]</span>' : ''}
      </div>
      <a href="/api/admin/reset/${u.userId}?secret=${ADMIN_PIN}"
         onclick="return confirm('متأكد من حذف ${u.userName || u.userId}؟')"
         style="display:inline-block;background:#6B1A1A;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-size:13px;margin-left:8px">🗑️ حذف</a>
      <a href="/api/admin/toggle-hide/${u.userId}?secret=${ADMIN_PIN}"
         style="display:inline-block;background:#3A2A1A;color:#F0D060;padding:8px 14px;border-radius:8px;text-decoration:none;font-size:13px;margin-left:8px">${u.hidden ? '👁️ إظهار' : '🙈 إخفاء'}</a>
      <a href="/api/admin/raw/${u.userId}?secret=${ADMIN_PIN}"
         style="display:inline-block;background:#1A2A3A;color:#8899AA;padding:8px 14px;border-radius:8px;text-decoration:none;font-size:13px">🔍 بيانات خام</a>
    </div>`).join('');
  res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>إدارة المشتركين</title></head>
    <body style="background:#0A1628;padding:14px;margin:0">
      <h2 style="color:#C9A84C;font-family:-apple-system,Arial,sans-serif;font-size:16px;text-align:center;margin-bottom:16px">👥 إدارة المشتركين</h2>
      ${users.length ? rows : '<div style="color:#8899AA;text-align:center;font-family:-apple-system,Arial,sans-serif;padding:20px">ما في مشتركين مسجلين حالياً</div>'}
    </body></html>`);
});

// Hide/unhide a user from the public leaderboard — their points still count, they just don't show
// e.g. /api/admin/toggle-hide/USER_ID?secret=diaa95
app.get('/api/admin/toggle-hide/:userId', (req, res) => {
  const { secret } = req.query;
  if (secret !== ADMIN_PIN) return res.status(401).send('PIN غلط');
  const { userId } = req.params;
  const data = loadPredictions();
  if (!data.users[userId]) return res.status(404).send('المستخدم مش موجود: ' + userId);
  data.users[userId].hidden = !data.users[userId].hidden;
  savePredictions(data);
  const name = data.users[userId].userName || userId;
  res.send((data.users[userId].hidden ? 'تم إخفاء: ' : 'تم إظهار: ') + name);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`تحدي ضياء server running on port ${PORT}`);
});
