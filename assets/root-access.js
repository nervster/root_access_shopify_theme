(function () {
  'use strict';

  var RA = window.RootAccess || {};
  var routes = RA.routes || { cartAdd: '/cart/add.js', cart: '/cart.js', cartChange: '/cart/change.js', cartUpdate: '/cart/update.js', pickupSlots: '/apps/plant-stock/pickup-slots', pickupHolds: '/apps/plant-stock/pickup-holds' };
  var limit = RA.maxPlants || 8;
  var limitMsg = 'You can order up to ' + limit + ' plants at a time.';
  var state = RA.cart || { count: 0, items: {} };
  var PICKUP_CLEARED = { 'Pickup date': '', 'Pickup window': '', 'Pickup hold': '' };

  // Resolves { status, data } for any HTTP answer; rejects only when the network fails
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (err) { data = null; }
        return { status: res.status, data: data };
      });
    });
  }
  function saveCartAttributes(attrs) {
    return postJSON(routes.cartUpdate, { attributes: attrs });
  }

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
    releaseIfEmpty(cart);
  }
  // An emptied cart gives its pickup slot back (the hold would otherwise run its 30 minutes)
  function releaseIfEmpty(cart) {
    var hold = cart.attributes && cart.attributes['Pickup hold'];
    if (cart.item_count > 0 || !hold) return;
    postJSON(routes.pickupHolds + '/release', { cartToken: cart.token, holdId: hold })
      .catch(function () {})
      .then(function () { return saveCartAttributes(PICKUP_CLEARED); })
      .catch(function () {});
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
  if (state.count === 0 && state.hold && window.fetch) refreshCart();

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

  /* Pickup date and window: Plant Stock decides which are open and holds the chosen one
     (App Proxy, signed by Shopify; contract in Plant Stock's docs/pickup-storefront.md) */
  var dateSelect = document.querySelector('[data-pickup-date]');
  var windowSelect = document.querySelector('[data-pickup-window]');
  if (dateSelect && windowSelect) {
    var pickupErr = document.querySelector('[data-pickup-error]');
    var pickupStatus = document.querySelector('[data-pickup-status]');
    var checkoutBtn = document.querySelector('[data-checkout]');
    var STALE_MS = 5 * 60 * 1000;
    var UNAVAILABLE = 'Pickup times are unavailable right now. Please try again shortly.';
    var GONE = 'That pickup time is no longer available. Please choose another.';
    var days = null;
    var cartToken = '';
    var holdId = state.hold || '';
    var loading = false;
    var busy = false;
    var loadedAt = 0;
    var confirmed = false;

    function showPickupError(msg) {
      if (!pickupErr) return;
      pickupErr.textContent = msg || '';
      pickupErr.hidden = !msg;
    }
    function showHeld(hold) {
      if (!pickupStatus) return;
      var until = hold && hold.expiresAt ? new Date(hold.expiresAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
      pickupStatus.textContent = until ? 'We’re holding this pickup time for you until ' + until + '.' : '';
      pickupStatus.hidden = !until;
    }
    function dayFor(date) {
      for (var i = 0; days && i < days.length; i++) if (days[i].date === date) return days[i];
      return null;
    }
    function fillWindows(day, keep) {
      var slots = day ? day.slots : [];
      windowSelect.innerHTML = '';
      windowSelect.add(new Option(day ? 'Select a window' : 'Choose a date first', ''));
      slots.forEach(function (slot) {
        var opt = new Option(slot.window, slot.window, false, slot.window === keep);
        opt.setAttribute('data-window-id', slot.windowId);
        windowSelect.add(opt);
      });
      windowSelect.disabled = !slots.length;
    }
    // A <select> rather than a date input, so full or closed days can be shown greyed out.
    // Keeps the given choice when it is still offered; otherwise the shopper picks again.
    function fillDates(keepDate, keepWindow) {
      dateSelect.innerHTML = '';
      dateSelect.add(new Option('Select a date', ''));
      days.forEach(function (day) {
        var open = day.slots.length > 0;
        var label = new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        var opt = new Option(open ? label : label + ' (full)', day.date, false, open && day.date === keepDate);
        opt.disabled = !open;
        dateSelect.add(opt);
      });
      dateSelect.disabled = false;
      fillWindows(dayFor(dateSelect.value), keepWindow);
    }
    function setUnavailable() {
      // Never let a shopper check out with a slot Plant Stock didn't confirm
      days = null;
      dateSelect.disabled = true;
      windowSelect.disabled = true;
      showHeld(null);
      showPickupError(UNAVAILABLE);
      if (checkoutBtn) checkoutBtn.disabled = true;
    }
    function setBusy(on) {
      busy = on;
      if (checkoutBtn) checkoutBtn.classList.toggle('is-loading', on);
      if (!days) return;
      dateSelect.disabled = on;
      windowSelect.disabled = on || windowSelect.options.length < 2;
    }
    // Holds belong to a cart, which Plant Stock knows by its token
    function loadCartToken() {
      if (cartToken) return Promise.resolve(cartToken);
      return fetch(routes.cart, { headers: { 'Accept': 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (cart) { cartToken = cart.token; return cartToken; });
    }
    // With the cart token, the slot this cart holds stays listed while other carts' holds are left out
    function loadSlots(keepDate, keepWindow) {
      loading = true;
      return loadCartToken()
        .then(function (token) {
          return fetch(routes.pickupSlots + '?cartToken=' + encodeURIComponent(token), { headers: { 'Accept': 'application/json' } });
        })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data || !Array.isArray(data.days)) throw new Error('Unexpected response');
          days = data.days;
          loadedAt = Date.now();
          fillDates(keepDate, keepWindow);
          if (checkoutBtn) checkoutBtn.disabled = false;
          return true;
        })
        .catch(function () { setUnavailable(); return false; })
        .finally(function () { loading = false; });
    }

    // What a hold answer means for the cart: 'ok', 'pick-again', 'limit' or 'unavailable'
    function holdOutcome(r) {
      if (r.status === 200 || r.status === 201) return 'ok';
      var code = r.data && r.data.error;
      if (r.status === 409 || code === 'not_found') return 'pick-again';
      if (code === 'too_many_holds') return 'limit';
      if (code === 'invalid') console.error('Plant Stock rejected a pickup hold request', r.data);
      return 'unavailable';
    }
    // The choice is gone: clear it here and on the cart, then show what's still open
    function pickAgain(msg) {
      holdId = '';
      showHeld(null);
      saveCartAttributes(PICKUP_CLEARED).catch(function () {});
      return loadSlots(dateSelect.value, '').then(function (ok) {
        if (!ok) return false;
        showPickupError(msg || GONE);
        windowSelect.focus();
        return false;
      });
    }
    // Resolves true when the cart holds the chosen slot
    function handleHold(r) {
      var outcome = holdOutcome(r);
      var msg = r.data && r.data.message;
      if (outcome === 'ok') {
        holdId = r.data.holdId;
        showHeld(r.data);
        showPickupError('');
        return saveCartAttributes({ 'Pickup date': r.data.date, 'Pickup window': r.data.window, 'Pickup hold': r.data.holdId })
          .then(function () { return true; }, function () { return true; });
      }
      if (outcome === 'pick-again') return pickAgain(msg);
      if (outcome === 'limit') {
        windowSelect.value = '';
        showPickupError(msg || 'You’re holding as many pickup times as we allow. Please try again later.');
        return false;
      }
      setUnavailable();
      return false;
    }
    function holdRequest(path, body) {
      setBusy(true);
      return loadCartToken()
        .then(function (token) {
          body.cartToken = token;
          return postJSON(routes.pickupHolds + path, body);
        })
        .then(handleHold, function () { setUnavailable(); return false; })
        .finally(function () { setBusy(false); });
    }
    function placeHold() {
      var opt = windowSelect.options[windowSelect.selectedIndex];
      return holdRequest('', { date: dateSelect.value, windowId: parseInt(opt.getAttribute('data-window-id'), 10) });
    }
    function refreshHold() { return holdRequest('/refresh', { holdId: holdId }); }

    function pickupProblem() {
      if (busy) return 'One moment, we’re confirming your pickup time.';
      if (!days) return loading ? 'Pickup times are still loading.' : UNAVAILABLE;
      if (!dateSelect.value) return 'Pick a pickup date.';
      if (!windowSelect.value) return 'Pick a pickup window.';
      return '';
    }
    function focusPickup() { (dateSelect.value ? windowSelect : dateSelect).focus(); }

    dateSelect.addEventListener('change', function () {
      // A new date means a new window; the hold moves when the shopper picks one
      fillWindows(dayFor(dateSelect.value), '');
      showPickupError('');
    });
    windowSelect.addEventListener('change', function () {
      showPickupError('');
      if (windowSelect.value) placeHold();
    });
    // A page left open a while shows an old list; refresh it when the shopper comes back
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && days && !busy && Date.now() - loadedAt > STALE_MS) {
        loadSlots(dateSelect.value, windowSelect.value);
      }
    });

    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', function (e) {
        if (confirmed) { confirmed = false; return; }
        e.preventDefault();
        var problem = pickupProblem();
        if (problem) {
          showPickupError(problem);
          focusPickup();
          return;
        }
        // Keep the hold another 30 minutes (or take one, for a cart saved before holds) and
        // leave for checkout only if Plant Stock agrees
        (holdId ? refreshHold() : placeHold()).then(function (ok) {
          if (!ok) return;
          confirmed = true;
          checkoutBtn.click();
        });
      });
    }

    if (window.fetch) loadSlots(dateSelect.getAttribute('data-saved'), windowSelect.getAttribute('data-saved'));
    else setUnavailable();
  }
})();
