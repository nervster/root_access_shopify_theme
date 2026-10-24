(function () {
  'use strict';

  var RA = window.RootAccess || {};
  var routes = RA.routes || { cartAdd: '/cart/add.js', cart: '/cart.js', cartChange: '/cart/change.js' };
  var limit = RA.maxPlants || 8;
  var limitMsg = 'You can order up to ' + limit + ' plants at a time.';
  var state = RA.cart || { count: 0, items: {} };

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
    var form = sel.closest('[data-add-form]');
    if (form) syncForm(form);
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
    if (state.count + 1 > limit) { showToast(limitMsg); return; }
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
        return refreshCart();
      })
      .catch(function (err) { showToast(err.message); })
      .finally(function () { if (btn) btn.classList.remove('is-loading'); });
  });

  /* Cart quantities: a stepper takes the Add to cart button's place once a plant is in the cart */
  function applyCart(cart) {
    state.count = cart.item_count;
    state.items = {};
    cart.items.forEach(function (it) { state.items[it.variant_id] = (state.items[it.variant_id] || 0) + it.quantity; });
    setCount(cart.item_count);
    document.querySelectorAll('[data-add-form]').forEach(syncForm);
  }
  function refreshCart() {
    return fetch(routes.cart, { headers: { 'Accept': 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(applyCart);
  }
  function variantField(form) { return form.querySelector('[name="id"]'); }
  function stockOf(form) {
    var field = variantField(form);
    var el = field.tagName === 'SELECT' ? field.options[field.selectedIndex] : field;
    var s = el && el.getAttribute('data-stock');
    return s ? parseInt(s, 10) : Infinity;
  }
  function syncForm(form) {
    var stepper = form.querySelector('[data-stepper]');
    var btn = form.querySelector('[data-add-button]');
    if (!stepper || !btn) return;
    var qty = state.items[variantField(form).value] || 0;
    var input = stepper.querySelector('[data-stepper-input]');
    var hadFocus = form.contains(document.activeElement) && document.activeElement !== variantField(form);
    stepper.hidden = qty === 0;
    btn.hidden = qty > 0;
    if (document.activeElement !== input || qty === 0) input.value = qty;
    input.max = Math.min(stockOf(form), qty + limit - state.count);
    if (hadFocus && document.activeElement && document.activeElement.closest('[hidden]')) (qty ? input : btn).focus();
  }

  var pending = {};
  function setQty(form, wanted) {
    var id = variantField(form).value;
    var have = state.items[id] || 0;
    var stock = stockOf(form);
    var room = have + limit - state.count;
    var qty = Math.max(0, Math.min(wanted, stock, room));
    if (wanted > qty) showToast(stock < room ? 'Only ' + stock + ' available.' : limitMsg);
    form.querySelector('[data-stepper-input]').value = qty;
    clearTimeout(pending[id]);
    pending[id] = setTimeout(function () {
      if (qty === (state.items[id] || 0)) return;
      fetch(routes.cartChange, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ id: String(id), quantity: qty })
      })
        .then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok) throw new Error(data.description || data.message || 'Could not update your cart.');
            return data;
          });
        })
        .then(applyCart)
        .catch(function (err) { showToast(err.message); refreshCart(); });
    }, 350);
  }

  document.addEventListener('click', function (e) {
    var step = e.target.closest('[data-stepper-step]');
    if (!step) return;
    var form = step.closest('[data-add-form]');
    var input = form.querySelector('[data-stepper-input]');
    setQty(form, (parseInt(input.value, 10) || 0) + parseInt(step.getAttribute('data-stepper-step'), 10));
  });
  document.addEventListener('change', function (e) {
    var input = e.target.closest('[data-stepper-input]');
    if (input) setQty(input.closest('[data-add-form]'), parseInt(input.value, 10) || 0);
  });
  document.addEventListener('keydown', function (e) {
    // Enter commits the typed number instead of submitting the form (which would add another)
    if (e.key === 'Enter' && e.target.closest('[data-stepper-input]')) { e.preventDefault(); e.target.blur(); }
  });
  // Pages restored from the back/forward cache show an old cart
  window.addEventListener('pageshow', function (e) { if (e.persisted && window.fetch) refreshCart(); });
  document.querySelectorAll('[data-add-form]').forEach(syncForm);

  /* Cart page: no more than the plant limit per order */
  var cartPageForm = document.querySelector('[data-cart-form]');
  if (cartPageForm) {
    cartPageForm.addEventListener('submit', function (e) {
      var total = 0;
      cartPageForm.querySelectorAll('[data-qty]').forEach(function (q) { total += parseInt(q.value, 10) || 0; });
      var err = cartPageForm.querySelector('[data-qty-error]');
      if (total > limit) {
        e.preventDefault();
        if (err) { err.textContent = limitMsg + ' You have ' + total + '; lower a quantity, then update your cart.'; err.hidden = false; }
      } else if (err) {
        err.hidden = true;
      }
    });
  }

  /* Collection filters: price chips and the plant search box, applied together */
  function filterGrid(section) {
    var chip = section.querySelector('[data-filter].is-active');
    var price = chip ? chip.getAttribute('data-filter') : 'all';
    var box = section.querySelector('[data-plant-search]');
    var words = box ? box.value.toLowerCase().split(/\s+/).filter(Boolean) : [];
    var shown = 0;
    section.querySelectorAll('[data-grid] .card').forEach(function (card) {
      var text = card.getAttribute('data-search') || '';
      var match = (price === 'all' || card.getAttribute('data-price') === price) &&
        words.every(function (w) { return text.indexOf(w) !== -1; });
      card.hidden = !match;
      if (match) shown++;
    });
    var none = section.querySelector('[data-grid-none]');
    if (none) none.hidden = shown > 0;
  }
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-filter]');
    if (!chip) return;
    var section = chip.closest('.collection');
    section.querySelectorAll('[data-filter]').forEach(function (c) {
      var on = c === chip;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    filterGrid(section);
  });
  document.addEventListener('input', function (e) {
    var box = e.target.closest('[data-plant-search]');
    if (box) filterGrid(box.closest('.collection'));
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
