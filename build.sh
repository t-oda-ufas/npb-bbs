#!/bin/bash
set -e
sed "s|__SUPABASE_URL__|${SUPABASE_URL}|g; s|__SUPABASE_ANON_KEY__|${SUPABASE_ANON_KEY}|g" \
  baseball_bbs.html > index.html
echo "Build complete: index.html generated"
