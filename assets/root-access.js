(function () {
  'use strict';

  var routes = (window.RootAccess && window.RootAccess.routes) || { cartAdd: '/cart/add.js', cart: '/cart.js' };

  /* Quick-view dialogs */
  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-open-dialog]');
    if (opener && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      var dlg = document.getElementById(opener.getAttribute('data-open-dialog'));
      if (dlg && typeof dlg.showModal === 'function') {
        e.preventDefault();
        dlg.showModal();
        return;
      }
    }
    if (e.target.closest('[data-close-dialog]')) {
      var d = e.target.closest('dialog');
      if (d) d.close();
      return;
    }
    if (e.target.tagName === 'DIALOG') {
      var r = e.target.getBoundingClientRect();
      var inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) e.target.close();
    }
  });

  /* Gallery thumbs */
  document.addEventListener('click', function (e) {
    var thumb = e.target.closest('[data-thumb]');
    if (!thumb) return;
    var detail = thumb.closest('[data-detail]');
    var idx = thumb.getAttribute('data-thumb');
    detail.querySelectorAll('[data-thumb]').forEach(function (t) {
      var on = t === thumb;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    detail.querySelectorAll('[data-frame]').forEach(function (f) {
      var on = f.getAttribute('data-frame') === idx;
      f.hidden = !on;
      f.classList.toggle('is-active', on);
    });
    var cap = detail.querySelector('[data-caption]');
    if (cap) cap.textContent = idx === '0' ? 'Your starting point' : idx === '1' ? 'What it can grow into' : thumb.textContent.trim();
  });

  /* Variant select updates price */
  document.addEventListener('change', function (e) {
    var sel = e.target.closest('[data-variant-select]');
    if (!sel) return;
    var opt = sel.options[sel.selectedIndex];
    var detail = sel.closest('[data-detail]');
    var price = detail && detail.querySelector('[data-price-display]');
    if (price && opt) price.textContent = opt.getAttribute('data-price');
  });

  /* Add to cart without leaving the page */
  var toast = document.getElementById('CartToast');
  var toastTimer;
  function showToast(msg) {
    if (!toast) return;
    toast.querySelector('[data-toast-msg]').textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 4000);
  }
  function setCount(n) {
    document.querySelectorAll('[data-cart-count]').forEach(function (el) { el.textContent = n; });
  }

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-add-form]');
    if (!form || !window.fetch) return;
    e.preventDefault();
    var btn = form.querySelector('[type="submit"]');
    if (btn) btn.classList.add('is-loading');
    fetch(routes.cartAdd, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: new FormData(form)
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data.description || r.data.message || 'Could not add to cart.');
        showToast((r.data.product_title || 'Plant') + ' added to cart');
        return fetch(routes.cart, { headers: { 'Accept': 'application/json' } }).then(function (res) { return res.json(); });
      })
      .then(function (cart) {
        if (cart) setCount(cart.item_count);
        var dlg = form.closest('dialog');
        if (dlg) dlg.close();
      })
      .catch(function (err) { showToast(err.message); })
      .finally(function () { if (btn) btn.classList.remove('is-loading'); });
  });

  /* Price filter chips */
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-filter]');
    if (!chip) return;
    var section = chip.closest('.collection');
    var val = chip.getAttribute('data-filter');
    section.querySelectorAll('[data-filter]').forEach(function (c) {
      var on = c === chip;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var shown = 0;
    section.querySelectorAll('[data-grid] .card').forEach(function (card) {
      var match = val === 'all' || card.getAttribute('data-price') === val;
      card.hidden = !match;
      if (match) shown++;
    });
    var none = section.querySelector('[data-grid-none]');
    if (none) none.hidden = shown > 0;
  });

  /* Pickup date rules */
  var dateInput = document.querySelector('[data-pickup-date]');
  if (dateInput) {
    var lead = parseInt(dateInput.getAttribute('data-lead-days') || '0', 10);
    var closed = (dateInput.getAttribute('data-closed-days') || '')
      .split(',').map(function (s) { return s.trim().slice(0, 3).toLowerCase(); }).filter(Boolean);
    var names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    var err = document.querySelector('[data-pickup-error]');
    function iso(d) {
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + m + '-' + day;
    }
    var min = new Date();
    min.setDate(min.getDate() + lead);
    while (closed.indexOf(names[min.getDay()]) !== -1) min.setDate(min.getDate() + 1);
    dateInput.min = iso(min);
    var max = new Date();
    max.setDate(max.getDate() + 30);
    dateInput.max = iso(max);

    function check() {
      var msg = '';
      if (dateInput.value) {
        var parts = dateInput.value.split('-');
        var picked = new Date(+parts[0], +parts[1] - 1, +parts[2]);
        if (dateInput.value < dateInput.min) msg = 'Pick a date on or after ' + dateInput.min + '.';
        else if (dateInput.value > dateInput.max) msg = 'Pick a date within the next 30 days.';
        else if (closed.indexOf(names[picked.getDay()]) !== -1) msg = 'Pickup isn\u2019t available on ' + names[picked.getDay()].replace(/^./, function (c) { return c.toUpperCase(); }) + '. Pick another day.';
      }
      dateInput.setCustomValidity(msg);
      if (err) { err.textContent = msg; err.hidden = !msg; }
      return !msg;
    }
    dateInput.addEventListener('change', check);
    check();

    var checkoutBtn = document.querySelector('[data-checkout]');
    var cartForm = document.querySelector('[data-cart-form]');
    if (checkoutBtn && cartForm) {
      checkoutBtn.addEventListener('click', function (e) {
        var win = cartForm.querySelector('[data-pickup-window]');
        var problems = [];
        if (!dateInput.value) problems.push('Pick a pickup date.');
        else if (!check()) problems.push(dateInput.validationMessage);
        if (win && !win.value) problems.push('Pick a pickup window.');
        if (problems.length) {
          e.preventDefault();
          if (err) { err.textContent = problems.join(' '); err.hidden = false; }
          (dateInput.value ? win : dateInput).focus();
        }
      });
    }
  }
})();
