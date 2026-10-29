#!/usr/bin/env bash
# Cubiq Studio – die Hauptwebsite (cubiq.studio) auf demselben Server wie die Launcher-Website betreiben.
# Für Ubuntu/Debian, als root, NACHDEM die Launcher-Website mit deploy/cubiq-server.sh (PwiePixel/Cubiq-Website)
# eingerichtet ist: Die Studio-Seite nutzt deren Docker und Cloudflare-Tunnel mit. Erneut starten geht jederzeit.
#
#   sudo bash studio-server.sh            einrichten bzw. Einstellungen ergänzen und neu starten
#   sudo bash studio-server.sh update     nach Updates schauen: neuer Stand auf GitHub → neu bauen; Versionen holen
#   sudo bash studio-server.sh restart    neu bauen und starten (z. B. nach Änderungen an der .env)
#   sudo bash studio-server.sh status     Zustand anzeigen
#   sudo bash studio-server.sh logs       Logs ansehen (Strg+C beendet)
#   sudo bash studio-server.sh user <Name> [admin|team]
#                                        Zugang zum Team-Bereich (/admin) anlegen oder Passwort neu setzen
#
# Nach dem Einrichten schaut der Server jeden Morgen (6:15) und jeden Abend (18:15, Serverzeit) selbst nach Updates
# (/etc/cron.d/cubiq-studio): Code von GitHub mit deinem Token, Versionsnummern von der Launcher-Website und GitHub.
# Dafür läuft nichts außer diesem Skript – keine weiteren Dienste, keine Kosten.

# shellcheck disable=SC1111 # „…“ sind deutsche Anführungszeichen im Text, keine Shell-Quotes.

set -euo pipefail
export GIT_TERMINAL_PROMPT=0

REPO_URL="${STUDIO_REPO:-https://github.com/PwiePixel/cubiq-main-website.git}"
BRANCH="${STUDIO_BRANCH:-main}"
BASE="${CUBIQ_DIR:-/opt/cubiq}"
SRC="$BASE/cubiq-main-website"
ENV_FILE="$SRC/.env"
DATA="$BASE/studio-data"
# Zugänge und Team-Seite des Team-Bereichs (nicht öffentlich, gehört dem Benutzer „node“ im Container).
PRIVATE="$BASE/studio-private"
NODE_UID=1000
BACKUPS="$BASE/backups"
TOKEN_FILE="$BASE/.github-token-studio"
LOG_FILE="$BASE/studio-cron.log"
LOCK_FILE="$BASE/.studio.lock"
STAMP="$BASE/.studio-built"
PROJECT="cubiq-studio"
DEFAULT_SITE="cubiq.studio"
# Basis-Image (nginx) spätestens nach so vielen Tagen neu holen – für Sicherheitsupdates.
REBUILD_DAYS=7
# Von der Launcher-Website (deploy/cubiq-server.sh): Einstellungen, Tunnel-Zugangsdaten und Docker-Netz.
LAUNCHER_API="$BASE/Cubiq-Website/api"
LAUNCHER_ENV="$LAUNCHER_API/.env"
CF_DIR="$BASE/cloudflared"
CF_IMAGE="cloudflare/cloudflared:latest"
TUNNEL_NETWORK="cubiq-api_tunnel"
# Hostnamen weiterer Websites im Tunnel – deploy/cubiq-server.sh behält sie, wenn es config.yml neu schreibt.
HOSTS_FILE="$BASE/tunnel-hosts"
# So erreicht cloudflared die Studio-Seite im Netz $TUNNEL_NETWORK (Alias aus docker-compose.yml).
SERVICE="http://studio:8080"

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*" >&2; }
die() {
  printf '\033[1;31mFehler:\033[0m %s\n' "$*" >&2
  exit 1
}

# ask VAR "Frage" "Vorgabe" – liest vom Terminal (funktioniert auch mit curl … | bash).
ask() {
  local __var=$1 __q=$2 __def=${3:-} __ans=''
  if [ -n "$__def" ]; then read -r -p "$__q [$__def]: " __ans </dev/tty || true; else read -r -p "$__q: " __ans </dev/tty || true; fi
  printf -v "$__var" '%s' "${__ans:-$__def}"
}

