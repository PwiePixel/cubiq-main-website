# Cubiq Studio – Website

Die Hauptwebsite von **Cubiq Studio** (`cubiq.studio`): das Studio und seine Projekte – der Cubiq Launcher, die
Server-Software Cubiq (in Entwicklung) und OnYourSite (in Zusammenarbeit). Im selben Design wie die
[Launcher-Website](https://github.com/PwiePixel/Cubiq-Website), auf Deutsch und Englisch, ohne Cookies und ohne
Tracking. Sie läuft auf demselben Server wie die Launcher-Website und schaut dort jeden Morgen und jeden Abend selbst
nach Updates.

| Ordner / Datei | Inhalt |
|---|---|
| [`site/`](site) | Die Website: Startseite (`index.html`), Impressum, Datenschutz, 404-Seite, `assets/` (CSS, Skripte, Bilder, Schrift) |
| [`site/_partials/`](site/_partials) | Kopf (`head.html`), Kopfzeile mit Menü (`header.html`) und Fußzeile (`footer.html`) – stehen nur hier |
| [`site/assets/img/projects/`](site/assets/img/projects) | Bilder der Projekte (16:10, z. B. Screenshots der Websites) |
| [`deploy/studio-server.sh`](deploy/studio-server.sh) | Einrichten und Betrieb auf dem Server, automatische Updates |
| [`deploy/render.sh`](deploy/render.sh) | Setzt beim Bauen Kopf- und Fußzeile, Adresse, Version und Impressum ein |
| `Dockerfile`, `docker-compose.yml`, [`deploy/nginx.conf`](deploy/nginx.conf) | Webserver (nginx ohne Root-Rechte) im Container |

## Auf dem Server einrichten

Voraussetzung: Die Launcher-Website läuft auf dem Server schon (eingerichtet mit `deploy/cubiq-server.sh` aus
PwiePixel/Cubiq-Website). Die Studio-Seite nutzt deren Docker und deren Cloudflare-Tunnel mit – kein zweiter Server,
keine offenen Ports, keine zusätzlichen Kosten. Als root:

```bash
curl -fsSL -H "Authorization: token <GITHUB_TOKEN>" -o studio-server.sh \
  https://raw.githubusercontent.com/PwiePixel/cubiq-main-website/refs/heads/main/deploy/studio-server.sh
sudo bash studio-server.sh
```

`<GITHUB_TOKEN>`: github.com → Settings → Developer settings → Fine-grained tokens, nur für
`PwiePixel/cubiq-main-website`, Permissions: Contents → Read-only (das Skript fragt ihn einmal ab und hebt ihn für die
Updates auf). Bei einem öffentlichen Repository den Header weglassen – dann braucht es gar keinen Token.

Das Skript holt den Code nach `/opt/cubiq/cubiq-main-website`, fragt die Adresse (Vorgabe `cubiq.studio`, bei einer
Hauptdomain kommt `www.` dazu und leitet auf sie weiter), legt die DNS-Einträge im Cloudflare-Tunnel der
Launcher-Website an (einen schon vorhandenen Eintrag ersetzt es nur nach Rückfrage), übernimmt die Angaben fürs
Impressum aus der `.env` der Launcher-Website (`NUXT_PUBLIC_OPERATOR_*`), baut und startet die Seite und richtet die
automatischen Updates ein. Danach:

```bash
sudo bash /opt/cubiq/cubiq-main-website/deploy/studio-server.sh status
```

(statt `status` auch `update`, `update force`, `restart` oder `logs`).

## Updates morgens und abends

Jeden Tag um **6:15 und 18:15** (Serverzeit) läuft `studio-server.sh update` (`/etc/cron.d/cubiq-studio`):

1. Gibt es auf `main` einen neuen Stand, wird er geholt, gebaut und gestartet. Änderungen also einfach nach `main`
   bringen – spätestens nach dem nächsten Lauf sind sie online.
2. Die Versionsnummern an den Projekten werden aufgefrischt (neueste Version von Launcher und Server, von der
   Launcher-Website und der öffentlichen GitHub-API nach `/opt/cubiq/studio-data/feed.json`). Die Besucher laden sie
   nur von diesem Server.
3. Einmal pro Woche wird das nginx-Image neu geholt (Sicherheitsupdates).

Alles läuft auf deinem Server mit deinem GitHub-Token – keine weiteren Dienste. Log: `/opt/cubiq/studio-cron.log`.

Fine-grained Tokens laufen ab (Vorgabe: 30 Tage). Ist er abgelaufen, steht das im Log und es kommen keine Updates mehr
an – dann das Skript einmal ohne Zusatz starten und einen neuen Token eingeben. Am besten gleich ein spätes
Ablaufdatum wählen.

## Inhalte ändern

- **Neues Projekt:** in `site/index.html` einen `<article class="showcase-panel">`-Block kopieren und anpassen – die
  Projekte erscheinen einzeln nacheinander (am Desktop als „Bühne“ wie auf der Launcher-Website, die beim Scrollen
  stehen bleibt und die Projekte nacheinander einblendet; am Handy untereinander). Das Bild (16:10, z. B. ein
  Screenshot der Website mit 1280 × 800) kommt nach `site/assets/img/projects/`; ohne Bild den Block von „Cubiq Server“
  nehmen (Logo auf Würfel-Raster). Status-Abzeichen: `badge-live` (verfügbar), `badge-primary` (z. B. in
  Zusammenarbeit), `badge-caution` (in Entwicklung). Dazu je eine Zeile im Menü (`site/_partials/header.html`) und in
  der Fußzeile (`site/_partials/footer.html`).
- **Texte:** Deutsch steht im Element, Englisch daneben im Attribut `data-en="…"` (mit HTML: `data-en-html`, für
  Bildbeschreibungen `data-en-alt`). Fehlt der englische Text, bleibt der deutsche stehen.
- **Aussehen:** `site/assets/css/site.css` – dieselben Farben und Bausteine wie die Launcher-Website.
- **Impressum:** auf dem Server in `/opt/cubiq/Cubiq-Website/api/.env` (`NUXT_PUBLIC_OPERATOR_*`), danach
  `studio-server.sh restart`. Die E-Mail-Adresse von dort steckt auch im Knopf „Schreib uns“.

## Ausprobieren

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Dann http://localhost:8080. Ohne Docker geht es auch, nur ohne saubere Adressen (`/impressum.html` statt
`/impressum`):

```bash
sh deploy/render.sh site .preview && python3 -m http.server -d .preview 8080
```

## Schrift

Inter (SIL Open Font License 1.1, siehe [`site/assets/fonts/OFL-Inter.txt`](site/assets/fonts/OFL-Inter.txt)) – liegt
auf dem eigenen Server, keine Google Fonts.
