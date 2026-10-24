(function () {
  'use strict';

  var RA = window.RootAccess || {};
  var routes = RA.routes || { cartAdd: '/cart/add.js', cart: '/cart.js', cartChange: '/cart/change.js', cartUpdate: '/cart/update.js', pickupSlots: '/apps/plant-stock/pickup-slots', pickupHolds: '/apps/plant-stock/pickup-holds', myPickup: '/apps/plant-stock/my-pickup' };
  var limit = RA.maxPlants || 8;
  var lowStockAt = RA.lowStockAt || 3;
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

  /* Pickup slots from Plant Stock's pickup-slots answer, for the cart and My pickup */
  function dateLabel(date) {
    return new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function dayIn(days, date) {
    for (var i = 0; days && i < days.length; i++) if (days[i].date === date) return days[i];
    return null;
  }
  // A <select> rather than a date input, so full or closed days can be shown greyed out.
  // Keeps the given choice when it is still offered; otherwise the customer picks again.
  function fillDateOptions(select, days, keep) {
    select.innerHTML = '';
    select.add(new Option('Select a date', ''));
    days.forEach(function (day) {
      var open = day.slots.length > 0;
      var label = dateLabel(day.date);
      var opt = new Option(open ? label : label + ' (full)', day.date, false, open && day.date === keep);
      opt.disabled = !open;
      select.add(opt);
    });
    select.disabled = false;
  }
  function fillWindowOptions(select, day, keep) {
    var slots = day ? day.slots : [];
    select.innerHTML = '';
    select.add(new Option(day ? 'Select a window' : 'Choose a date first', ''));
    slots.forEach(function (slot) {
      var opt = new Option(slot.window, slot.window, false, slot.window === keep);
      opt.setAttribute('data-window-id', slot.windowId);
      select.add(opt);
    });
    select.disabled = !slots.length;
  }
  function chosenWindowId(select) {
    return parseInt(select.options[select.selectedIndex].getAttribute('data-window-id'), 10);
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
    var note = detail && detail.querySelector('[data-stock-note]');
    if (note && opt) {
      var left = parseInt(opt.getAttribute('data-stock'), 10);
      var low = left > 0 && left <= lowStockAt;
      note.textContent = low ? 'Only ' + left + ' left' : '';
      note.hidden = !low;
    }
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
    function fillDates(keepDate, keepWindow) {
      fillDateOptions(dateSelect, days, keepDate);
      fillWindowOptions(windowSelect, dayIn(days, dateSelect.value), keepWindow);
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
      return holdRequest('', { date: dateSelect.value, windowId: chosenWindowId(windowSelect) });
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
      fillWindowOptions(windowSelect, dayIn(days, dateSelect.value), '');
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

  /* My pickup: a customer finds their order by number and email, then changes its pickup time or
     cancels it (Plant Stock through the App Proxy; contract in its docs/pickup-storefront.md) */
  var myPickup = document.querySelector('[data-my-pickup]');
  if (myPickup) {
    var mp = function (name) { return myPickup.querySelector('[data-mp-' + name + ']'); };
    var KEY_STORE = 'raMyPickupKey';
    var UNREACHABLE = 'We can’t reach your order right now. Please try again shortly.';
    var MESSAGES = {
      not_found: 'We couldn’t find an order with that number and email. Check both and try again.',
      too_many_lookups: 'Too many tries. Please wait 15 minutes and try again.',
      expired: 'Please enter your order number and email again.',
      too_late: 'It’s too late to change that.',
      taken: 'That pickup time was just taken. Please choose another.',
      too_soon: 'That pickup time is too soon now. Please choose another.',
      closed: 'That pickup time isn’t available. Please choose another.',
      too_far: 'That pickup time is too far ahead. Please choose another.'
    };
    var SLOT_GONE = ['taken', 'too_soon', 'closed', 'too_far'];
    var STATUS = {
      open: 'Being prepared',
      ready_for_pickup: 'Ready in the locker',
      picked_up: 'Picked up',
      cancelled: 'Cancelled'
    };
    var lookupForm = mp('lookup');
    var numberInput = mp('number-input');
    var emailInput = mp('email-input');
    var orderBox = mp('order');
    var changeForm = mp('change');
    var newDate = mp('date');
    var newWindow = mp('window');
    var confirmBox = mp('confirm');
    var key = '';
    var current = null;
    var slotDays = null;
    var busy = false;

    function say(el, msg) {
      el.textContent = msg || '';
      el.hidden = !msg;
    }
    function storeKey(k) {
      key = k;
      try {
        if (k) sessionStorage.setItem(KEY_STORE, k);
        else sessionStorage.removeItem(KEY_STORE);
      } catch (err) { /* the key then lasts only as long as this page */ }
    }
    function storedKey() {
      try { return sessionStorage.getItem(KEY_STORE) || ''; } catch (err) { return ''; }
    }
    // Pickup times are in Houston, wherever the customer is
    function houston(iso, opts) {
      opts.timeZone = 'America/Chicago';
      return new Date(iso).toLocaleString(undefined, opts);
    }
    function clock(iso) { return houston(iso, { hour: 'numeric', minute: '2-digit' }); }
    function describePickup(p) {
      return dateLabel(p.date) + ', ' + p.window + ' (' + clock(p.start) + '–' + clock(p.end) + ')';
    }
    // The message for a failed answer: Plant Stock's own sentence when it sent one
    function messageFor(r) {
      var code = r.data && r.data.error;
      if (code === 'invalid') console.error('Plant Stock rejected a My pickup request', r.data);
      if (!code || code === 'invalid' || r.status >= 500) return UNREACHABLE;
      return r.data.message || MESSAGES[code] || UNREACHABLE;
    }
    function send(path, body, btn) {
      busy = true;
      if (btn) btn.classList.add('is-loading');
      return postJSON(routes.myPickup + path, body)
        .catch(function () { return { status: 0, data: null }; })
        .finally(function () {
          busy = false;
          if (btn) btn.classList.remove('is-loading');
        });
    }

    // Each button shows only while the order allows it and its step isn't already open
    function syncActions() {
      var o = current || {};
      if (!o.canChangeTime) changeForm.hidden = true;
      if (!o.canCancel) confirmBox.hidden = true;
      mp('change-open').hidden = !o.canChangeTime || !changeForm.hidden;
      mp('cancel-open').hidden = !o.canCancel || !confirmBox.hidden;
    }
    function money(cents, currency) {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(cents / 100);
    }
    function addAmount(list, label, cents, currency, cls) {
      var row = document.createElement('div');
      var dt = document.createElement('dt');
      var dd = document.createElement('dd');
      if (cls) row.className = cls;
      dt.textContent = label;
      dd.textContent = money(cents, currency);
      row.append(dt, dd);
      list.appendChild(row);
    }
    // What was ordered and what was charged; left out when Plant Stock doesn't send them
    function showItems(order) {
      var items = order.items || [];
      var amounts = order.amounts;
      var currency = amounts && amounts.currency;
      var list = mp('item-list');
      var totals = mp('amounts');
      list.innerHTML = '';
      totals.innerHTML = '';
      items.forEach(function (item) {
        var li = document.createElement('li');
        var name = document.createElement('span');
        var price = document.createElement('span');
        name.textContent = item.title + (item.variant ? ' (' + item.variant + ')' : '') + ' × ' + item.quantity;
        if (item.totalCents != null) price.textContent = money(item.totalCents, currency);
        li.append(name, price);
        list.appendChild(li);
      });
      if (amounts) {
        addAmount(totals, 'Subtotal', amounts.subtotalCents, currency);
        if (amounts.discountCents > 0) addAmount(totals, 'Discount', -amounts.discountCents, currency);
        addAmount(totals, 'Tax', amounts.taxCents, currency);
        addAmount(totals, 'Total', amounts.totalCents, currency, 'mp__total');
        if (amounts.refundedCents > 0) addAmount(totals, 'Refunded', amounts.refundedCents, currency);
      }
      mp('items').hidden = !items.length && !amounts;
    }
    function showOrder(order) {
      current = order;
      showItems(order);
      mp('loading').hidden = true;
      lookupForm.hidden = true;
      orderBox.hidden = false;
      mp('number').textContent = order.order;
      mp('status').textContent = STATUS[order.status] || order.status;
      mp('pickup').textContent = order.pickup ? describePickup(order.pickup)
        : order.status === 'cancelled' ? 'None' : 'No pickup time is booked. We’ll be in touch to arrange one.';
      var limits = '';
      if (order.canCancel && order.cancelUntil) {
        limits = 'You can cancel until ' + houston(order.cancelUntil, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '.';
      } else if (order.canChangeTime && !order.canCancel) {
        limits = 'It’s too late to cancel this order here, but you can still change the pickup time.';
      }
      say(mp('limits'), limits);
      syncActions();
    }
    function showLookup(msg) {
      storeKey('');
      current = null;
      mp('loading').hidden = true;
      orderBox.hidden = true;
      changeForm.hidden = true;
      confirmBox.hidden = true;
      lookupForm.hidden = false;
      say(mp('lookup-error'), msg);
      numberInput.focus();
    }
    function clearMessages() {
      say(mp('note'), '');
      say(mp('error'), '');
    }
    // Failures after the lookup: an expired key starts over; too_late shows the order as it is now
    function showFailure(r) {
      var code = r.data && r.data.error;
      if (code === 'expired') { showLookup(messageFor(r)); return; }
      if (code === 'too_late' && r.data.order) showOrder(r.data.order);
      syncActions();
      say(mp('error'), messageFor(r));
    }

    lookupForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      var number = numberInput.value.trim();
      var email = emailInput.value.trim();
      if (!number || !email) {
        say(mp('lookup-error'), 'Enter your order number and the email you ordered with.');
        (number ? emailInput : numberInput).focus();
        return;
      }
      say(mp('lookup-error'), '');
      send('/lookup', { orderNumber: number, email: email }, lookupForm.querySelector('[type="submit"]')).then(function (r) {
        if (r.status === 200 && r.data && r.data.key) {
          storeKey(r.data.key);
          clearMessages();
          showOrder(r.data.order);
          mp('title').focus();
          return;
        }
        say(mp('lookup-error'), messageFor(r));
      });
    });
    mp('reset').addEventListener('click', function () {
      lookupForm.reset();
      clearMessages();
      showLookup('');
    });

    /* Changing the time: the current slot is booked, so it isn't among the choices; it's shown above them */
    function loadChoices(keepDate) {
      newDate.disabled = true;
      newWindow.disabled = true;
      return fetch(routes.pickupSlots, { headers: { 'Accept': 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data || !Array.isArray(data.days)) throw new Error('Unexpected response');
          slotDays = data.days;
          fillDateOptions(newDate, slotDays, keepDate);
          fillWindowOptions(newWindow, dayIn(slotDays, newDate.value), '');
          return true;
        })
        .catch(function () {
          say(mp('error'), 'Pickup times are unavailable right now. Please try again shortly.');
          return false;
        });
    }
    mp('change-open').addEventListener('click', function () {
      clearMessages();
      confirmBox.hidden = true;
      changeForm.hidden = false;
      syncActions();
      say(mp('current'), current.pickup ? 'Current: ' + describePickup(current.pickup) : '');
      loadChoices('').then(function (ok) { if (ok) newDate.focus(); });
    });
    mp('change-close').addEventListener('click', function () {
      changeForm.hidden = true;
      clearMessages();
      syncActions();
      mp('change-open').focus();
    });
    newDate.addEventListener('change', function () {
      fillWindowOptions(newWindow, dayIn(slotDays, newDate.value), '');
      say(mp('error'), '');
    });
    changeForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      if (!newDate.value || !newWindow.value) {
        say(mp('error'), newDate.value ? 'Pick a pickup window.' : 'Pick a pickup date.');
        (newDate.value ? newWindow : newDate).focus();
        return;
      }
      clearMessages();
      send('/change', { key: key, date: newDate.value, windowId: chosenWindowId(newWindow) }, mp('save')).then(function (r) {
        if (r.status === 200 && r.data && r.data.order) {
          changeForm.hidden = true;
          showOrder(r.data.order);
          if (r.data.order.pickup) say(mp('note'), 'Done. Your pickup time is now ' + describePickup(r.data.order.pickup) + '.');
          mp('title').focus();
          return;
        }
        var code = r.data && r.data.error;
        if (SLOT_GONE.indexOf(code) !== -1) {
          // Someone else took it, or it's no longer allowed: show what's open now and ask again
          loadChoices(newDate.value).then(function (ok) {
            if (!ok) return;
            say(mp('error'), messageFor(r));
            (newDate.value ? newWindow : newDate).focus();
          });
          return;
        }
        showFailure(r);
      });
    });

    /* Cancelling refunds the order in full, so it's confirmed first */
    mp('cancel-open').addEventListener('click', function () {
      clearMessages();
      changeForm.hidden = true;
      confirmBox.hidden = false;
      syncActions();
      mp('confirm-text').textContent = 'Cancel order ' + current.order + '? You’ll be refunded in full.';
      mp('cancel').focus();
    });
    mp('cancel-close').addEventListener('click', function () {
      confirmBox.hidden = true;
      syncActions();
      mp('cancel-open').focus();
    });
    mp('cancel').addEventListener('click', function () {
      if (busy) return;
      clearMessages();
      send('/cancel', { key: key }, mp('cancel')).then(function (r) {
        confirmBox.hidden = true;
        if (r.status === 200 && r.data && r.data.order) {
          showOrder(r.data.order);
          say(mp('note'), 'Your order is cancelled and your refund is on its way. Shopify will email you to confirm.');
          mp('title').focus();
          return;
        }
        showFailure(r);
      });
    });

    // A key from earlier in this visit shows the order straight away; a link can fill in the number
    var params = new URLSearchParams(window.location.search);
    if (params.get('order')) numberInput.value = params.get('order').replace(/^#/, '');
    var saved = storedKey();
    if (saved && window.fetch) {
      key = saved;
      lookupForm.hidden = true;
      mp('loading').hidden = false;
      send('', { key: saved }).then(function (r) {
        if (r.status === 200 && r.data && r.data.order) showOrder(r.data.order);
        else showLookup(r.data && r.data.error === 'expired' ? '' : messageFor(r));
      });
    }
  }
})();
