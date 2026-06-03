const CACHE_TTL = 30 * 60 * 1000;
let cache: { data: string; ts: number } | null = null;

const TEAM_MAP: Record<string, { id: string; em: string; league: string; short: string }> = {
  '阪神':       { id: 'tigers',    em: '🐯', league: 'c', short: '阪神' },
  '巨人':       { id: 'giants',    em: '🐰', league: 'c', short: '巨人' },
  '広島':       { id: 'carp',      em: '🎏', league: 'c', short: '広島' },
  '中日':       { id: 'dragons',   em: '🐉', league: 'c', short: '中日' },
  'ヤクルト':   { id: 'swallows',  em: '🦢', league: 'c', short: 'ヤクルト' },
  'DeNA':       { id: 'baystars',  em: '⭐', league: 'c', short: 'DeNA' },
  'ソフトバンク':{ id: 'hawks',    em: '🦅', league: 'p', short: 'SB' },
  '日本ハム':   { id: 'fighters',  em: '🦊', league: 'p', short: '日ハム' },
  'ロッテ':     { id: 'marines',   em: '🌊', league: 'p', short: 'ロッテ' },
  '楽天':       { id: 'eagles',    em: '🦅', league: 'p', short: '楽天' },
  'オリックス': { id: 'buffaloes', em: '🐃', league: 'p', short: 'オリックス' },
  '西武':       { id: 'lions',     em: '🦁', league: 'p', short: '西武' },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return jsonResponse(cache.data);
  }
  try {
    const rows = await scrapeYahoo();
    if (rows.length < 10) throw new Error(`too few rows: ${rows.length}`);
    const central = rows.filter(r => r.league === 'c');
    const pacific  = rows.filter(r => r.league === 'p');
    const payload = JSON.stringify({ ok: true, central, pacific });
    cache = { data: payload, ts: Date.now() };
    return jsonResponse(payload);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: corsHeaders(),
    });
  }
});

async function scrapeYahoo() {
  const res = await fetch('https://baseball.yahoo.co.jp/npb/standings/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ja-JP,ja;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const rows: any[] = [];
  // メイン順位表は最初の12行（セ6+パ6）のみ
  const rowRegex = /<tr class="bb-rankTable__row">([\s\S]*?)<\/tr>/g;
  let match;
  let count = 0;

  while ((match = rowRegex.exec(html)) !== null && count < 12) {
    const rowHTML = match[1];

    // チーム名
    const teamMatch = /bb-rankTable__team--npbTeam\d+"[^>]*>([^<]+)</.exec(rowHTML);
    if (!teamMatch) continue;
    const teamName = teamMatch[1].trim();
    const team = TEAM_MAP[teamName];
    if (!team) continue;

    // 純データセル（rank・teamセルは別クラスなので除外される）
    const numRegex = /<td class="bb-rankTable__data">([^<]+)<\/td>/g;
    const nums: string[] = [];
    let nm;
    while ((nm = numRegex.exec(rowHTML)) !== null) {
      nums.push(nm[1].trim());
    }
    // nums: [試合, 勝, 負, 分, 勝率, GB, ...]
    const wins   = parseInt(nums[1]) || 0;
    const losses = parseInt(nums[2]) || 0;
    const draws  = parseInt(nums[3]) || 0;
    const gbRaw  = nums[5] ?? '';
    const gb     = gbRaw === '0' || gbRaw === '-' || gbRaw === '' ? '—' : gbRaw;

    rows.push({ name: team.short, em: team.em, id: team.id, league: team.league, wins, losses, draws, gb });
    count++;
  }
  return rows;
}

function corsHeaders() {
  return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' };
}
function jsonResponse(body: string) {
  return new Response(body, { headers: corsHeaders() });
}
