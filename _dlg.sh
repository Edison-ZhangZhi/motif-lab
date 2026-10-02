#!/bin/bash
# 真实电吉他单音采样：Freesound CC0，按音名检索，校验标题含目标音名
cd /c/Users/10706/Desktop/MotifLab
mkdir -p guitar/clean guitar/crunch guitar/dist
UA="Mozilla/5.0"
NOTES="E2 G2 A2 B2 C#3 D3 E3 F#3 G3 A3 B3 C#4 D4 E4 F#4 G4 A4 B4 D5 E5"
declare -A WORDS=( [clean]="electric guitar clean note" [crunch]="electric guitar overdrive note" [dist]="electric guitar distortion note" )

for timbre in clean crunch dist; do
  for note in $NOTES; do
    out="guitar/$timbre/$note.mp3"
    [ -s "$out" ] && [ $(wc -c < "$out") -gt 15000 ] && continue
    q="${WORDS[$timbre]} $note"
    ids=$(curl -s --max-time 20 -A "$UA" "https://freesound.org/search/?q=$(echo "$q" | sed 's/ /+/g')&f=license:%22Creative+Commons+0%22" | grep -oE '/people/[^/]+/sounds/[0-9]+/' | awk '!seen[$0]++' | head -4)
    got=""
    for id in $ids; do
      page=$(curl -s --max-time 20 -A "$UA" "https://freesound.org$id")
      # 标题需含目标音名（防 riff/loop 误检）
      echo "$page" | grep -qiE "<title>[^<]*$note" || continue
      url=$(echo "$page" | grep -oE 'https://cdn\.freesound\.org/previews/[^"]+-lq\.mp3' | head -1)
      [ -z "$url" ] && continue
      curl -s --max-time 40 -A "$UA" "$url" -o "$out"
      sz=$(wc -c < "$out" 2>/dev/null || echo 0)
      if [ "$sz" -gt 15000 ] && [ "$sz" -lt 900000 ]; then got="OK($sz) $id"; break; fi
    done
    if [ -n "$got" ]; then echo "$timbre/$note $got"; else echo "$timbre/$note MISS"; fi
  done
done
echo "=== 完成 ==="
find guitar -name "*.mp3" | wc -l