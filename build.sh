#!/bin/bash
# .envを読み込んでindex.htmlを生成する
set -a; source .env; set +a
sed "s|__SUPABASE_URL__|$SUPABASE_URL|g; s|__SUPABASE_ANON_KEY__|$SUPABASE_ANON_KEY|g" \
  baseball_bbs.html > index.html
echo "✅ index.html を生成しました"