# ask_secret VAR "Frage" – ohne Anzeige der Eingabe.
ask_secret() {
  local __var=$1 __q=$2 __ans=''
  read -r -s -p "$__q: " __ans </dev/tty || true
  echo >&2
  printf -v "$__var" '%s' "$__ans"
}

yes_no() { case "$1" in j* | J* | y* | Y*) return 0 ;; *) return 1 ;; esac }

# env_get DATEI KEY – Wert aus einer .env (leer, wenn nicht gesetzt).
env_get() {
  [ -f "$1" ] || return 0
  awk -v key="$2" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { printf "%s", value }' "$1"
}

# env_set DATEI KEY WERT – ersetzt die Zeile „KEY=…“ oder hängt sie an. Rechte der Datei bleiben.
env_set() {
  local tmp
  tmp=$(mktemp)
  KEY="$2" VALUE="$3" awk '
    BEGIN { done = 0 }
    index($0, ENVIRON["KEY"] "=") == 1 && !done { print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; done = 1; next }
    { print }
    END { if (!done) print ENVIRON["KEY"] "=" ENVIRON["VALUE"] }' "$1" >"$tmp"
  cat "$tmp" >"$1"
  rm -f "$tmp"
}

# „https://cubiq.studio/“ → „cubiq.studio“
bare_host() {
  local h=${1#https://}
  h=${h#http://}
  printf '%s' "${h%%/*}"
}

# Domain, wie sie bei Cloudflare angelegt ist: die letzten zwei Teile (anders: CUBIQ_ZONE=…).
zone_for() {
  printf '%s' "${CUBIQ_ZONE:-$(awk -F. '{ print $(NF-1) "." $NF }' <<<"$1")}"
}

# Hostnamen der Studio-Seite: die Adresse und bei einer Hauptdomain (cubiq.studio) auch www.cubiq.studio.
studio_hosts() {
  local site
  site=$(bare_host "$(env_get "$ENV_FILE" SITE_URL)")
  [ -n "$site" ] || return 0
  printf '%s\n' "$site"
  case "$site" in
    *.*.*) ;;
    *) printf 'www.%s\n' "$site" ;;
  esac
}

# ---------------------------------------------------------------- Voraussetzungen

require_launcher() {
  if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
    die "Docker fehlt – zuerst die Launcher-Website mit deploy/cubiq-server.sh (PwiePixel/Cubiq-Website) einrichten."
  fi
  [ -f "$LAUNCHER_ENV" ] ||
    die "Die Launcher-Website ist hier noch nicht eingerichtet ($LAUNCHER_ENV fehlt) – zuerst deploy/cubiq-server.sh starten."
  docker network inspect "$TUNNEL_NETWORK" >/dev/null 2>&1 ||
    die "Das Docker-Netz $TUNNEL_NETWORK fehlt – läuft die Launcher-Website? sudo bash $BASE/Cubiq-Website/deploy/cubiq-server.sh status"
}

