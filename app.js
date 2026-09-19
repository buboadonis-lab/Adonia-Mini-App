/* ==========================================================================
   Adonia Mini App
   Reads the product catalog from data.json (written/updated by the Android
   app), renders it, and provides search + a persistent shopping cart.

   No build step, no dependencies. Works in a plain browser and inside
   Telegram as a Mini App.
   ========================================================================== */

(function () {
  'use strict';

  var CONFIG = {
    dataUrl: 'data.json',          // catalog file, replaced by the Android app
    cartKey: 'adonia.cart.v1',     // localStorage key for the cart
    defaultCurrency: 'USD',
    autoRefreshMs: 60000           // re-check data.json every 60s for updates
  };

  /* ------------------------------------------------------------- state --- */

  var state = {
    products: [],       // normalized products
    visible: [],        // products after search + category filters
    cart: {},           // { productId: quantity }
    currency: CONFIG.defaultCurrency,
    storeName: 'Adonia',
    updatedAt: '',
    query: '',
    category: 'all',
    fingerprint: '',
    loading: false,
    error: ''
  };

  /* ------------------------------------------------------------ helpers --- */

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    storeName: $('storeName'),
    storeSub: $('storeSub'),
    searchInput: $('searchInput'),
    clearSearch: $('clearSearch'),
    refreshButton: $('refreshButton'),
    chips: $('categoryChips'),
    resultCount: $('resultCount'),
    updatedAt: $('updatedAt'),
    stateBox: $('stateBox'),
    stateTitle: $('stateTitle'),
    stateText: $('stateText'),
    stateAction: $('stateAction'),
    catalog: $('catalog'),
    cartBar: $('cartBar'),
    cartButton: $('cartButton'),
    cartCount: $('cartCount'),
    cartBarTitle: $('cartBarTitle'),
    cartBarSub: $('cartBarSub'),
    cartBarTotal: $('cartBarTotal'),
    cartPanel: $('cartPanel'),
    cartPanelCount: $('cartPanelCount'),
    cartItems: $('cartItems'),
    summaryItems: $('summaryItems'),
    summaryTotal: $('summaryTotal'),
    checkoutButton: $('checkoutButton'),
    clearCartButton: $('clearCartButton'),
    closeCart: $('closeCart'),
    overlay: $('overlay'),
    toast: $('toast')
  };

  var ICONS = {
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
    cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Normalize text for accent/case-insensitive search. */
  function norm(value) {
    var text = String(value == null ? '' : value).toLowerCase();
    if (text.normalize) {
      text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    return text;
  }

  /** First defined, non-empty value among the given candidate keys. */
  function pick(source, keys) {
    for (var i = 0; i < keys.length; i++) {
      var value = source[keys[i]];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  }

  function toNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    if (value === undefined || value === null) return 0;
    // Accept "1 250,50", "$12.00", "12.5" etc.
    var cleaned = String(value).replace(/[^\d.,-]/g, '');
    if (cleaned.indexOf(',') > -1 && cleaned.indexOf('.') > -1) {
      cleaned = cleaned.replace(/,/g, '');
    } else if (cleaned.indexOf(',') > -1) {
      cleaned = cleaned.replace(',', '.');
    }
    var parsed = parseFloat(cleaned);
    return isFinite(parsed) ? parsed : 0;
  }

  function formatPrice(amount) {
    var value = Number(amount) || 0;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: state.currency,
        maximumFractionDigits: value % 1 === 0 ? 0 : 2
      }).format(value);
    } catch (err) {
      // Unknown currency code — fall back to a plain number plus the code.
      var plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
      return plain + ' ' + state.currency;
    }
  }

  var toastTimer = null;
  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.hidden = false;
    // Keep the toast clear of the cart bar when it is on screen.
    var offset = els.cartBar && !els.cartBar.hidden ? els.cartBar.offsetHeight + 10 : 22;
    els.toast.style.bottom = 'calc(' + offset + 'px + var(--safe-b))';
    // Force a frame so the transition runs.
    requestAnimationFrame(function () { els.toast.classList.add('is-visible'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-visible');
      setTimeout(function () { els.toast.hidden = true; }, 220);
    }, 1900);
  }

  /* --------------------------------------------------------- data layer --- */

  /**
   * Accepts several plausible shapes so the Android side can evolve without
   * breaking the page:
   *   [ {...}, {...} ]                       -> array of products
   *   { "products": [ ... ] }                -> wrapped list
   *   { "store": {...}, "products": [...] }  -> wrapped list + metadata
   * Field names are matched case-insensitively with common aliases.
   */
  function extractProducts(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object') {
      var list = pick(payload, ['products', 'Products', 'items', 'Items', 'data', 'Data', 'catalog']);
      if (Array.isArray(list)) return list;
    }
    return [];
  }

  function normalizeProduct(raw, index) {
    if (!raw || typeof raw !== 'object') raw = { name: String(raw) };

    var id = pick(raw, ['id', 'ID', 'Id', 'sku', 'SKU', 'code', 'Code', 'barcode']);
    var name = pick(raw, ['name', 'Name', 'title', 'Title', 'productName', 'ProductName']) || 'Unnamed product';
    var priceRaw = pick(raw, ['price', 'Price', 'amount', 'Amount', 'unitPrice', 'UnitPrice', 'cost']);
    var image = pick(raw, ['image', 'Image', 'imageUrl', 'ImageUrl', 'image_url', 'photo', 'Photo', 'thumbnail', 'Thumbnail', 'img']);
    var category = pick(raw, ['category', 'Category', 'group', 'Group', 'type', 'Type']) || '';
    var description = pick(raw, ['description', 'Description', 'desc', 'details', 'Details']) || '';
    var stockRaw = pick(raw, ['stock', 'Stock', 'quantity', 'Quantity', 'qty', 'Qty', 'inventory']);
    var hasStock = stockRaw !== undefined;
    var stock = hasStock ? Math.max(0, Math.floor(toNumber(stockRaw))) : null;

    return {
      id: id === undefined ? 'p' + index : String(id),
      name: String(name),
      price: toNumber(priceRaw),
      image: image ? String(image) : '',
      category: String(category),
      description: String(description),
      stock: stock,
      available: stock === null ? true : stock > 0,
      search: norm([name, category, description, id].join(' '))
    };
  }

  function loadData(isManual) {
    if (state.loading) return;
    state.loading = true;
    state.error = '';
    if (isManual) els.refreshButton.classList.add('is-spinning');
    showState('loading');

    // Cache-busting query keeps Android-side updates visible immediately.
    var url = CONFIG.dataUrl + '?t=' + Date.now();

    fetch(url, { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + response.statusText);
        return response.text();
      })
      .then(function (text) {
        var payload;
        try {
          payload = JSON.parse(text);
        } catch (err) {
          throw new Error('data.json is not valid JSON.');
        }

        var fingerprint = String(text.length) + ':' + text.slice(0, 200);
        var unchanged = fingerprint === state.fingerprint && state.products.length > 0;
        state.fingerprint = fingerprint;

        if (!Array.isArray(payload) && payload && typeof payload === 'object') {
          var store = payload.store || payload.Store || payload.shop || payload.meta;
          if (store && typeof store === 'object') {
            var currency = pick(store, ['currency', 'Currency', 'currencyCode']);
            if (currency) state.currency = String(currency).toUpperCase();
            var storeName = pick(store, ['name', 'Name', 'title', 'Title']);
            if (storeName) state.storeName = String(storeName);
          }
          if (payload.currency) state.currency = String(payload.currency).toUpperCase();
          var updated = pick(payload, ['updatedAt', 'updated_at', 'UpdatedAt', 'lastUpdate', 'date']);
          if (updated) state.updatedAt = String(updated);
        }

        state.products = extractProducts(payload).map(normalizeProduct);
        state.loading = false;
        els.refreshButton.classList.remove('is-spinning');

        renderStoreMeta();
        renderChips();
        pruneCart();
        applyFilters();

        if (isManual) toast(unchanged ? 'Catalog is already up to date' : 'Catalog refreshed');
        if (state.products.length === 0) {
          showState('empty', 'No products yet', 'data.json loaded successfully but contains no products.');
        }
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || 'Unknown error';
        els.refreshButton.classList.remove('is-spinning');
        showState(
          'error',
          'Could not load products',
          state.error + ' Make sure data.json sits next to index.html and the page is opened over http(s), not file://.'
        );
      });
  }

  /* ------------------------------------------------------- presentation --- */

  function showState(kind, title, text) {
    if (kind === 'none') {
      els.stateBox.hidden = true;
      return;
    }
    els.stateBox.hidden = false;
    els.stateBox.classList.toggle('state--error', kind === 'error');
    els.stateBox.querySelector('.state__spinner').style.display = kind === 'loading' ? '' : 'none';

    els.stateTitle.textContent = title || (kind === 'loading' ? 'Loading products…' : '');
    els.stateText.textContent = text || (kind === 'loading' ? 'Fetching the latest catalog from data.json.' : '');

    var showRetry = kind === 'error';
    els.stateAction.hidden = !showRetry;
    els.stateAction.textContent = 'Try again';
  }

  function renderStoreMeta() {
    els.storeName.textContent = state.storeName;
    els.storeSub.textContent = state.products.length + (state.products.length === 1 ? ' product' : ' products');
    document.title = state.storeName + ' — Shop';

    if (state.updatedAt) {
      var date = new Date(state.updatedAt);
      els.updatedAt.textContent = isNaN(date.getTime())
        ? 'Updated ' + state.updatedAt
        : 'Updated ' + date.toLocaleString();
      els.updatedAt.hidden = false;
    } else {
      els.updatedAt.textContent = '';
      els.updatedAt.hidden = true;
    }
  }

  function renderChips() {
    var seen = {};
    var categories = [];
    state.products.forEach(function (product) {
      if (!product.category || seen[product.category]) return;
      seen[product.category] = true;
      categories.push(product.category);
    });
    categories.sort();

    els.chips.innerHTML = '';
    if (categories.length < 2) return; // no point filtering a single category

    var all = [{ label: 'All', value: 'all', count: state.products.length }];
    categories.forEach(function (category) {
      all.push({
        label: category,
        value: category,
        count: state.products.filter(function (p) { return p.category === category; }).length
      });
    });

    all.forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.textContent = item.label + ' (' + item.count + ')';
      button.setAttribute('aria-pressed', String(state.category === item.value));
      button.addEventListener('click', function () {
        state.category = item.value;
        renderChips();
        applyFilters();
      });
      els.chips.appendChild(button);
    });
  }

  function applyFilters() {
    var terms = norm(state.query).split(/\s+/).filter(Boolean);

    state.visible = state.products.filter(function (product) {
      if (state.category !== 'all' && product.category !== state.category) return false;
      if (terms.length === 0) return true;
      return terms.every(function (term) { return product.search.indexOf(term) > -1; });
    });

    renderProducts();
    updateResultCount();
  }

  function updateResultCount() {
    var total = state.products.length;
    var shown = state.visible.length;
    if (state.error) return;

    if (total === 0) {
      els.resultCount.textContent = 'No products in the catalog';
    } else if (shown === total && !state.query && state.category === 'all') {
      els.resultCount.textContent = total + (total === 1 ? ' product' : ' products');
    } else {
      els.resultCount.textContent = shown + ' of ' + total + ' products';
    }
  }

  function renderProducts() {
    els.catalog.innerHTML = '';

    if (state.visible.length === 0) {
      if (state.products.length > 0 && !state.error) {
        showState('empty', 'No matching products', 'Nothing matched “' + state.query + '”. Try a different word or clear the filters.');
      }
      els.catalog.innerHTML = '';
      return;
    }

    showState('none');
    var fragment = document.createDocumentFragment();

    state.visible.forEach(function (product) {
      fragment.appendChild(buildCard(product));
    });

    els.catalog.appendChild(fragment);
  }

  function buildCard(product) {
    var card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = product.id;
    if (state.cart[product.id]) card.classList.add('is-in-cart');

    // --- media
    var media = document.createElement('div');
    media.className = 'card__media';

    if (product.image) {
      var img = document.createElement('img');
      img.src = product.image;
      img.alt = product.name;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', function () {
        img.remove();
        media.insertBefore(buildPlaceholder(product), media.firstChild);
      });
      media.appendChild(img);
    } else {
      media.appendChild(buildPlaceholder(product));
    }

    if (!product.available) {
      var out = document.createElement('span');
      out.className = 'card__badge card__badge--out';
      out.textContent = 'Out of stock';
      media.appendChild(out);
    } else if (product.stock !== null && product.stock <= 5) {
      var low = document.createElement('span');
      low.className = 'card__badge';
      low.textContent = 'Only ' + product.stock + ' left';
      media.appendChild(low);
    }

    // --- body
    var body = document.createElement('div');
    body.className = 'card__body';

    if (product.category) {
      var category = document.createElement('span');
      category.className = 'card__category';
      category.textContent = product.category;
      body.appendChild(category);
    }

    var name = document.createElement('h3');
    name.className = 'card__name';
    name.textContent = product.name;              // textContent = no HTML injection
    name.title = product.name;
    body.appendChild(name);

    if (product.description) {
      var desc = document.createElement('p');
      desc.className = 'card__desc';
      desc.textContent = product.description;
      body.appendChild(desc);
    }

    var foot = document.createElement('div');
    foot.className = 'card__foot';

    var price = document.createElement('span');
    price.className = 'card__price';
    price.textContent = formatPrice(product.price);
    foot.appendChild(price);

    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'card__add';
    add.innerHTML = ICONS.plus;
    add.disabled = !product.available;
    add.setAttribute('aria-label', product.available ? 'Add ' + product.name + ' to cart' : product.name + ' is out of stock');
    add.addEventListener('click', function () {
      addToCart(product);
      var original = add.innerHTML;
      add.innerHTML = ICONS.plus;
      setTimeout(function () { add.innerHTML = original; }, 0);
    });
    foot.appendChild(add);

    body.appendChild(foot);
    card.appendChild(media);
    card.appendChild(body);
    return card;
  }

  function buildPlaceholder(product) {
    var placeholder = document.createElement('div');
    placeholder.className = 'card__placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.textContent = (product.name || '?').trim().charAt(0).toUpperCase() || '?';
    return placeholder;
  }

  /* --------------------------------------------------------------- cart --- */

  function cartCount() {
    return Object.keys(state.cart).reduce(function (sum, id) { return sum + state.cart[id]; }, 0);
  }

  function cartTotal() {
    return Object.keys(state.cart).reduce(function (sum, id) {
      var product = findProduct(id);
      return product ? sum + product.price * state.cart[id] : sum;
    }, 0);
  }

  function findProduct(id) {
    for (var i = 0; i < state.products.length; i++) {
      if (state.products[i].id === String(id)) return state.products[i];
    }
    return null;
  }

  /** Drop cart entries whose product no longer exists in the catalog. */
  function pruneCart() {
    var changed = false;
    Object.keys(state.cart).forEach(function (id) {
      if (!findProduct(id)) { delete state.cart[id]; changed = true; }
    });
    if (changed) saveCart();
    renderCart();
  }

  function addToCart(product) {
    if (!product.available) {
      toast(product.name + ' is out of stock');
      return;
    }
    var current = state.cart[product.id] || 0;
    if (product.stock !== null && current >= product.stock) {
      toast('Only ' + product.stock + ' in stock');
      return;
    }
    state.cart[product.id] = current + 1;
    saveCart();
    renderCart();

    els.cartButton.classList.remove('is-bumping');
    void els.cartButton.offsetWidth;   // restart the animation
    els.cartButton.classList.add('is-bumping');

    var card = els.catalog.querySelector('.card[data-id="' + CSS.escape(product.id) + '"]');
    if (card) card.classList.add('is-in-cart');

    toast(product.name + ' added to cart');
  }

  function setQuantity(id, quantity) {
    var product = findProduct(id);
    if (!product) return;

    if (quantity <= 0) {
      delete state.cart[id];
    } else {
      var max = product.stock === null ? Infinity : product.stock;
      state.cart[id] = Math.min(quantity, max);
    }

    saveCart();
    renderCart();

    var card = els.catalog.querySelector('.card[data-id="' + CSS.escape(id) + '"]');
    if (card) card.classList.toggle('is-in-cart', Boolean(state.cart[id]));
  }

  function saveCart() {
    try {
      localStorage.setItem(CONFIG.cartKey, JSON.stringify(state.cart));
    } catch (err) {
      /* storage disabled (private mode) — cart simply won't persist */
    }
  }

  function loadCart() {
    try {
      var raw = localStorage.getItem(CONFIG.cartKey);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.keys(parsed).forEach(function (id) {
          var quantity = Math.floor(Number(parsed[id]));
          if (quantity > 0) state.cart[id] = quantity;
        });
      }
    } catch (err) {
      state.cart = {};
    }
  }

  function renderCart() {
    var count = cartCount();
    var total = formatPrice(cartTotal());

    // Docked cart bar — hidden entirely while the cart is empty.
    els.cartBar.hidden = count === 0;
    els.cartCount.textContent = count > 99 ? '99+' : String(count);
    els.cartBarTitle.textContent = count === 1 ? '1 item' : count + ' items';
    els.cartBarSub.textContent = 'Review and check out';
    els.cartBarTotal.textContent = total;
    els.cartButton.setAttribute('aria-label', 'Review cart: ' + count + (count === 1 ? ' item' : ' items') + ', total ' + total);

    // Drawer
    els.cartPanelCount.textContent = String(count);
    els.summaryItems.textContent = String(count);
    els.summaryTotal.textContent = formatPrice(cartTotal());

    var ids = Object.keys(state.cart);
    els.cartItems.innerHTML = '';

    if (ids.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'cart-empty';
      empty.innerHTML = ICONS.cart +
        '<strong>Your cart is empty</strong>' +
        '<span>Add products from the catalog to see them here.</span>';
      els.cartItems.appendChild(empty);
    } else {
      ids.forEach(function (id) {
        var product = findProduct(id);
        if (!product) return;
        els.cartItems.appendChild(buildCartRow(product, state.cart[id]));
      });
    }

    var isEmpty = ids.length === 0;
    els.checkoutButton.disabled = isEmpty;
    els.clearCartButton.disabled = isEmpty;
    els.checkoutButton.textContent = isEmpty ? 'Checkout' : 'Checkout · ' + formatPrice(cartTotal());
  }

  function buildCartRow(product, quantity) {
    var row = document.createElement('div');
    row.className = 'cart-item';

    var media = document.createElement('div');
    media.className = 'cart-item__media';
    if (product.image) {
      var img = document.createElement('img');
      img.src = product.image;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', function () {
        img.remove();
        media.textContent = (product.name || '?').charAt(0).toUpperCase();
      });
      media.appendChild(img);
    } else {
      media.textContent = (product.name || '?').trim().charAt(0).toUpperCase() || '?';
    }

    var info = document.createElement('div');
    info.className = 'cart-item__info';
    var name = document.createElement('span');
    name.className = 'cart-item__name';
    name.textContent = product.name;
    name.title = product.name;
    var unit = document.createElement('span');
    unit.className = 'cart-item__price';
    unit.textContent = formatPrice(product.price) + ' each';
    info.appendChild(name);
    info.appendChild(unit);

    var side = document.createElement('div');
    side.className = 'cart-item__side';

    var qty = document.createElement('div');
    qty.className = 'qty';

    var minus = document.createElement('button');
    minus.type = 'button';
    minus.innerHTML = quantity === 1 ? ICONS.trash : ICONS.minus;
    minus.setAttribute('aria-label', quantity === 1 ? 'Remove ' + product.name : 'Decrease quantity of ' + product.name);
    minus.addEventListener('click', function () { setQuantity(product.id, quantity - 1); });

    var value = document.createElement('span');
    value.textContent = String(quantity);

    var plus = document.createElement('button');
    plus.type = 'button';
    plus.innerHTML = ICONS.plus;
    plus.setAttribute('aria-label', 'Increase quantity of ' + product.name);
    plus.disabled = product.stock !== null && quantity >= product.stock;
    plus.addEventListener('click', function () { setQuantity(product.id, quantity + 1); });

    qty.appendChild(minus);
    qty.appendChild(value);
    qty.appendChild(plus);

    var line = document.createElement('span');
    line.className = 'cart-item__line';
    line.textContent = formatPrice(product.price * quantity);

    side.appendChild(qty);
    side.appendChild(line);

    row.appendChild(media);
    row.appendChild(info);
    row.appendChild(side);
    return row;
  }

  /* ------------------------------------------------------------- drawer --- */

  var lastFocused = null;

  function openCart() {
    lastFocused = document.activeElement;
    els.overlay.hidden = false;
    els.cartPanel.hidden = false;
    requestAnimationFrame(function () {
      els.overlay.classList.add('is-open');
      els.cartPanel.classList.add('is-open');
    });
    document.body.classList.add('is-locked');
    els.closeCart.focus();
  }

  function closeCart() {
    els.overlay.classList.remove('is-open');
    els.cartPanel.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    setTimeout(function () {
      els.overlay.hidden = true;
      els.cartPanel.hidden = true;
    }, 300);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function isCartOpen() {
    return !els.cartPanel.hidden;
  }

  /* -------------------------------------------------------------- events --- */

  var searchTimer = null;
  els.searchInput.addEventListener('input', function (event) {
    var value = event.target.value;
    els.clearSearch.hidden = value.length === 0;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = value;
      applyFilters();
    }, 120);
  });

  els.clearSearch.addEventListener('click', function () {
    els.searchInput.value = '';
    els.clearSearch.hidden = true;
    state.query = '';
    applyFilters();
    els.searchInput.focus();
  });

  els.refreshButton.addEventListener('click', function () {
    state.fingerprint = '';   // force a re-render
    loadData(true);
  });

  els.stateAction.addEventListener('click', function () { loadData(true); });
  els.cartButton.addEventListener('click', openCart);
  els.closeCart.addEventListener('click', closeCart);
  els.overlay.addEventListener('click', closeCart);

  els.clearCartButton.addEventListener('click', function () {
    state.cart = {};
    saveCart();
    renderCart();
    els.catalog.querySelectorAll('.card.is-in-cart').forEach(function (card) {
      card.classList.remove('is-in-cart');
    });
    toast('Cart cleared');
  });

  els.checkoutButton.addEventListener('click', function () {
    var count = cartCount();
    if (count === 0) return;
    toast('Checkout: ' + count + ' items · ' + formatPrice(cartTotal()) + ' (connect a payment endpoint)');
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && isCartOpen()) closeCart();
    // "/" focuses the search field, like most storefronts
    if (event.key === '/' && document.activeElement !== els.searchInput) {
      event.preventDefault();
      els.searchInput.focus();
    }
  });

  /* -------------------------------------------- Telegram Mini App chrome --- */

  /**
   * Telegram opens Mini Apps with tgWebApp* launch parameters. Only then is the
   * platform script worth downloading — a plain browser visit skips it entirely.
   */
  function isTelegramLaunch() {
    return /(?:^|[#&?])tgWebApp/i.test(location.hash + location.search);
  }

  function loadTelegram(onDone) {
    if (!isTelegramLaunch()) { onDone(); return; }
    var script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js';
    script.onload = function () { initTelegram(); onDone(); };
    script.onerror = onDone;   // never block the storefront on a CDN hiccup
    document.head.appendChild(script);
  }

  function initTelegram() {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      if (tg.setHeaderColor) tg.setHeaderColor('secondary_bg_color');
      var theme = tg.themeParams || {};
      var root = document.documentElement.style;
      var map = {
        '--accent': theme.button_color,
        '--accent-contrast': theme.button_text_color,
        '--bg': theme.bg_color,
        '--surface': theme.secondary_bg_color,          // cards, search field
        '--surface-2': theme.section_bg_color || theme.secondary_bg_color,
        '--text': theme.text_color,
        '--muted': theme.hint_color
      };
      Object.keys(map).forEach(function (name) {
        if (map[name]) root.setProperty(name, map[name]);
      });
    } catch (err) {
      /* never let Telegram chrome break the page */
    }
  }

  /* ---------------------------------------------------------------- init --- */

  function init() {
    loadCart();
    renderCart();
    loadData(false);
    loadTelegram(function () { /* theme hook only — the catalog is already live */ });

    // Pick up changes the Android app uploads while the page stays open.
    setInterval(function () {
      if (document.hidden || state.loading || isCartOpen()) return;
      fetch(CONFIG.dataUrl + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function (response) { return response.ok ? response.text() : null; })
        .then(function (text) {
          if (!text) return;
          var fingerprint = String(text.length) + ':' + text.slice(0, 200);
          if (fingerprint !== state.fingerprint) loadData(false);
        })
        .catch(function () { /* offline — ignore */ });
    }, CONFIG.autoRefreshMs);

    // Coming back to the tab is a good moment to re-check.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !state.loading) {
        state.fingerprint = '';
        loadData(false);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
