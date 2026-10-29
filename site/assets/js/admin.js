// Team-Bereich (/admin): Anmeldung mit Benutzername und Passwort, Team-Seite bearbeiten, Zugänge verwalten und das
// eigene Passwort ändern. Spricht nur mit dem eigenen Team-Server (/api/…, api/server.mjs); alles über textContent.
;(function () {
  'use strict'

  var COLORS = [['green', 'Grün'], ['lime', 'Hellgrün'], ['amber', 'Bernstein'], ['blue', 'Blau'], ['violet', 'Violett'], ['rose', 'Rosa']]
  var me = null
  var members = []

  function $(selector, root) {
    return (root || document).querySelector(selector)
  }

  function field(form, name) {
    return form.elements.namedItem(name)
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag)
    if (cls) node.className = cls
    if (text != null) node.textContent = text
    return node
  }

  function button(label, cls, onClick) {
    var b = el('button', 'btn ' + (cls || 'btn-ghost'), label)
    b.type = 'button'
    b.addEventListener('click', onClick)
    return b
  }

  function msg(node, text, ok) {
    node.textContent = text || ''
    node.hidden = !text
    node.classList.toggle('ok', Boolean(ok))
  }

  function api(path, method, body) {
    var opts = { method: method || 'GET', credentials: 'same-origin', headers: {} }
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
    return fetch('/api' + path, opts).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {}
        })
        .then(function (data) {
          if (res.status === 401 && me) {
            showLogin('Die Sitzung ist abgelaufen – bitte neu anmelden.')
          }
          if (!res.ok) throw new Error(data.error || 'Fehler ' + res.status)
          return data
        })
    })
  }

  // ---------------------------------------------------------------- Anmelden

  var loginForm = $('[data-login]')
  var app = $('[data-app]')

  function showLogin(note) {
    me = null
    app.hidden = true
    loginForm.hidden = false
    $('[data-who]').textContent = 'Nur für das Team.'
    msg($('[data-msg]', loginForm), note || '')
    field(loginForm, 'name').focus()
  }

  function showApp() {
    loginForm.hidden = true
    app.hidden = false
    var admin = me.role === 'admin'
    $('[data-me]').textContent = 'Angemeldet als ' + me.name + (admin ? ' (Admin)' : ' (Team)')
    $('[data-who]').textContent = admin ? 'Team-Seite und Zugänge verwalten.' : 'Team-Seite bearbeiten.'
    document.querySelectorAll('[data-admin-only]').forEach(function (n) {
      n.hidden = !admin
    })
    loadTeam()
    if (admin) loadUsers()
  }

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault()
    var submit = loginForm.querySelector('[type="submit"]')
    submit.disabled = true
    msg($('[data-msg]', loginForm), '')
    api('/login', 'POST', { name: field(loginForm, 'name').value, password: field(loginForm, 'password').value })
      .then(function (user) {
        me = user
        field(loginForm, 'password').value = ''
        showApp()
      })
      .catch(function (err) {
        msg($('[data-msg]', loginForm), err.message)
      })
      .then(function () {
        submit.disabled = false
      })
  })

  $('[data-logout]').addEventListener('click', function () {
    api('/logout', 'POST')
      .catch(function () {})
      .then(function () {
        showLogin('Abgemeldet.')
      })
  })

  // ---------------------------------------------------------------- Team-Seite

  var list = $('[data-members]')
  var teamMsg = $('[data-team-msg]')

  function changed() {
    msg(teamMsg, 'Nicht gespeichert')
  }

  function input(label, value, onInput, opts) {
    opts = opts || {}
    var wrap = el('label', 'admin-field' + (opts.wide ? ' wide' : ''))
    wrap.appendChild(el('span', 'label', label))
    var control = el(opts.multiline ? 'textarea' : 'input', 'field')
    if (opts.multiline) control.rows = 3
    if (opts.type) control.type = opts.type
    if (opts.placeholder) control.placeholder = opts.placeholder
    control.maxLength = opts.max || 100
    control.value = value || ''
    control.addEventListener('input', function () {
      onInput(control.value)
      changed()
    })
    wrap.appendChild(control)
    return wrap
  }

  function memberEditor(m, i) {
    var box = el('fieldset', 'member-editor')
    var legend = el('legend', null, i + 1 + '. ' + (m.name || 'Neues Mitglied'))
    box.appendChild(legend)
    var grid = el('div', 'editor-grid')
    grid.appendChild(input('Name', m.name, function (v) {
      m.name = v
      legend.textContent = i + 1 + '. ' + (v || 'Neues Mitglied')
    }, { max: 40 }))

    var colorWrap = el('label', 'admin-field')
    colorWrap.appendChild(el('span', 'label', 'Farbe'))
    var select = el('select', 'field')
    COLORS.forEach(function (c) {
      var o = el('option', null, c[1])
      o.value = c[0]
      select.appendChild(o)
    })
    select.value = m.color || 'green'
    select.addEventListener('change', function () {
      m.color = select.value
      changed()
    })
    colorWrap.appendChild(select)
    grid.appendChild(colorWrap)

    grid.appendChild(input('Rolle (Deutsch)', m.role.de, function (v) { m.role.de = v }, { max: 60, placeholder: 'z. B. Gründer' }))
    grid.appendChild(input('Rolle (Englisch)', m.role.en, function (v) { m.role.en = v }, { max: 60, placeholder: 'e.g. Founder' }))
    grid.appendChild(input('Über mich (Deutsch)', m.about.de, function (v) { m.about.de = v }, { max: 400, multiline: true }))
    grid.appendChild(input('Über mich (Englisch)', m.about.en, function (v) { m.about.en = v }, { max: 400, multiline: true }))
    for (var k = 0; k < 3; k++) {
      ;(function (k) {
        var link = m.links[k] || { label: '', url: '' }
        m.links[k] = link
        grid.appendChild(input('Link ' + (k + 1) + ': Name', link.label, function (v) { link.label = v }, { max: 30, placeholder: 'z. B. GitHub' }))
        grid.appendChild(input('Link ' + (k + 1) + ': Adresse', link.url, function (v) { link.url = v }, { max: 300, type: 'url', placeholder: 'https://…' }))
      })(k)
    }
    box.appendChild(grid)

    var actions = el('div', 'admin-actions')
    var up = button('Nach oben', 'btn-ghost', function () {
      members.splice(i - 1, 0, members.splice(i, 1)[0])
      renderMembers()
      changed()
    })
    up.disabled = i === 0
    var down = button('Nach unten', 'btn-ghost', function () {
      members.splice(i + 1, 0, members.splice(i, 1)[0])
      renderMembers()
      changed()
    })
    down.disabled = i === members.length - 1
    actions.appendChild(up)
    actions.appendChild(down)
    actions.appendChild(button('Entfernen', 'btn-ghost danger', function () {
      if (!window.confirm((m.name || 'Dieses Mitglied') + ' von der Team-Seite entfernen?')) return
      members.splice(i, 1)
      renderMembers()
      changed()
    }))
    box.appendChild(actions)
    return box
  }

  function renderMembers() {
    list.textContent = ''
    if (!members.length) list.appendChild(el('p', 'admin-hint', 'Noch keine Mitglieder – mit „Mitglied hinzufügen“ anfangen.'))
    members.forEach(function (m, i) {
      list.appendChild(memberEditor(m, i))
    })
  }

  function loadTeam() {
    api('/admin/team')
      .then(function (data) {
        members = data.members || []
        renderMembers()
        msg(teamMsg, '')
      })
      .catch(function (err) {
        msg(teamMsg, err.message)
      })
  }

  $('[data-add-member]').addEventListener('click', function () {
    members.push({ name: '', role: { de: '', en: '' }, about: { de: '', en: '' }, color: 'green', links: [] })
    renderMembers()
    changed()
    var inputs = list.querySelectorAll('.member-editor:last-child input')
    if (inputs.length) inputs[0].focus()
  })

  $('[data-save-team]').addEventListener('click', function () {
    var payload = members.map(function (m) {
      return {
        id: m.id,
        name: m.name,
        role: m.role,
        about: m.about,
        color: m.color,
        links: m.links.filter(function (l) {
          return l.label.trim() && l.url.trim()
        }),
      }
    })
    if (payload.some(function (m) { return !m.name.trim() })) {
      msg(teamMsg, 'Jedes Mitglied braucht einen Namen.')
      return
    }
    api('/admin/team', 'PUT', { members: payload })
      .then(function (data) {
        members = data.members
        renderMembers()
        msg(teamMsg, 'Gespeichert – die Team-Seite ist aktuell.', true)
      })
      .catch(function (err) {
        msg(teamMsg, err.message)
      })
  })

  // ---------------------------------------------------------------- Zugänge (nur Admins)

  var usersList = $('[data-users]')
  var usersMsg = $('[data-users-msg]')

  function renderUsers(users) {
    usersList.textContent = ''
    users.forEach(function (u) {
      var self = u.name.toLowerCase() === me.name.toLowerCase()
      var li = el('li', 'user-row')
      li.appendChild(el('strong', null, u.name + (self ? ' (du)' : '')))
      var role = el('select', 'field')
      ;[['team', 'Team'], ['admin', 'Admin']].forEach(function (r) {
        var o = el('option', null, r[1])
        o.value = r[0]
        role.appendChild(o)
      })
      role.value = u.role
      role.addEventListener('change', function () {
        api('/admin/users/' + encodeURIComponent(u.name), 'PATCH', { role: role.value })
          .then(function () {
            msg(usersMsg, 'Rolle von ' + u.name + ' geändert.', true)
            if (self) return api('/me').then(function (m) { me = m; showApp() })
          })
          .catch(function (err) {
            msg(usersMsg, err.message)
            loadUsers()
          })
      })
      li.appendChild(role)
      var pw = el('input', 'field')
      pw.type = 'password'
      pw.placeholder = 'Neues Passwort'
      pw.autocomplete = 'new-password'
      li.appendChild(pw)
      li.appendChild(button('Passwort setzen', 'btn-ghost', function () {
        api('/admin/users/' + encodeURIComponent(u.name), 'PATCH', { password: pw.value })
          .then(function () {
            pw.value = ''
            msg(usersMsg, 'Neues Passwort für ' + u.name + ' gesetzt.', true)
          })
          .catch(function (err) {
            msg(usersMsg, err.message)
          })
      }))
      li.appendChild(button('Löschen', 'btn-ghost danger', function () {
        if (!window.confirm('Zugang „' + u.name + '“ löschen?')) return
        api('/admin/users/' + encodeURIComponent(u.name), 'DELETE')
          .then(function () {
            if (self) showLogin('Dein Zugang wurde gelöscht.')
            else loadUsers()
          })
          .catch(function (err) {
            msg(usersMsg, err.message)
          })
      }))
      usersList.appendChild(li)
    })
  }

  function loadUsers() {
    api('/admin/users')
      .then(function (data) {
        renderUsers(data.users || [])
      })
      .catch(function (err) {
        msg(usersMsg, err.message)
      })
  }

  var addUser = $('[data-add-user]')
  addUser.addEventListener('submit', function (e) {
    e.preventDefault()
    var name = field(addUser, 'name').value
    api('/admin/users', 'POST', { name: name, password: field(addUser, 'password').value, role: field(addUser, 'role').value })
      .then(function () {
        addUser.reset()
        msg(usersMsg, 'Zugang ' + name + ' angelegt.', true)
        loadUsers()
      })
      .catch(function (err) {
        msg(usersMsg, err.message)
      })
  })

  // ---------------------------------------------------------------- Mein Passwort

  var pwForm = $('[data-password]')
  var pwMsg = $('[data-password-msg]')
  pwForm.addEventListener('submit', function (e) {
    e.preventDefault()
    if (field(pwForm, 'password').value !== field(pwForm, 'repeat').value) {
      msg(pwMsg, 'Die neuen Passwörter sind verschieden.')
      return
    }
    api('/me/password', 'POST', { current: field(pwForm, 'current').value, password: field(pwForm, 'password').value })
      .then(function () {
        pwForm.reset()
        msg(pwMsg, 'Passwort geändert.', true)
      })
      .catch(function (err) {
        msg(pwMsg, err.message)
      })
  })

  // ---------------------------------------------------------------- Start

  api('/me')
    .then(function (user) {
      me = user
      showApp()
    })
    .catch(function () {
      showLogin()
    })
})()
