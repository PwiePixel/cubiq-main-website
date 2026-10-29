// Cubiq Studio: Sprache (Deutsch im Text, Englisch in data-en-Attributen), Menü, Startbild und die Versionsnummern
// aus /data/feed.json, die der Server morgens und abends auffrischt (deploy/studio-server.sh update).
;(function () {
  'use strict'

  var DOCS = 'https://docs.cubiq.studio'
  var STORE_KEY = 'cubiq-studio-lang'
  var root = document.documentElement
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ---------------------------------------------------------------- Sprache
  //
  // data-en="…"        englischer Text des Elements
  // data-en-html="…"   englischer Inhalt mit HTML (nur eigene Texte aus den Seiten)
  // data-en-alt, data-en-aria-label, data-en-content, data-en-title   englische Attribute

  var EN_ATTRS = ['alt', 'aria-label', 'content', 'title']
  var SELECTOR = ['[data-en]', '[data-en-html]'].concat(EN_ATTRS.map(function (a) {
    return '[data-en-' + a + ']'
  })).join(', ')

  var lang = window.CUBIQ_LANG === 'en' ? 'en' : 'de'
  var originals = new Map()

  function translate() {
    var en = lang === 'en'
    document.querySelectorAll(SELECTOR).forEach(function (el) {
      var orig = originals.get(el)
      if (!orig) {
        orig = { text: el.textContent, html: el.innerHTML, attrs: {} }
        EN_ATTRS.forEach(function (a) {
          if (el.hasAttribute('data-en-' + a)) orig.attrs[a] = el.getAttribute(a)
        })
        originals.set(el, orig)
      }
      if (el.hasAttribute('data-en')) el.textContent = en ? el.getAttribute('data-en') : orig.text
      if (el.hasAttribute('data-en-html')) el.innerHTML = en ? el.getAttribute('data-en-html') : orig.html
      Object.keys(orig.attrs).forEach(function (a) {
        var value = en ? el.getAttribute('data-en-' + a) : orig.attrs[a]
        if (value != null) el.setAttribute(a, value)
      })
    })
  }

  // Links zur Launcher-Website (?lang=) und zur Doku (/de, /en) in derselben Sprache öffnen.
  function localizeLinks() {
    document.querySelectorAll('a[data-lang-link]').forEach(function (a) {
      var url
      try {
        url = new URL(a.href)
      } catch (e) {
        return
      }
      if (url.origin === DOCS) {
        var rest = url.pathname.replace(/^\/(de|en)(?=\/|$)/, '')
        url.pathname = '/' + lang + (rest === '/' ? '' : rest)
      } else {
        url.searchParams.set('lang', lang)
      }
      a.href = url.toString()
    })
  }

  function setLang(next, remember) {
    lang = next === 'en' ? 'en' : 'de'
    root.lang = lang
    if (remember) {
      try {
        localStorage.setItem(STORE_KEY, lang)
      } catch (e) {
        // Ohne Speicher gilt die Wahl nur bis zum Neuladen.
      }
    }
    translate()
    localizeLinks()
    renderTeam()
    document.querySelectorAll('[data-set-lang]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-set-lang') === lang))
    })
    root.classList.remove('i18n-pending')
  }

  document.querySelectorAll('[data-set-lang]').forEach(function (b) {
    b.addEventListener('click', function () {
      setLang(b.getAttribute('data-set-lang'), true)
    })
  })

  // ---------------------------------------------------------------- Menü

  var menuButton = document.querySelector('.menu-button')
  var menu = document.getElementById('site-menu')

  function setMenu(open) {
    menu.hidden = !open
    menuButton.setAttribute('aria-expanded', String(open))
  }

  if (menuButton && menu) {
    menuButton.addEventListener('click', function () {
      setMenu(menu.hidden)
    })
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false)
    })
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && !menuButton.contains(e.target)) setMenu(false)
    })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) {
        setMenu(false)
        menuButton.focus()
      }
    })
  }

  // ---------------------------------------------------------------- Startbild (wie CubiqScene der Launcher-Website)

  // Kleiner, stabiler Zufall (mulberry32) – die Würfel liegen bei jedem Besuch gleich.
  function rng(seed) {
    var a = seed >>> 0
    return function () {
      a = (a + 0x6d2b79f5) >>> 0
      var x = a
      x = Math.imul(x ^ (x >>> 15), x | 1)
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
  }

  // Umriss eines isometrischen Würfels (Mitte 50/50, Kante 44) wie im Logo.
  function cubePath() {
    var r = 44
    var dx = (r * Math.sqrt(3)) / 2
    var dy = r / 2
    var p = function (x, y) {
      return x.toFixed(1) + ' ' + y.toFixed(1)
    }
    return 'M' + p(50, 50 - r) + 'L' + p(50 + dx, 50 - dy) + 'L' + p(50 + dx, 50 + dy) + 'L' + p(50, 50 + r) +
      'L' + p(50 - dx, 50 + dy) + 'L' + p(50 - dx, 50 - dy) + 'Z M' + p(50, 50) + 'L' + p(50 - dx, 50 - dy) +
      ' M' + p(50, 50) + 'L' + p(50 + dx, 50 - dy) + ' M' + p(50, 50) + 'L' + p(50, 50 + r)
  }

  function drawCubes(box, count, seed) {
    if (!box) return
    var random = rng(seed)
    var ns = 'http://www.w3.org/2000/svg'
    for (var i = 0; i < count; i++) {
      var size = 38 + random() * 56
      var svg = document.createElementNS(ns, 'svg')
      svg.setAttribute('viewBox', '0 0 100 100')
      svg.setAttribute('class', 'scene-cube')
      svg.style.left = 8 + random() * 84 + '%'
      svg.style.top = 10 + random() * 70 + '%'
      svg.style.width = size + 'px'
      svg.style.height = size + 'px'
      svg.style.opacity = String(0.1 + random() * 0.14)
      svg.style.animationDelay = -random() * 18 + 's'
      svg.style.animationDuration = 16 + random() * 10 + 's'
      if (reduced) svg.style.animation = 'none'
      var path = document.createElementNS(ns, 'path')
      path.setAttribute('d', cubePath())
      svg.appendChild(path)
      box.appendChild(svg)
    }
  }

  var hero = document.querySelector('[data-hero]')
  if (hero) {
    var scene = hero.querySelector('.scene')
    var glow = hero.querySelector('.hero-glow')
    var cta = hero.querySelector('[data-cta]')
    drawCubes(hero.querySelector('.scene-cubes'), window.innerWidth < 640 ? 3 : 4, 0x7e5)
    // Der Schein sitzt hinter dem Hauptknopf und leuchtet heller, solange man darauf zeigt. Er reicht über den
    // Startbereich hinaus und läuft weich aus – das Raster der Szene richtet sich nach demselben Punkt.
    var anchor = function (node) {
      if (!node || !cta) return
      var box = node.getBoundingClientRect()
      var a = cta.getBoundingClientRect()
      if (box.width < 1 || box.height < 1) return
      node.style.setProperty('--fx', Math.min(100, Math.max(0, ((a.left + a.width / 2 - box.left) / box.width) * 100)) + '%')
      node.style.setProperty('--fy', Math.min(100, Math.max(0, ((a.top + a.height / 2 - box.top) / box.height) * 100)) + '%')
    }
    var measure = function () {
      anchor(scene)
      anchor(glow)
    }
    measure()
    window.addEventListener('resize', measure)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure)
    if (cta) {
      var on = function () {
        hero.classList.add('hero-on')
      }
      var off = function () {
        hero.classList.remove('hero-on')
      }
      cta.addEventListener('mouseenter', on)
      cta.addEventListener('mouseleave', off)
      cta.addEventListener('focus', on)
      cta.addEventListener('blur', off)
    }
  }
  drawCubes(document.querySelector('.page-head .scene-cubes'), 3, 0x51d)

  // ---------------------------------------------------------------- Einblenden beim Scrollen

  if (!reduced && 'IntersectionObserver' in window) {
    var seen = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return
          entry.target.classList.add('fx-in')
          seen.unobserve(entry.target)
        })
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    root.classList.add('fx-ready')
    document.querySelectorAll('[data-fx="rise"]').forEach(function (el) {
      seen.observe(el)
    })
    document.querySelectorAll('[data-fx="stagger"]').forEach(function (list) {
      Array.prototype.forEach.call(list.children, function (el, i) {
        el.style.transitionDelay = Math.min(i, 6) * 70 + 'ms'
        seen.observe(el)
      })
    })
  }

  // ---------------------------------------------------------------- Projekte als Bühne (wie data-fx-showcase)
  //
  // Am Desktop bleibt der Abschnitt beim Scrollen stehen und die Projekte blenden nacheinander ein – je Projekt gut
  // eine halbe Bildschirmhöhe Scrollweg. Auf kleinen Bildschirmen und bei „Bewegung reduzieren“ stehen sie einfach
  // untereinander. Neue Projekte zählt die Bühne selbst mit.

  var HEADER = 64

  function showcase(section) {
    var pin = section.querySelector('.showcase-pin')
    var texts = Array.prototype.slice.call(section.querySelectorAll('.showcase-text'))
    var shots = Array.prototype.slice.call(section.querySelectorAll('.showcase-shot'))
    var stepList = section.querySelector('.showcase-steps')
    var n = Math.min(texts.length, shots.length)
    if (!pin || n < 2) return
    var steps = []
    for (var i = 0; i < n; i++) {
      var step = document.createElement('li')
      if (stepList) stepList.appendChild(step)
      steps.push(step)
    }
    var wide = window.matchMedia('(min-width: 1024px) and (min-height: 620px)')
    var active = -1
    var queued = false

    function run() {
      return section.offsetHeight - pin.offsetHeight
    }

    function update() {
      queued = false
      if (!section.hasAttribute('data-pinned')) return
      var distance = run()
      var p = distance > 0 ? Math.min(1, Math.max(0, (HEADER - section.getBoundingClientRect().top) / distance)) : 0
      var idx = Math.min(n - 1, Math.floor(p * n))
      if (idx === active) return
      active = idx
      for (var k = 0; k < n; k++) {
        texts[k].toggleAttribute('data-active', k === idx)
        shots[k].toggleAttribute('data-active', k === idx)
        steps[k].classList.toggle('on', k <= idx)
      }
    }

    function layout() {
      active = -1
      if (wide.matches && !reduced) {
        section.setAttribute('data-pinned', '')
        section.style.height = pin.offsetHeight + Math.round(window.innerHeight * 0.6 * (n - 1)) + 'px'
        update()
      } else {
        section.removeAttribute('data-pinned')
        section.style.height = ''
        texts.concat(shots).forEach(function (el) {
          el.removeAttribute('data-active')
        })
      }
    }

    window.addEventListener('scroll', function () {
      if (queued) return
      queued = true
      window.requestAnimationFrame(update)
    }, { passive: true })
    window.addEventListener('resize', layout)
    if (wide.addEventListener) wide.addEventListener('change', layout)

    // Tastatur: Landet der Fokus in einem verdeckten Projekt, dorthin scrollen.
    section.addEventListener('focusin', function (e) {
      if (!section.hasAttribute('data-pinned')) return
      for (var k = 0; k < n; k++) {
        if (k !== active && texts[k].contains(e.target)) {
          var top = window.pageYOffset + section.getBoundingClientRect().top - HEADER + (run() * (k + 0.5)) / n
          window.scrollTo(0, top)
          return
        }
      }
    })

    layout()
  }

  document.querySelectorAll('[data-showcase]').forEach(showcase)

  // ---------------------------------------------------------------- Versionsnummern (/data/feed.json)

  // Abzeichen mit data-feed="launcher-version" bzw. "server-version" zeigen die neueste Version.
  function showVersions(feed) {
    ;['launcher', 'server'].forEach(function (key) {
      var v = feed[key] && feed[key].version
      if (typeof v !== 'string' || !v) return
      document.querySelectorAll('[data-feed="' + key + '-version"]').forEach(function (n) {
        n.textContent = 'v' + v.replace(/^v/i, '')
        n.hidden = false
      })
    })
  }

  if (document.querySelector('[data-feed]') && window.fetch) {
    fetch('/data/feed.json', { cache: 'no-cache' })
      .then(function (res) {
        return res.ok ? res.json() : null
      })
      .then(function (data) {
        if (data && typeof data === 'object') showVersions(data)
      })
      .catch(function () {
        // Ohne Daten bleiben die Abzeichen einfach weg.
      })
  }

  // ---------------------------------------------------------------- Team-Seite (/api/team, gepflegt im Team-Bereich)

  var AVATAR_COLORS = ['green', 'lime', 'amber', 'blue', 'violet', 'rose']
  var team = null

  function pick(texts) {
    texts = texts || {}
    return texts[lang] || texts.de || texts.en || ''
  }

  function initials(name) {
    var parts = String(name).split(/[\s_.-]+/).filter(Boolean)
    return ((parts[0] || '?').charAt(0) + (parts[1] ? parts[1].charAt(0) : '')).toUpperCase()
  }

  function node(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function renderTeam() {
    var list = document.querySelector('[data-team]')
    if (!list || !team) return
    list.textContent = ''
    team.forEach(function (m) {
      var item = node('li', 'card member')
      var color = AVATAR_COLORS.indexOf(m.color) >= 0 ? m.color : 'green'
      item.style.setProperty('--c', 'var(--avatar-' + color + ')')
      var top = node('div', 'member-top')
      var avatar = node('span', 'avatar', initials(m.name))
      avatar.setAttribute('aria-hidden', 'true')
      top.appendChild(avatar)
      var who = node('div')
      who.appendChild(node('h2', 'member-name', m.name))
      if (pick(m.role)) who.appendChild(node('p', 'member-role', pick(m.role)))
      top.appendChild(who)
      item.appendChild(top)
      if (pick(m.about)) item.appendChild(node('p', 'member-about', pick(m.about)))
      var links = (m.links || []).filter(function (l) {
        return l && /^(https:|mailto:)/.test(String(l.url))
      })
      if (links.length) {
        var row = node('div', 'member-links')
        links.forEach(function (l) {
          var a = node('a', 'member-link', l.label)
          a.href = l.url
          if (/^https:/.test(l.url)) {
            a.target = '_blank'
            a.rel = 'noopener nofollow'
          }
          row.appendChild(a)
        })
        item.appendChild(row)
      }
      list.appendChild(item)
    })
    var empty = document.querySelector('[data-team-empty]')
    if (empty) empty.hidden = team.length > 0
  }

  if (document.querySelector('[data-team]') && window.fetch) {
    fetch('/api/team', { cache: 'no-cache' })
      .then(function (res) {
        return res.ok ? res.json() : { members: [] }
      })
      .catch(function () {
        return { members: [] }
      })
      .then(function (data) {
        team = Array.isArray(data.members) ? data.members : []
        renderTeam()
      })
  }

  // ---------------------------------------------------------------- Start

  document.querySelectorAll('[data-year]').forEach(function (n) {
    n.textContent = String(new Date().getFullYear())
  })
  setLang(lang, false)
})()