install_packages() {
  local missing=() cmd
  for cmd in git curl jq flock; do command -v "$cmd" >/dev/null || missing+=("$cmd"); done
  command -v cron >/dev/null || missing+=(cron)
  [ ${#missing[@]} -eq 0 ] && return 0
  say "Pakete installieren (${missing[*]}) …"
  apt-get update -qq
  # flock gehört zu util-linux.
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl jq cron util-linux ca-certificates >/dev/null
  systemctl enable --now cron >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------- Code

GIT_AUTH=()

auth_header() { printf 'http.extraHeader=Authorization: Basic %s' "$(printf 'x-access-token:%s' "$1" | base64 -w0)"; }

# Öffentliches Repository: kein Token. Privat: gespeicherten Token nehmen (auch den der Launcher-Website, falls er
# für dieses Repository gilt) oder einmal abfragen.
git_auth() {
  GIT_AUTH=()
  if git ls-remote --heads "$REPO_URL" >/dev/null 2>&1; then return 0; fi
  local token='' file
  for file in "$TOKEN_FILE" "$BASE/.github-token"; do
    [ -f "$file" ] || continue
    token=$(cat "$file")
    git -c "$(auth_header "$token")" ls-remote --heads "$REPO_URL" >/dev/null 2>&1 && break
    token=''
  done
  if [ -z "$token" ]; then
    [ -f "$TOKEN_FILE" ] && warn "Der gespeicherte GitHub-Token funktioniert nicht mehr (abgelaufen?)."
    echo
    say "Das Repository ist privat – dafür brauche ich einmal einen GitHub-Token mit Lesezugriff:"
    echo "    github.com → Settings → Developer settings → Fine-grained tokens → Generate new token"
    echo "    Repository access: nur PwiePixel/cubiq-main-website · Permissions: Contents → Read-only"
    echo "    Ablaufdatum möglichst spät wählen – mit einem abgelaufenen Token holt der Server keine Updates mehr."
    ask_secret token "GitHub-Token"
    [ -n "$token" ] || die "Ohne Token kann ich das private Repository nicht laden (im Cron-Lauf: einmal 'sudo bash $SRC/deploy/studio-server.sh' starten)."
    git -c "$(auth_header "$token")" ls-remote --heads "$REPO_URL" >/dev/null 2>&1 ||
      die "Der GitHub-Token hat keinen Zugriff auf $REPO_URL."
    mkdir -p "$BASE"
    # Für die automatischen Updates aufheben (nur root kann ihn lesen).
    (umask 077 && printf '%s' "$token" >"$TOKEN_FILE")
  fi
  GIT_AUTH=(-c "$(auth_header "$token")")
}

git_src() { git "${GIT_AUTH[@]+"${GIT_AUTH[@]}"}" -C "$SRC" "$@"; }

fetch_code() {
  git_auth
  if [ -d "$SRC/.git" ]; then
    git_src fetch --quiet --prune origin "$BRANCH"
    if [ "$(git_src rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
      git_src checkout --quiet "$BRANCH" 2>/dev/null || git_src checkout --quiet -b "$BRANCH" "origin/$BRANCH"
    fi
    git_src merge --ff-only --quiet "origin/$BRANCH" || die "Lokale Änderungen in $SRC verhindern das Update."
  else
    say "Code laden ($REPO_URL, Branch $BRANCH) …"
    mkdir -p "$BASE"
    git "${GIT_AUTH[@]+"${GIT_AUTH[@]}"}" clone --quiet --branch "$BRANCH" "$REPO_URL" "$SRC" ||
      die "Der Code ließ sich nicht laden (gibt es den Branch „$BRANCH“?)."
  fi
  [ -f "$SRC/docker-compose.yml" ] || die "Auf dem Branch „$BRANCH“ liegt noch keine Website (docker-compose.yml fehlt)."
}

# ---------------------------------------------------------------- Einstellungen (.env)

configure() {
  [ -f "$ENV_FILE" ] || cp "$SRC/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo
  say "Einstellungen (Enter übernimmt den Wert in Klammern)"
  local site
  site=$(bare_host "$(env_get "$ENV_FILE" SITE_URL)")
  ask site "Adresse der Studio-Website" "${site:-$DEFAULT_SITE}"
  site=$(bare_host "$site")
  [ -n "$site" ] || die "Die Website braucht eine Adresse."
  env_set "$ENV_FILE" SITE_URL "https://$site"
  env_set "$ENV_FILE" STUDIO_DATA "$DATA"
  env_set "$ENV_FILE" STUDIO_PRIVATE "$PRIVATE"
  env_set "$ENV_FILE" TUNNEL_NETWORK "$TUNNEL_NETWORK"
  sync_operator
  if [ -n "$(env_get "$ENV_FILE" OPERATOR_NAME)" ]; then
    say "Impressum: Angaben der Launcher-Website übernommen ($(env_get "$ENV_FILE" OPERATOR_NAME))."
  else
    warn "Impressum leer – in $LAUNCHER_ENV (NUXT_PUBLIC_OPERATOR_*) eintragen, dann: sudo bash $SRC/deploy/studio-server.sh restart"
  fi
}

# Impressum und Datenschutzerklärung nennen denselben Betreiber wie die Launcher-Website (NUXT_PUBLIC_OPERATOR_*).
sync_operator() {
  local key value
  for key in NAME ADDRESS EMAIL PHONE REPRESENTATIVE AUTHORITY; do
    value=$(env_get "$LAUNCHER_ENV" "NUXT_PUBLIC_OPERATOR_$key")
    [ -z "$value" ] || env_set "$ENV_FILE" "OPERATOR_$key" "$value"
  done
}

# ---------------------------------------------------------------- Cloudflare-Tunnel (der der Launcher-Website)

cfd() { docker run --rm -v "$CF_DIR:/home/nonroot/.cloudflared" "$CF_IMAGE" "$@"; }

tunnel() {
  local hosts host
  mapfile -t hosts < <(studio_hosts)
  if [ -n "$(env_get "$LAUNCHER_ENV" TUNNEL_TOKEN)" ]; then
    # Tunnel aus dem Cloudflare-Dashboard: Hostnamen trägt man dort ein.
    warn "Der Tunnel der Launcher-Website wird im Cloudflare-Dashboard verwaltet. Dort unter Networks → Tunnels →"
    warn "dein Tunnel → Public Hostname je Adresse eintragen: ${hosts[*]} → Service HTTP → studio:8080"
    return 0
  fi
  [ -f "$CF_DIR/cert.pem" ] && [ -f "$CF_DIR/config.yml" ] ||
    die "Cloudflare-Tunnel der Launcher-Website nicht gefunden ($CF_DIR) – zuerst deploy/cubiq-server.sh einrichten."
  docker pull -q "$CF_IMAGE" >/dev/null || die "Das cloudflared-Image ließ sich nicht laden (Internet?)."
  for host in "${hosts[@]}"; do route_dns "$host"; done
  register_hosts
  ensure_ingress
}

# DNS-Eintrag „host → Tunnel“. Gibt es für den Namen schon einen anderen Eintrag, wird erst gefragt.
route_dns() {
  local host=$1 out answer
  if out=$(cfd tunnel route dns cubiq "$host" 2>&1); then
    say "DNS: $host → Tunnel"
    return 0
  fi
  if grep -qi "already exists" <<<"$out"; then
    warn "Für $host gibt es schon einen DNS-Eintrag."
    ask answer "    Durch den Tunnel ersetzen? Was bisher unter $host lief, ist dann nicht mehr erreichbar. (j/n)" "n"
    if yes_no "$answer"; then
      cfd tunnel route dns --overwrite-dns cubiq "$host" >/dev/null 2>&1 || die "DNS-Eintrag für $host nicht gesetzt."
      say "DNS: $host → Tunnel"
    else
      warn "$host bleibt, wie es ist – dort ist die Studio-Seite nicht erreichbar."
    fi
    return 0
  fi
  printf '%s\n' "$out" >&2
  die "DNS-Eintrag für $host nicht gesetzt – liegt $(zone_for "$host") im selben Cloudflare-Konto wie die Launcher-Website?"
}

# Hostnamen in $HOSTS_FILE eintragen („hostname service“ je Zeile), damit deploy/cubiq-server.sh sie behält.
register_hosts() {
  local tmp host
  tmp=$(mktemp)
  echo "# hostname service – weitere Websites im Cloudflare-Tunnel (deploy/cubiq-server.sh übernimmt sie in config.yml)" >"$tmp"
  if [ -f "$HOSTS_FILE" ]; then
    awk -v svc="$SERVICE" '!/^#/ && NF >= 2 && $2 != svc' "$HOSTS_FILE" >>"$tmp"
  fi
  while read -r host; do printf '%s %s\n' "$host" "$SERVICE" >>"$tmp"; done < <(studio_hosts)
  cat "$tmp" >"$HOSTS_FILE"
  rm -f "$tmp"
  chmod 644 "$HOSTS_FILE"
}

# Studio-Hostnamen in config.yml des Tunnels: alte Einträge der Studio-Seite raus, aktuelle vor die 404-Regel.
# Läuft bei jedem Update mit – fehlen sie (z. B. nachdem cubiq-server.sh die Datei neu geschrieben hat), sind sie
# spätestens beim nächsten Update wieder da.
ensure_ingress() {
  local config="$CF_DIR/config.yml" tmp block='' host
  [ -f "$config" ] && [ -z "$(env_get "$LAUNCHER_ENV" TUNNEL_TOKEN)" ] || return 0
  while read -r host; do
    block+="  - hostname: $host"$'\n'"    service: $SERVICE"$'\n'
  done < <(studio_hosts)
  tmp=$(mktemp)
  if ! BLOCK="$block" SERVICE="$SERVICE" awk '
    held != "" {
      if ($0 == "    service: " ENVIRON["SERVICE"]) { held = ""; next }
      print held
      held = ""
    }
    /^  - hostname: / { held = $0; next }
    /^  - service: http_status:404/ { printf "%s", ENVIRON["BLOCK"]; inserted = 1 }
    { print }
    END {
      if (held != "") print held
      if (!inserted) exit 3
    }' "$config" >"$tmp"; then
    rm -f "$tmp"
    warn "$config hat ein unbekanntes Format – Studio-Hostnamen bitte selbst eintragen (Service $SERVICE)."
    return 0
  fi
  if cmp -s "$tmp" "$config"; then
    rm -f "$tmp"
    return 0
  fi
  # In die bestehende Datei schreiben: Besitzer (cloudflared) und Rechte bleiben.
  cat "$tmp" >"$config"
  rm -f "$tmp"
  say "Cloudflare-Tunnel: $(studio_hosts | tr '\n' ' ')→ Studio-Seite"
  (cd "$LAUNCHER_API" && docker compose restart cloudflared >/dev/null 2>&1) ||
    warn "cloudflared ließ sich nicht neu starten: sudo bash $BASE/Cubiq-Website/deploy/cubiq-server.sh restart"
}

# ---------------------------------------------------------------- Betrieb

compose() { (cd "$SRC" && docker compose "$@"); }

start() {
  sync_operator
  # Vor dem Team-Bereich eingerichtet: Ordner für Zugänge und Team-Seite nachtragen.
  [ -n "$(env_get "$ENV_FILE" STUDIO_PRIVATE)" ] || env_set "$ENV_FILE" STUDIO_PRIVATE "$PRIVATE"
  mkdir -p "$DATA" "$PRIVATE"
  chmod 755 "$DATA"
  chown "$NODE_UID:$NODE_UID" "$PRIVATE"
  chmod 700 "$PRIVATE"
  # Version für die Adressen von CSS und Skripten (?v=…): nach einem Update holt jeder Browser die neuen Dateien.
  STUDIO_VERSION=$(git -C "$SRC" rev-parse --short HEAD)
  export STUDIO_VERSION
  say "Studio-Website bauen und starten …"
  compose build --pull --quiet
  compose up -d --remove-orphans
  local state=starting service
  for service in web studio-api; do
    for _ in $(seq 1 24); do
      state=$(docker inspect -f '{{.State.Health.Status}}' "$PROJECT-$service-1" 2>/dev/null || echo starting)
      [ "$state" = healthy ] && break
      sleep 5
    done
    if [ "$state" != healthy ]; then
      compose logs --tail 40 "$service" || true
      die "Die Studio-Website ist nicht hochgekommen ($service, Logs oben)."
    fi
  done
  touch "$STAMP"
  docker image prune -f >/dev/null 2>&1 || true
  say "Studio-Website läuft (Stand $STUDIO_VERSION)."
}

reachable() {
  local url
  url=$(env_get "$ENV_FILE" SITE_URL)
  if curl -fsS --max-time 15 "$url/healthz" >/dev/null 2>&1; then
    say "Von außen erreichbar: $url"
  else
    warn "$url ist von außen noch nicht erreichbar – neue DNS-Einträge brauchen manchmal ein paar Minuten."
  fi
}

# Versionsnummern für die Startseite (/data/feed.json): neueste Version des Launchers (von der Launcher-Website) und
# der Server-Software (öffentliche GitHub-API). Ist keine Quelle erreichbar, bleibt der alte Stand.
refresh_feed() {
  local launcher releases server out
  launcher=$(env_get "$LAUNCHER_ENV" SITE_URL)
  launcher=${launcher:-https://launcher.cubiq.studio}
  releases=$(curl -fsS --max-time 20 "$launcher/v1/site/releases" 2>/dev/null) &&
    jq -e 'type == "object"' >/dev/null 2>&1 <<<"$releases" || releases='{}'
  server=$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/PwiePixel/Cubiq/releases?per_page=10" 2>/dev/null) &&
    jq -e 'type == "array"' >/dev/null 2>&1 <<<"$server" || server='[]'
  out=$(jq -n --argjson rel "$releases" --argjson srv "$server" --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
    {
      updated: $now,
      launcher: ($rel.release // null | if . == null then null else {version, date: .publishedAt, url: .pageUrl} end),
      server: ([$srv[] | select((.draft | not) and .tag_name != "snapshot")][0] // null
        | if . == null then null else {version: .tag_name, date: .published_at, url: .html_url} end)
    }') || {
    warn "Versionsnummern: Antworten nicht lesbar – der alte Stand bleibt."
    return 0
  }
  if [ "$(jq -r '.launcher != null or .server != null' <<<"$out")" != true ]; then
    warn "Versionsnummern: keine Quelle erreichbar – der alte Stand bleibt."
    return 0
  fi
  mkdir -p "$DATA"
  printf '%s\n' "$out" >"$DATA/feed.json.tmp"
  chmod 644 "$DATA/feed.json.tmp"
  mv "$DATA/feed.json.tmp" "$DATA/feed.json"
  say "Versionsnummern aktualisiert (Launcher $(jq -r '.launcher.version // "–"' <<<"$out"), Server $(jq -r '.server.version // "–"' <<<"$out"))."
}

# ask_password VAR "Frage" – zweimal, ohne Anzeige, mindestens 10 Zeichen.
ask_password() {
  local __var=$1 __q=$2 __a __b
  while true; do
    ask_secret __a "$__q (mindestens 10 Zeichen)"
    ask_secret __b "    Noch einmal"
    if [ "$__a" != "$__b" ]; then
      warn "Die beiden Eingaben sind verschieden."
    elif [ ${#__a} -lt 10 ]; then
      warn "Zu kurz."
    else
      break
    fi
  done
  printf -v "$__var" '%s' "$__a"
}

# Zugang zum Team-Bereich anlegen oder Passwort neu setzen (das Passwort geht über stdin, nie als Argument).
set_user() {
  local name=$1 role=${2:-admin} password
  [[ $name =~ ^[A-Za-z0-9_.-]{3,32}$ ]] || die "„$name“: 3–32 Zeichen aus Buchstaben, Ziffern, _ . -"
  [[ $role =~ ^(admin|team)$ ]] || die "Rolle: admin oder team"
  ask_password password "Passwort für $name"
  printf '%s' "$password" | compose exec -T studio-api node server.mjs user "$name" "$role" ||
    die "Zugang nicht gespeichert (läuft die Studio-Website? sudo bash $SRC/deploy/studio-server.sh status)."
}

# Beim Einrichten: Gibt es noch keinen Zugang, den ersten Admin anlegen.
ensure_admin() {
  [ -z "$(compose exec -T studio-api node server.mjs users 2>/dev/null)" ] || return 0
  echo
  say "Team-Bereich ($(env_get "$ENV_FILE" SITE_URL)/admin, nirgends verlinkt): ersten Admin-Zugang anlegen."
  local name
  ask name "Benutzername" "PixelCST"
  set_user "$name" admin
}

# Zugänge und Team-Seite sichern (die letzten 14 Sicherungen bleiben).
backup_private() {
  [ -n "$(ls -A "$PRIVATE" 2>/dev/null)" ] || return 0
  mkdir -p "$BACKUPS"
  chmod 700 "$BACKUPS"
  tar czf "$BACKUPS/studio-$(date +%Y-%m-%d-%H%M).tar.gz" -C "$BASE" "$(basename "$PRIVATE")" || warn "Sicherung der Team-Daten fehlgeschlagen."
  { ls -1t "$BACKUPS"/studio-*.tar.gz 2>/dev/null || true; } | tail -n +15 | xargs -r rm -f
}

schedule() {
  local self="$SRC/deploy/studio-server.sh"
  {
    echo "# Cubiq Studio (angelegt von deploy/studio-server.sh): morgens und abends nach Updates schauen."
    echo "SHELL=/bin/bash"
    echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    echo "15 6 * * * root flock -n $LOCK_FILE bash $self update >> $LOG_FILE 2>&1"
    echo "15 18 * * * root flock -n $LOCK_FILE bash $self update >> $LOG_FILE 2>&1"
  } >/etc/cron.d/cubiq-studio
  chmod 644 /etc/cron.d/cubiq-studio
}

# Das Log der automatischen Updates klein halten (die letzten 2000 Zeilen).
trim_log() {
  [ -f "$LOG_FILE" ] && [ "$(stat -c %s "$LOG_FILE")" -gt 1048576 ] || return 0
  local tmp
  tmp=$(mktemp)
  tail -n 2000 "$LOG_FILE" >"$tmp"
  cat "$tmp" >"$LOG_FILE"
  rm -f "$tmp"
}

# Basis-Image älter als REBUILD_DAYS Tage (oder noch nie gebaut)?
image_old() { [ ! -f "$STAMP" ] || [ -n "$(find "$STAMP" -mtime +"$REBUILD_DAYS" 2>/dev/null)" ]; }

update() {
  [ -f "$ENV_FILE" ] || die "Noch nicht eingerichtet – zuerst ohne Zusatz starten: sudo bash $0"
  trim_log
  echo "---- $(date '+%Y-%m-%d %H:%M') update"
  local before after reason=''
  before=$(git -C "$SRC" rev-parse HEAD)
  fetch_code
  after=$(git -C "$SRC" rev-parse HEAD)
  if [ "$before" != "$after" ]; then
    reason="neuer Stand: $(git -C "$SRC" log -1 --format='%h %s')"
  elif [ "${1:-}" = force ]; then
    reason="erzwungen"
  elif [ "$(docker inspect -f '{{.State.Running}}' "$PROJECT-web-1" 2>/dev/null || echo false)" != true ]; then
    reason="die Website lief nicht"
  elif image_old; then
    reason="Sicherheitsupdates für nginx holen"
  fi
  if [ -n "$reason" ]; then
    say "Neu bauen ($reason) …"
    start
  else
    say "Nichts Neues ($(git -C "$SRC" log -1 --format='%h %s'))."
  fi
  ensure_ingress
  refresh_feed
  backup_private
}

status() {
  compose ps
  echo
  echo "    Stand:        $(git -C "$SRC" log -1 --format='%h %s (%cr)')"
  echo "    Versionen:    $(jq -r '.updated // "–"' "$DATA/feed.json" 2>/dev/null || echo 'noch keine')"
  echo "    Updates:      jeden Tag 6:15 und 18:15 (Serverzeit), Log: $LOG_FILE"
  reachable
}

summary() {
  echo
  say "Fertig."
  echo "    Studio-Website:  $(env_get "$ENV_FILE" SITE_URL)"
  echo "    Updates:         jeden Morgen (6:15) und Abend (18:15) – neuer Stand auf GitHub wird gebaut,"
  echo "                     die Versionsnummern werden aufgefrischt. Log: $LOG_FILE"
  echo "    Team-Bereich:    $(env_get "$ENV_FILE" SITE_URL)/admin (nirgends verlinkt)"
  echo "                     Passwort vergessen: sudo bash $SRC/deploy/studio-server.sh user <Name>"
  echo "    Impressum:       aus $LAUNCHER_ENV (NUXT_PUBLIC_OPERATOR_*)"
  echo "    Einstellungen:   $ENV_FILE – danach: sudo bash $SRC/deploy/studio-server.sh restart"
}

install() {
  require_launcher
  install_packages
  fetch_code
  configure
  tunnel
  start
  ensure_admin
  refresh_feed
  schedule
  reachable
  summary
}

main() {
  [ "$(id -u)" = 0 ] || die "Bitte als root starten: sudo bash $0 ${1:-}"
  case "${1:-install}" in
    install | setup | '') install ;;
    update) update "${2:-}" ;;
    restart)
      start
      ensure_ingress
      refresh_feed
      ;;
    status) status ;;
    logs) compose logs -f --tail 100 ;;
    user)
      [ -n "${2:-}" ] || die "Aufruf: sudo bash $0 user <Name> [admin|team]"
      set_user "$2" "${3:-admin}"
      ;;
    *) die "Unbekannter Befehl „$1“ – erlaubt: install, update, restart, status, logs, user" ;;
  esac
}

# Erst ganz einlesen, dann ausführen (eine Zeile): Ein Update kann diese Datei während des Laufs ersetzen.
{ main "$@"; exit $?; }
