const CACHE_TTL = 2 * 60 * 1000;
let cache: { data: string; ts: number } | null = null;

// インスタンス存続中に両投手を蓄積するメモリ
const pitcherMemory: Record<string, { home: any; away: any }> = {};

const TEAM_MAP: Record<string, { id: string; name: string; em: string; league: string }> = {
  '巨人':       { id: 'giants',    name: '巨人',       em: '🐰', league: 'c' },
  '阪神':       { id: 'tigers',    name: '阪神',       em: '🐯', league: 'c' },
  '広島':       { id: 'carp',      name: '広島',       em: '🎏', league: 'c' },
  '中日':       { id: 'dragons',   name: '中日',       em: '🐉', league: 'c' },
  'ヤクルト':   { id: 'swallows',  name: 'ヤクルト',   em: '🦢', league: 'c' },
  'DeNA':       { id: 'baystars',  name: 'DeNA',       em: '⭐', league: 'c' },
  'ソフトバンク':{ id: 'hawks',    name: 'SB',         em: '🦅', league: 'p' },
  '日本ハム':   { id: 'fighters',  name: '日ハム',     em: '🦊', league: 'p' },
  'ロッテ':     { id: 'marines',   name: 'ロッテ',     em: '🌊', league: 'p' },
  '楽天':       { id: 'eagles',    name: '楽天',       em: '🦅', league: 'p' },
  'オリックス': { id: 'buffaloes', name: 'オリックス', em: '🐃', league: 'p' },
  '西武':       { id: 'lions',     name: '西武',       em: '🦁', league: 'p' },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return jsonResponse(cache.data);
  }
  try {
    const games = await scrapeYahoo();
    if (!games.length) throw new Error('no games');
    const payload = JSON.stringify({ ok: true, games });
    cache = { data: payload, ts: Date.now() };
    return jsonResponse(payload);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: corsHeaders(),
    });
  }
});

async function scrapeYahoo() {
  const res = await fetch('https://baseball.yahoo.co.jp/npb/schedule/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ja-JP,ja;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const games: any[] = [];
  const itemRegex = /(<li class="bb-score__item[^"]*">[\s\S]*?<\/a>)\s*<\/li>/g;
  let match;

  while ((match = itemRegex.exec(html)) !== null) {
    const item = match[1];

    const hrefMatch = /href="([^"]+game\/(\d+)[^"]*)"/.exec(item);
    const gameId = hrefMatch?.[2] ?? String(games.length);

    const homeMatch = /homeLogo[^>]+>([^<]+)</.exec(item);
    const awayMatch = /awayLogo[^>]+>([^<]+)</.exec(item);
    const homeName = homeMatch?.[1].trim();
    const awayName = awayMatch?.[1].trim();
    if (!homeName || !awayName) continue;

    const venueMatch = /bb-score__venue[^>]*>([^<]+)</.exec(item);
    const venue = venueMatch?.[1].trim() ?? '';

    const home = TEAM_MAP[homeName] ?? { id: 'other', name: homeName, em: '⚾', league: 'c' };
    const away = TEAM_MAP[awayName] ?? { id: 'other', name: awayName, em: '⚾', league: 'c' };

    const isLive = item.includes('bb-score__item--live');
    const isEnd  = item.includes('bb-score__item--end');

    const homeScoreMatch = /bb-score__score--left[^>]*>\s*(\d+)\s*</.exec(item);
    const awayScoreMatch = /bb-score__score--right[^>]*>\s*(\d+)\s*</.exec(item);

    const inningMatch = /bb-score__link[^>]*>([^<]+)</.exec(item);
    const inning = inningMatch?.[1].trim() ?? '';

    const timeMatch = /bb-score__status[^>]*>\s*(\d{1,2}:\d{2})\s*</.exec(item);
    const startTime = timeMatch?.[1] ?? '';

    let status = 'scheduled';
    let homeScore: number | null = null;
    let awayScore: number | null = null;

    if (isEnd) {
      status = 'end';
      homeScore = homeScoreMatch ? parseInt(homeScoreMatch[1]) : null;
      awayScore = awayScoreMatch ? parseInt(awayScoreMatch[1]) : null;
    } else if (isLive) {
      status = 'live';
      homeScore = homeScoreMatch ? parseInt(homeScoreMatch[1]) : null;
      awayScore = awayScoreMatch ? parseInt(awayScoreMatch[1]) : null;
    }

    // 投手情報
    const parsePlayer = (raw: string | undefined) => {
      if (!raw) return null;
      const m = /^\(([^)]+)\)(.+)$/.exec(raw.trim());
      return m ? { prefix: m[1], name: m[2] } : null;
    };
    const homePlayerMatch = /bb-score__playerHome[\s\S]*?bb-score__player[^>]*>([^<]+)</.exec(item);
    const awayPlayerMatch = /bb-score__playerAway[\s\S]*?bb-score__player[^>]*>([^<]+)</.exec(item);
    const homePlayer = parsePlayer(homePlayerMatch?.[1]);
    const awayPlayer = parsePlayer(awayPlayerMatch?.[1]);

    // 打者を除き投手のみ抽出
    const toPitcher = (p: { prefix: string; name: string } | null) =>
      p && p.prefix !== '打' ? { name: p.name, prefix: p.prefix } : null;

    const curHome = toPitcher(homePlayer);
    const curAway = toPitcher(awayPlayer);

    // メモリに蓄積（勝敗確定時は上書き、それ以外は初回のみ保存）
    if (!pitcherMemory[gameId]) pitcherMemory[gameId] = { home: null, away: null };
    const mem = pitcherMemory[gameId];
    const isDecided = (p: any) => p && (p.prefix === '勝' || p.prefix === '負' || p.prefix === 'S');
    if (curHome && (isDecided(curHome) || !mem.home)) mem.home = curHome;
    if (curAway && (isDecided(curAway) || !mem.away)) mem.away = curAway;


    // prefix → 表示ラベル変換
    const prefixLabel = (p: any) => {
      if (!p) return null;
      const labels: Record<string, string> = { 勝: '勝', 負: '負', S: 'S' };
      return { name: p.name, display: labels[p.prefix] ?? '' };
    };

    games.push({
      id: gameId,
      home: home.name, homeEm: home.em, homeTeam: home.id,
      away: away.name, awayEm: away.em, awayTeam: away.id,
      homeScore, awayScore, status, venue, inning, startTime,
      homePitcher: prefixLabel(mem.home),
      awayPitcher: prefixLabel(mem.away),
      comments: 0,
    });
  }
  return games;
}

function corsHeaders() {
  return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' };
}
function jsonResponse(body: string) {
  return new Response(body, { headers: corsHeaders() });
}
