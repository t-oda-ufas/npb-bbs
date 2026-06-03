const CACHE_TTL = 5 * 60 * 1000; // 5分キャッシュ
let cache: { data: string; ts: number } | null = null;

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
      },
    });
  }

  // キャッシュが有効なら返す
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return jsonResponse(cache.data);
  }

  try {
    const rssUrl =
      'https://news.google.com/rss/search?q=プロ野球&hl=ja&gl=JP&ceid=JP:ja';
    const res = await fetch(rssUrl);
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
    const xml = await res.text();

    // XMLをパースしてJSONに変換
    const items = parseRSS(xml);
    const payload = JSON.stringify({ ok: true, items });

    cache = { data: payload, ts: Date.now() };
    return jsonResponse(payload);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: corsHeaders(),
    });
  }
});

function parseRSS(xml: string) {
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const tagRegex = (tag: string) =>
    new RegExp(`<${tag}[^>]*>(?:<![^>]+>)?([\\s\\S]*?)<\\/${tag}>`, 'i');

  const items = [];
  let match;
  let i = 0;
  while ((match = itemRegex.exec(xml)) !== null && i < 20) {
    const block = match[1];
    const title = (tagRegex('title').exec(block)?.[1] ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s*-\s*[^-]+$/, '')
      .trim();
    const link = tagRegex('link').exec(block)?.[1]?.trim() ?? '';
    const pubDate = tagRegex('pubDate').exec(block)?.[1]?.trim() ?? '';
    const source = tagRegex('source').exec(block)?.[1]?.trim() ?? 'Google News';
    if (title) {
      items.push({ id: 'n' + i, title, link, pubDate, source });
      i++;
    }
  }
  return items;
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
}

function jsonResponse(body: string) {
  return new Response(body, { headers: corsHeaders() });
}
