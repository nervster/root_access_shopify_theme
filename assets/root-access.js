(function () {
  'use strict';

  var RA = window.RootAccess || {};
  var routes = RA.routes || { cartAdd: '/cart/add.js', cart: '/cart.js', cartChange: '/cart/change.js', cartUpdate: '/cart/update.js', pickupSlots: '/apps/plant-stock/pickup-slots', pickupHolds: '/apps/plant-stock/pickup-holds', myPickup: '/apps/plant-stock/my-pickup', plants: '/apps/plant-stock/plants', plantHolds: '/apps/plant-stock/plant-holds' };
  var limit = RA.maxPlants || 8;
  var lowStockAt = RA.lowStockAt || 3;
  var limitMsg = 'You can order up to ' + limit + ' plants at a time.';
  var state = RA.cart || { count: 0, items: {} };
  state.plants = (state.plants || []).map(String); // the chosen plants (_plant) in the cart
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
  // Plant Stock knows a cart (its pickup and plant holds) by the cart's token
  var cartToken = '';
  function loadCartToken() {
    if (cartToken) return Promise.resolve(cartToken);
    return fetch(routes.cart, { headers: { 'Accept': 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(function (cart) { cartToken = cart.token; return cartToken; });
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
        openPickers(dlg);
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
    if (form && pickerOf(form)) loadPlants(form);
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
    if (form.hasAttribute('data-picking')) { addPlants(form); return; }
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
    if (cart.token) cartToken = cart.token;
    state.count = cart.item_count;
    state.items = {};
    state.plants = [];
    cart.items.forEach(function (it) {
      state.items[it.variant_id] = (state.items[it.variant_id] || 0) + it.quantity;
      if (it.properties && it.properties._plant) state.plants.push(String(it.properties._plant));
    });
    setCount(cart.item_count);
    document.querySelectorAll('[data-add-form]').forEach(syncForm);
    document.querySelectorAll('[data-plant-picker]').forEach(function (picker) {
      if (picker.pick && picker.pick.mode === 'ready') renderPlants(picker.closest('[data-add-form]'));
    });
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
    if (form.hasAttribute('data-picking')) {
      // Chosen plants are added by photo, one line each, so there's no quantity to step
      stepper.hidden = true;
      btn.hidden = false;
      syncStockNote(form, qty);
      return;
    }
    stepper.hidden = qty === 0;
    btn.hidden = qty > 0;
    if (document.activeElement !== input || qty === 0) input.value = qty;
    input.max = Math.min(stockOf(form), qty + limit - state.count);
    var more = stepper.querySelector('[data-stepper-step="1"]');
    more.setAttribute('aria-disabled', qty >= input.max ? 'true' : 'false');
    syncStockNote(form, qty);
    if (hadFocus && document.activeElement && document.activeElement.closest('[hidden]')) (qty ? input : btn).focus();
  }

  // How many of the chosen plant are left, and how many of them this cart has; says so once it has them all
  function syncStockNote(form, qty) {
    var detail = form.closest('[data-detail]');
    var scope = detail || form.closest('.card');
    var note = scope && scope.querySelector(detail ? '[data-stock-note]' : '.card__body [data-stock-note]');
    if (!note) return;
    var left = stockOf(form);
    if (left === Infinity || left < 1) { note.hidden = true; return; }
    var all = qty >= left;
    var text;
    if (all) text = left === 1 ? 'The last one is in your cart' : 'All ' + left + ' are in your cart';
    else text = (left <= lowStockAt ? 'Only ' : '') + left + ' left' + (qty ? ' · ' + qty + ' in your cart' : '');
    note.textContent = text;
    note.classList.toggle('is-low', all || left <= lowStockAt);
    note.hidden = false;
  }

  var pending = {};
  function setQty(form, wanted) {
    var id = variantField(form).value;
    var have = state.items[id] || 0;
    var stock = stockOf(form);
    var room = have + limit - state.count;
    var qty = Math.max(0, Math.min(wanted, stock, room));
    if (wanted > qty) showToast(stock < room ? 'That’s all we have: ' + (stock === 1 ? 'the last one is' : 'all ' + stock + ' are') + ' in your cart.' : limitMsg);
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

  /* Plant picker: shoppers choose the exact plants they buy, one photo per plant, held for their cart
     (Plant Stock through the App Proxy; contract in its docs/plant-picker-storefront.md) */
  var PLANTS_UNAVAILABLE = 'Plants are unavailable right now. Please try again shortly.';
  var PICKER_STALE_MS = 30 * 60 * 1000; // photo links last an hour

  function pickerOf(form) { return RA.plantPicker ? form.querySelector('[data-plant-picker]') : null; }
  function pickerSay(picker, which, msg) {
    var el = picker.querySelector('[data-picker-' + which + ']');
    el.textContent = msg || '';
    el.hidden = !msg;
  }
  function inCart(id) { return state.plants.indexOf(String(id)) !== -1; }
  // 'loading', 'ready', 'unavailable', or 'off' (Plant Stock doesn't know this pot size: add as before)
  function setPickerMode(form, mode) {
    var picker = pickerOf(form);
    picker.pick.mode = mode;
    picker.hidden = mode === 'off';
    if (mode === 'off') form.removeAttribute('data-picking');
    else form.setAttribute('data-picking', '');
    if (mode === 'unavailable') {
      picker.querySelector('[data-picker-grid]').innerHTML = '';
      pickerSay(picker, 'status', '');
      pickerSay(picker, 'error', PLANTS_UNAVAILABLE);
    }
    syncForm(form);
    syncAddButton(form);
  }
  function syncAddButton(form) {
    var pick = pickerOf(form).pick;
    var btn = form.querySelector('[data-add-button]');
    var n = pick.selected.length;
    if (pick.mode === 'off') { btn.textContent = 'Add to cart'; btn.disabled = false; return; }
    var choosable = pick.plants.some(function (p) { return !inCart(p.id); });
    btn.textContent = n ? 'Add ' + n + (n === 1 ? ' plant' : ' plants') + ' to cart' : 'Add to cart';
    btn.disabled = pick.mode !== 'ready' || !choosable;
  }
  function renderPlants(form) {
    var picker = pickerOf(form);
    var pick = picker.pick;
    var grid = picker.querySelector('[data-picker-grid]');
    var total = pick.plants.length;
    pick.selected = pick.selected.filter(function (id) {
      return !inCart(id) && pick.plants.some(function (p) { return p.id === id; });
    });
    grid.innerHTML = '';
    pick.plants.forEach(function (plant, i) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      var img = document.createElement('img');
      var label = 'Plant ' + (i + 1) + ' of ' + total;
      var mine = inCart(plant.id);
      btn.type = 'button';
      btn.className = 'picker__plant';
      btn.setAttribute('data-plant-id', plant.id);
      btn.setAttribute('aria-pressed', pick.selected.indexOf(plant.id) !== -1 ? 'true' : 'false');
      btn.setAttribute('aria-label', mine ? label + ', in your cart' : label);
      img.src = plant.photo;
      img.alt = '';
      img.loading = 'lazy';
      btn.appendChild(img);
      if (mine) {
        var badge = document.createElement('span');
        badge.className = 'picker__badge';
        badge.textContent = 'In your cart';
        btn.appendChild(badge);
        btn.disabled = true;
      }
      var zoom = document.createElement('button');
      zoom.type = 'button';
      zoom.className = 'picker__zoom';
      zoom.setAttribute('data-plant-zoom', i);
      zoom.setAttribute('aria-label', 'Enlarge ' + label.toLowerCase());
      zoom.innerHTML = ZOOM_ICON;
      li.append(btn, zoom);
      grid.appendChild(li);
    });
    var choosable = pick.plants.some(function (p) { return !inCart(p.id); });
    pickerSay(picker, 'status', !total ? 'This size is sold out.' : choosable ? '' : 'All of these plants are in your cart.');
    syncAddButton(form);
    if (viewer && viewer.open && viewing.form === form) showInViewer(); // the list changed under the enlarged photo
  }
  // Answers for an older pot size, or from before a newer request, are ignored
  function loadPlants(form) {
    var picker = pickerOf(form);
    var pick = picker.pick || (picker.pick = { plants: [], selected: [], loadedAt: 0, request: 0 });
    var variant = variantField(form).value;
    var request = ++pick.request;
    if (pick.variant !== variant) {
      pick.variant = variant;
      pick.plants = [];
      pick.selected = [];
      picker.querySelector('[data-picker-grid]').innerHTML = '';
    }
    pickerSay(picker, 'error', '');
    pickerSay(picker, 'status', pick.plants.length ? '' : 'Loading plants…');
    setPickerMode(form, 'loading');
    return loadCartToken()
      .then(function (token) {
        return fetch(routes.plants + '?variant=' + encodeURIComponent(variant) + '&cartToken=' + encodeURIComponent(token), { headers: { 'Accept': 'application/json' } })
          .then(function (res) {
            return res.json().catch(function () { return null; }).then(function (data) { return { status: res.status, data: data }; });
          });
      })
      .catch(function () { return { status: 0, data: null }; })
      .then(function (r) {
        if (request !== pick.request) return;
        if (r.status === 200 && r.data && Array.isArray(r.data.plants)) {
          pick.plants = r.data.plants;
          pick.loadedAt = Date.now();
          setPickerMode(form, 'ready');
          renderPlants(form);
          return;
        }
        var code = r.data && r.data.error;
        if (code === 'not_found') { setPickerMode(form, 'off'); return; }
        if (code === 'invalid') console.error('Plant Stock rejected a plants request', r.data);
        setPickerMode(form, 'unavailable');
      });
  }
  // Quick views load their plants when opened; a list over 30 minutes old is loaded again
  function openPickers(scope) {
    scope.querySelectorAll('[data-add-form]').forEach(function (form) {
      var picker = pickerOf(form);
      if (!picker) return;
      var pick = picker.pick;
      if (!pick || pick.mode === 'unavailable' || pick.variant !== variantField(form).value || Date.now() - pick.loadedAt > PICKER_STALE_MS) loadPlants(form);
    });
  }

  // Chooses or unchooses one plant, from its tile or the enlarged view
  function togglePlant(form, id) {
    var picker = pickerOf(form);
    var pick = picker.pick;
    if (pick.mode !== 'ready' || inCart(id)) return;
    var at = pick.selected.indexOf(id);
    if (at === -1) {
      if (state.count + pick.selected.length + 1 > limit) { pickerSay(picker, 'error', limitMsg); return; }
      pick.selected.push(id);
    } else {
      pick.selected.splice(at, 1);
    }
    var tile = picker.querySelector('[data-plant-id="' + id + '"]');
    if (tile) tile.setAttribute('aria-pressed', at === -1 ? 'true' : 'false');
    pickerSay(picker, 'error', '');
    syncAddButton(form);
  }
  document.addEventListener('click', function (e) {
    var tile = e.target.closest('.picker__plant');
    if (!tile || tile.disabled) return;
    togglePlant(tile.closest('[data-add-form]'), parseInt(tile.getAttribute('data-plant-id'), 10));
  });

  /* Enlarged plant photos: one viewer for the page, opened from a tile's enlarge button. It sits on
     top of the quick view when opened from one, and steps through that pot size's plants */
  var ZOOM_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M10.5 7.5v6M7.5 10.5h6"/></svg>';
  var viewer = null;
  var viewing = { form: null, index: 0 };
  function buildViewer() {
    viewer = document.createElement('dialog');
    viewer.className = 'viewer';
    viewer.setAttribute('aria-label', 'Plant photo');
    viewer.innerHTML =
      '<button type="button" class="viewer__close" data-close-dialog aria-label="Close">&times;</button>' +
      '<img class="viewer__img" alt="" data-viewer-img>' +
      '<div class="viewer__bar">' +
        '<button type="button" class="viewer__nav" data-viewer-step="-1" aria-label="Previous plant">&lsaquo;</button>' +
        '<span class="viewer__count" data-viewer-count aria-live="polite"></span>' +
        '<button type="button" class="viewer__nav" data-viewer-step="1" aria-label="Next plant">&rsaquo;</button>' +
      '</div>' +
      '<button type="button" class="btn btn--solid btn--block" data-viewer-choose></button>';
    document.body.appendChild(viewer);
    viewer.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepViewer(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepViewer(1); }
    });
    // On phones, swiping across the photo steps to the next or previous plant
    var swipeX = null;
    viewer.addEventListener('touchstart', function (e) { swipeX = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    viewer.addEventListener('touchend', function (e) {
      if (swipeX === null) return;
      var dx = e.changedTouches[0].clientX - swipeX;
      swipeX = null;
      if (Math.abs(dx) > 40 && pickerOf(viewing.form).pick.plants.length > 1) stepViewer(dx < 0 ? 1 : -1);
    });
  }
  function showInViewer() {
    var plants = pickerOf(viewing.form).pick.plants;
    if (!plants.length) { viewer.close(); return; }
    viewing.index = Math.min(viewing.index, plants.length - 1);
    var plant = plants[viewing.index];
    var chosen = pickerOf(viewing.form).pick.selected.indexOf(plant.id) !== -1;
    var mine = inCart(plant.id);
    var choose = viewer.querySelector('[data-viewer-choose]');
    viewer.querySelector('[data-viewer-img]').src = plant.photo;
    viewer.querySelector('[data-viewer-count]').textContent = 'Plant ' + (viewing.index + 1) + ' of ' + plants.length;
    viewer.querySelectorAll('[data-viewer-step]').forEach(function (b) { b.hidden = plants.length < 2; });
    choose.textContent = mine ? 'In your cart' : chosen ? 'Chosen ✓ (tap to unchoose)' : 'Choose this plant';
    choose.disabled = mine;
    choose.classList.toggle('btn--outline', chosen);
    choose.classList.toggle('btn--solid', !chosen);
  }
  function stepViewer(by) {
    var n = pickerOf(viewing.form).pick.plants.length;
    viewing.index = (viewing.index + by + n) % n;
    showInViewer();
  }
  document.addEventListener('click', function (e) {
    var zoom = e.target.closest('[data-plant-zoom]');
    if (zoom) {
      if (!viewer) buildViewer();
      viewing.form = zoom.closest('[data-add-form]');
      viewing.index = parseInt(zoom.getAttribute('data-plant-zoom'), 10);
      showInViewer();
      viewer.showModal();
      return;
    }
    var step = e.target.closest('[data-viewer-step]');
    if (step) { stepViewer(parseInt(step.getAttribute('data-viewer-step'), 10)); return; }
    if (e.target.closest('[data-viewer-choose]')) {
      togglePlant(viewing.form, pickerOf(viewing.form).pick.plants[viewing.index].id);
      showInViewer();
    }
  });

  // Hold the chosen plants first, then add one cart line per plant; give the holds back if that fails
  function addPlants(form) {
    var picker = pickerOf(form);
    var pick = picker.pick;
    var btn = form.querySelector('[data-add-button]');
    var ids = pick.selected.slice();
    if (pick.mode !== 'ready' || btn.classList.contains('is-loading')) return;
    if (!ids.length) { pickerSay(picker, 'error', 'Tap a photo to choose a plant.'); return; }
    if (state.count + ids.length > limit) { pickerSay(picker, 'error', limitMsg); return; }
    var variant = parseInt(pick.variant, 10);
    var token;
    btn.classList.add('is-loading');
    pickerSay(picker, 'error', '');
    loadCartToken()
      .then(function (t) {
        token = t;
        return postJSON(routes.plantHolds, { cartToken: token, plants: ids });
      })
      .then(function (r) {
        if (r.status === 201 || r.status === 200) {
          var items = ids.map(function (id) { return { id: variant, quantity: 1, properties: { _plant: String(id) } }; });
          return postJSON(routes.cartAdd, { items: items }).then(function (added) {
            if (added.status !== 200) {
              postJSON(routes.plantHolds + '/release', { cartToken: token, plants: ids }).catch(function () {});
              pickerSay(picker, 'error', (added.data && (added.data.description || added.data.message)) || 'Could not add to cart.');
              return;
            }
            pick.selected = [];
            showToast(ids.length === 1 ? 'Plant added to cart' : ids.length + ' plants added to cart');
            return refreshCart()
              .then(function () { if (cartToken !== token) return moveHolds(token, cartToken, ids); })
              .then(function () { renderPlants(form); });
          });
        }
        var code = r.data && r.data.error;
        var msg = r.data && r.data.message;
        if (code === 'taken') {
          // Someone else got there first: show what's still free, keep the rest of the choice
          var gone = (r.data.plants || []).map(Number);
          pick.selected = pick.selected.filter(function (id) { return gone.indexOf(id) === -1; });
          return loadPlants(form).then(function () {
            if (pick.mode === 'ready') pickerSay(picker, 'error', msg || 'Someone else just chose that plant. Please pick another.');
          });
        }
        if (code === 'too_many_holds') { pickerSay(picker, 'error', msg || 'You’re holding as many plants as we allow right now.'); return; }
        if (code === 'not_found') { setPickerMode(form, 'off'); return; }
        if (code === 'invalid') console.error('Plant Stock rejected a plant hold request', r.data);
        setPickerMode(form, 'unavailable');
      })
      .catch(function () { setPickerMode(form, 'unavailable'); })
      .finally(function () { btn.classList.remove('is-loading'); });
  }

  // An empty cart's token can change when its first item goes in, so plants held just before that would
  // look like another cart's at Checkout: move their holds to the token the cart has now
  function moveHolds(from, to, ids) {
    return postJSON(routes.plantHolds + '/release', { cartToken: from, plants: ids })
      .then(function () { return postJSON(routes.plantHolds, { cartToken: to, plants: ids }); })
      .catch(function () { /* Checkout's refresh holds them again, or says which are gone */ });
  }

  if (RA.plantPicker && window.fetch) {
    // The product page loads its plants straight away; quick views wait until they're opened
    document.querySelectorAll('[data-plant-picker]').forEach(function (picker) {
      var form = picker.closest('[data-add-form]');
      form.setAttribute('data-picking', '');
      syncForm(form);
      if (!picker.closest('dialog')) loadPlants(form);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      document.querySelectorAll('[data-plant-picker]').forEach(function (picker) {
        var dlg = picker.closest('dialog');
        if (picker.pick && picker.pick.mode === 'ready' && (!dlg || dlg.open) && Date.now() - picker.pick.loadedAt > PICKER_STALE_MS) {
          loadPlants(picker.closest('[data-add-form]'));
        }
      });
    });
  }

  /* Cart page: chosen plants. Removing one gives its hold back; Checkout keeps them all for 30 more minutes */
  var plantError = document.querySelector('[data-plant-error]');
  function plantLines() { return Array.prototype.slice.call(document.querySelectorAll('[data-cart-form] [data-plant]')); }
  document.addEventListener('click', function (e) {
    var remove = e.target.closest('[data-plant-remove]');
    if (!remove || !window.fetch || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    var plant = parseInt(remove.getAttribute('data-plant-remove'), 10);
    loadCartToken()
      .then(function (token) { return postJSON(routes.plantHolds + '/release', { cartToken: token, plants: [plant] }); })
      .catch(function () {})
      .then(function () { window.location.href = remove.href; });
  });
  // Resolves true when every chosen plant in the cart is still held for it
  function refreshPlants() {
    var lines = plantLines();
    if (!lines.length) return Promise.resolve(true);
    var ids = lines.map(function (li) { return parseInt(li.getAttribute('data-plant'), 10); });
    return loadCartToken()
      .then(function (token) { return postJSON(routes.plantHolds + '/refresh', { cartToken: token, plants: ids }); })
      .then(function (r) {
        if (r.status === 200 || r.status === 201) return true;
        var code = r.data && r.data.error;
        if (code === 'taken') return removeTakenPlants((r.data.plants || []).map(String));
        if (code === 'too_many_holds') { showPlantError(r.data.message || 'You’re holding as many plants as we allow right now.'); return false; }
        if (code === 'invalid') console.error('Plant Stock rejected a plant hold refresh', r.data);
        showPlantError(PLANTS_UNAVAILABLE);
        return false;
      }, function () { showPlantError(PLANTS_UNAVAILABLE); return false; });
  }
  function showPlantError(msg) {
    if (!plantError) return;
    plantError.textContent = msg || '';
    plantError.hidden = !msg;
  }
  // Plants that can't be bought any more stay in the cart, marked, until the shopper has read why and
  // chosen to remove them; then the cart reloads without them
  var goneBox = document.querySelector('[data-plant-gone]');
  var goneKeys = [];
  function removeTakenPlants(ids) {
    var counts = {};
    var order = [];
    var total = 0;
    goneKeys = [];
    plantLines().forEach(function (li) {
      var gone = ids.indexOf(li.getAttribute('data-plant')) !== -1;
      li.classList.toggle('line--gone', gone);
      var note = li.querySelector('.line__gone');
      if (note) note.hidden = !gone;
      if (!gone) return;
      var name = li.getAttribute('data-plant-name');
      if (!counts[name]) { counts[name] = 0; order.push(name); }
      counts[name]++;
      total++;
      goneKeys.push(li.getAttribute('data-line-key'));
    });
    if (!total || !goneBox) { showPlantError(PLANTS_UNAVAILABLE); return Promise.resolve(false); }
    var list = order.map(function (name) { return counts[name] > 1 ? name + ' × ' + counts[name] : name; }).join(', ');
    goneBox.querySelector('[data-plant-gone-text]').textContent =
      (total === 1 ? 'One of the plants you chose is' : total + ' of the plants you chose are') +
      ' no longer available (' + list + '). Someone else may have ordered ' + (total === 1 ? 'it' : 'them') +
      ' first. Remove ' + (total === 1 ? 'it' : 'them') + ' to continue to checkout, then choose another if you like.';
    goneBox.querySelector('[data-plant-gone-remove]').textContent = total === 1 ? 'Remove it' : 'Remove them';
    goneBox.hidden = false;
    goneBox.querySelector('[data-plant-gone-remove]').focus();
    return Promise.resolve(false);
  }
  if (goneBox) {
    goneBox.querySelector('[data-plant-gone-remove]').addEventListener('click', function () {
      var btn = this;
      var updates = {};
      goneKeys.forEach(function (key) { updates[key] = 0; });
      btn.classList.add('is-loading');
      postJSON(routes.cartUpdate, { updates: updates })
        .catch(function () {})
        .then(function () { window.location.reload(); });
    });
  }
  // A note left by the earlier version of this message (it showed after a reload) is no longer used
  try { sessionStorage.removeItem('raPlantsTaken'); } catch (err) { /* nothing stored */ }

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
        // Keep the pickup hold and the chosen plants another 30 minutes (or take a pickup hold, for a
        // cart saved before holds) and leave for checkout only if Plant Stock agrees to both
        showPlantError('');
        Promise.all([holdId ? refreshHold() : placeHold(), refreshPlants()]).then(function (results) {
          if (!results[0] || !results[1]) return;
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
