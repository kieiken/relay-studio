#!/bin/zsh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js 22以降が必要です。インストール後にもう一度開いてください。'
  read '?Enterで閉じます。'
  exit 1
fi
if node -e 'if(Number(process.versions.node.split(".")[0])<22){console.error("Node.js 22以降が必要です。");process.exit(1)}'; then
  :
else
  read '?Enterで閉じます。'
  exit 1
fi
relay_probe() {
  node --input-type=module -e '
import {createHash} from "node:crypto";
import {realpathSync,readFileSync} from "node:fs";
const pkg=JSON.parse(readFileSync("package.json","utf8"));
try {
 const r=await fetch("http://127.0.0.1:8792/api/health",{signal:AbortSignal.timeout(2000)});
 let s;try{s=await r.json();}catch{process.exit(2);}
 const same=s.product===pkg.name&&s.version===pkg.version&&s.locationId===createHash("sha256").update(realpathSync(".")).digest("hex");
 process.exit(same?0:2);
}catch(e){process.exit(e.cause?.code==="ECONNREFUSED"?1:2);}
'
}
if relay_probe; then
  open 'http://127.0.0.1:8792'
  exit 0
else
  relay_check=$?
  if [[ "$relay_check" != 1 ]]; then
    print '8792番ポートに別の版またはアプリが起動しています。終了してから、この版を開いてください。'
    read '?Enterで閉じます。'
    exit 1
  fi
fi
if [[ ! -d node_modules/twitter-text ]]; then
  if [[ -f bundle-manifest.json ]]; then
    print '配布ファイルが欠けています。Releasesの正規ZIPを取り直し、新しい空の設置先にインストールしてください。既存データは削除しないでください。'
  else
    print '開発用ソースです。このフォルダで npm ci --ignore-scripts を実行してください。'
  fi
  read '?Enterで閉じます。'
  exit 1
fi
PORT=8792 node server.mjs &
relay_studio_pid=$!
trap 'kill "$relay_studio_pid" 2>/dev/null || true' EXIT INT TERM
relay_started=0
relay_deadline=$((SECONDS + 30))
while (( SECONDS < relay_deadline )); do
  if ! kill -0 "$relay_studio_pid" 2>/dev/null; then
    print '起動できませんでした。表示された理由を確認してください。'
    read '?Enterで閉じます。'
    exit 1
  fi
  if relay_probe; then
    relay_started=1
    open 'http://127.0.0.1:8792'
    break
  fi
  sleep 1
done
if [[ $relay_started != 1 ]]; then
  print '起動待ちの時間内に確認できませんでした。表示された理由を確認してください。'
  exit 1
fi
print 'Relay Studioが起動しました。このウィンドウを閉じると予約実行も停止します。'
wait "$relay_studio_pid"
