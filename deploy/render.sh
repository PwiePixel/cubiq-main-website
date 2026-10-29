#!/bin/sh
# Website fertig machen (beim Bauen des Images, siehe Dockerfile – oder für die Vorschau, siehe README.md):
#
#   sh deploy/render.sh <ordner>             im Ordner selbst
#   sh deploy/render.sh site <zielordner>    Kopie von site/ nach <zielordner>
#
# 1. „<!--#include name-->“ (allein in einer Zeile) wird durch site/_partials/name.html ersetzt – Kopf, Kopf- und
#    Fußzeile stehen so nur einmal im Code.
# 2. Platzhalter %%NAME%% werden mit Werten aus der Umgebung gefüllt (HTML-sicher): SITE_URL, STUDIO_VERSION und
#    OPERATOR_* fürs Impressum. In OPERATOR_ADDRESS trennt „\n“ die Zeilen (wie in der .env der Launcher-Website).
# 3. Zeilen mit „<!--if:NAME-->“ bleiben nur, wenn NAME einen Wert hat, Zeilen mit „<!--unless:NAME-->“ nur, wenn nicht.
# Nur POSIX-sh und awk – läuft im nginx-Image (BusyBox) wie auf jedem Linux oder Mac.
set -eu

[ $# -ge 1 ] || { echo "Aufruf: sh $0 <ordner> [<zielordner>]" >&2; exit 2; }
dir=$1
if [ $# -ge 2 ]; then
  rm -rf "$2"
  mkdir -p "$2"
  cp -R "$dir"/. "$2"/
  dir=$2
fi
[ -d "$dir/_partials" ] || { echo "Fehler: $dir/_partials fehlt." >&2; exit 1; }

find "$dir" -path "$dir/_partials" -prune -o -type f \( -name '*.html' -o -name '*.xml' -o -name robots.txt \) -print |
  while IFS= read -r file; do
    awk -v partials="$dir/_partials" '
      function esc(s) {
        gsub(/&/, "\\&amp;", s); gsub(/</, "\\&lt;", s); gsub(/>/, "\\&gt;", s); gsub(/"/, "\\&quot;", s)
        return s
      }
      function emit(line,    i, key, out, p, tag, want, has) {
        # Bedingte Zeilen
        while (match(line, /<!--(if|unless):[A-Z_]+-->/)) {
          tag = substr(line, RSTART, RLENGTH)
          key = tag
          sub(/^<!--(if|unless):/, "", key)
          sub(/-->$/, "", key)
          want = (tag ~ /^<!--if:/)
          has = (raw[key] ~ /[^ \t]/)
          if (want != has) return
          line = substr(line, 1, RSTART - 1) substr(line, RSTART + RLENGTH)
        }
        sub(/[ \t]+$/, "", line)
        # Platzhalter (eingefügte Werte werden nicht erneut durchsucht)
        for (i = 1; i <= n; i++) {
          key = "%%" keys[i] "%%"
          out = ""
          while ((p = index(line, key)) > 0) {
            out = out substr(line, 1, p - 1) val[keys[i]]
            line = substr(line, p + length(key))
          }
          line = out line
        }
        print line
      }
      BEGIN {
        n = split("SITE_URL STUDIO_VERSION OPERATOR_NAME OPERATOR_ADDRESS OPERATOR_EMAIL OPERATOR_PHONE OPERATOR_REPRESENTATIVE OPERATOR_AUTHORITY", keys, " ")
        for (i = 1; i <= n; i++) {
          raw[keys[i]] = ENVIRON[keys[i]]
          val[keys[i]] = esc(ENVIRON[keys[i]])
        }
        gsub(/\\n/, "<br>", val["OPERATOR_ADDRESS"])
        if (val["SITE_URL"] == "") val["SITE_URL"] = "https://cubiq.studio"
        sub(/\/+$/, "", val["SITE_URL"])
        if (val["STUDIO_VERSION"] == "") val["STUDIO_VERSION"] = "dev"
      }
      /^[ \t]*<!--#include [a-z0-9_-]+-->[ \t]*$/ {
        indent = $0
        sub(/[^ \t].*$/, "", indent)
        name = $0
        sub(/^[ \t]*<!--#include /, "", name)
        sub(/-->[ \t]*$/, "", name)
        part = partials "/" name ".html"
        if ((getline line < part) <= 0) {
          print "Fehler: Baustein " part " fehlt oder ist leer." > "/dev/stderr"
          failed = 1
          exit 1
        }
        do {
          emit(line == "" ? "" : indent line)
        } while ((getline line < part) > 0)
        close(part)
        next
      }
      { emit($0) }
      END { if (failed) exit 1 }
    ' "$file" >"$file.tmp"
    mv "$file.tmp" "$file"
  done

rm -rf "$dir/_partials"
echo "Website fertig: $dir"
