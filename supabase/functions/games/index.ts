const CACHE_TTL = 2 * 60 * 1000;
let cache: { data: string; ts: number } | null = null;

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

const CL = new Set(['giants','tigers','carp','dragons','swallows','baystars']);

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
  const itemRegex = /<li class="bb-score__item">([\s\S]*?)<\/li>/g;
  let match;

  while ((match = itemRegex.exec(html)) !== null) {
    const item = match[1];

    // ゲームID
    const hrefMatch = /href="([^"]+game\/(\d+)[^"]*)"/.exec(item);
    const gameId = hrefMatch?.[2] ?? String(games.length);

    // ホーム・アウェイチーム名
    const homeMatch = /homeLogo[^>]+>([^<]+)</.exec(item);
    const awayMatch = /awayLogo[^>]+>([^<]+)</.exec(item);
    const homeName = homeMatch?.[1].trim();
    const awayName = awayMatch?.[1].trim();
    if (!homeName || !awayName) continue;

    // 球場名
    const venueMatch = /bb-score__venue[^>]*>([^<]+)</.exec(item);
    const venue = venueMatch?.[1].trim() ?? '';

    const home = TEAM_MAP[homeName] ?? { id: 'other', name: homeName, em: '⚾', league: 'c' };
    const away = TEAM_MAP[awayName] ?? { id: 'other', name: awayName, em: '⚾', league: 'c' };

    // ステータス（時刻 or 終了 or 回表/裏）
    const statusMatch = /bb-score__status[^>]*>([^<]+)</.exec(item);
    const statusText = statusMatch?.[1].trim() ?? '';

    // スコア（終了・進行中の場合）
    const homeRunMatch = /bb-score__runHome[^>]*>(\d+)</.exec(item);
    const awayRunMatch = /bb-score__runAway[^>]*>(\d+)</.exec(item);
    // 別パターン：数値をスコアラップから取得
    const scoreNums = [...item.matchAll(/bb-score__run[^>]*>(\d+)</g)].map(m => parseInt(m[1]));

    let status = 'scheduled';
    let homeScore: number | null = null;
    let awayScore: number | null = null;

    if (homeRunMatch && awayRunMatch) {
      homeScore = parseInt(homeRunMatch[1]);
      awayScore = parseInt(awayRunMatch[1]);
      status = statusText.includes('終了') ? 'end' : 'live';
    } else if (scoreNums.length >= 2) {
      homeScore = scoreNums[0];
      awayScore = scoreNums[1];
      status = statusText.includes('終了') ? 'end' : 'live';
    } else if (statusText.includes('終了')) {
      status = 'end';
    } else if (statusText && !/^\d{1,2}:\d{2}$/.test(statusText)) {
      status = 'live';
    }

    games.push({
      id: gameId,
      home: home.name, homeEm: home.em, homeTeam: home.id,
      away: away.name, awayEm: away.em, awayTeam: away.id,
      homeScore, awayScore, status, venue, comments: 0,
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
