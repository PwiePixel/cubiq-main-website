// Sprache früh festlegen, bevor die Seite gezeichnet wird: ?lang=de|en, gespeicherte Wahl oder Browsersprache.
// Die Seiten sind auf Deutsch geschrieben; für Englisch setzt site.js die Texte aus den data-en-Attributen ein.
;(function () {
  var lang = 'de'
  try {
    var query = new URLSearchParams(location.search).get('lang')
    var saved = localStorage.getItem('cubiq-studio-lang')
    if (query === 'de' || query === 'en') lang = query
    else if (saved === 'de' || saved === 'en') lang = saved
    else if (!/^de\b/i.test(navigator.language || '')) lang = 'en'
  } catch (e) {
    // Ohne Speicher (z. B. privates Fenster): Browsersprache reicht.
  }
  window.CUBIQ_LANG = lang
  if (lang !== 'de') {
    var root = document.documentElement
    root.classList.add('i18n-pending')
    // Sicherheitsnetz: Auch wenn ein Skript nicht lädt, ist die Seite nach einer Sekunde sichtbar.
    setTimeout(function () {
      root.classList.remove('i18n-pending')
    }, 1000)
  }
})()
