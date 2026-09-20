/* Adonia Mini App storefront.
 * Reads the product list from data.json (published by the Android app on every sync),
 * renders a searchable grid, and keeps a persistent cart with an estimated total.
 * No build step, no framework — plain HTML/CSS/JS served from the repo via GitHub Pages.
 */
(function () {
  "use strict";

  var DATA_URL = "data.json";
  var CART_KEY = "adonia-mini-cart-v1";

  var state = {
    products: [],
    updatedAt: null,
    query: "",
    cart: loadCart()
  };

  var grid = document.getElementById("grid");
  var search = document.getElementById("search");
  var metaLine = document.getElementById("metaLine");
  var resultMeta = document.getElementById("resultMeta");
  var emptyState = document.getElementById("emptyState");
  var loadError = document.getElementById("loadError");
  var cartButton = document.getElementById("cartButton");
  var cartCount = document.getElementById("cartCount");
  var cartBar = document.getElementById("cartBar");
  var cartSummary = document.getElementById("cartSummary");
  var cartTotal = document.getElementById("cartTotal");
  var viewCart = document.getElementById("viewCart");
  var cartDialog = document.getElementById("cartDialog");
  var cartItems = document.getElementById("cartItems");
  var dialogTotal = document.getElementById("dialogTotal");
  var closeCart = document.getElementById("closeCart");
  var closeCart2 = document.getElementById("closeCart2");
  var clearCart = document.getElementById("clearCart");

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  fetch(DATA_URL, { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (feed) {
      state.products = Array.isArray(feed.products) ? feed.products : [];
      state.updatedAt = feed.updatedAt || null;
      pruneCart();
      render();
    })
    .catch(function () {
      metaLine.textContent = "خطا در بارگذاری فهرست";
      loadError.hidden = false;
    });

  // ---------------------------------------------------------------------------
  // Cart (persisted in localStorage so it survives reloads)
  // ---------------------------------------------------------------------------

  function loadCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      var cart = {};
      Object.keys(parsed).forEach(function (id) {
        var qty = parseInt(parsed[id], 10);
        if (qty > 0) cart[id] = qty;
      });
      return cart;
    } catch (e) {
      return {};
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
    } catch (e) {
      /* private mode etc. — the cart just won't persist */
    }
  }

  /** Drops cart lines whose product no longer exists in the feed. */
  function pruneCart() {
    var ids = {};
    state.products.forEach(function (p) { ids[String(p.id)] = true; });
    Object.keys(state.cart).forEach(function (id) {
      if (!ids[id]) delete state.cart[id];
    });
    saveCart();
  }

  function setQty(id, qty) {
    id = String(id);
    if (qty <= 0) delete state.cart[id];
    else state.cart[id] = qty;
    saveCart();
    render();
  }

  function cartCountTotal() {
    return Object.keys(state.cart).reduce(function (sum, id) { return sum + state.cart[id]; }, 0);
  }

  function cartTotalPrice() {
    var byId = {};
    state.products.forEach(function (p) { byId[String(p.id)] = p; });
    return Object.keys(state.cart).reduce(function (sum, id) {
      var p = byId[id];
      return p ? sum + p.price * state.cart[id] : sum;
    }, 0);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function filtered() {
    var q = state.query.trim();
    if (!q) return state.products;
    return state.products.filter(function (p) {
      return (p.name && p.name.indexOf(q) !== -1) ||
        (p.barcode && p.barcode.indexOf(q) !== -1);
    });
  }

  function render() {
    renderMeta();
    renderGrid();
    renderCartChrome();
  }

  function renderMeta() {
    var parts = [];
    parts.push(faNumber(state.products.length) + " محصول");
    if (state.updatedAt) {
      try {
        parts.push("به‌روزرسانی: " + new Date(state.updatedAt).toLocaleString("fa-IR"));
      } catch (e) { /* ignore */ }
    }
    metaLine.textContent = parts.join(" · ");
  }

  function renderGrid() {
    var list = filtered();
    grid.innerHTML = "";
    emptyState.hidden = list.length !== 0 || state.products.length === 0 && loadError.hidden === false;
    if (state.products.length === 0) {
      resultMeta.textContent = "";
      emptyState.hidden = loadError.hidden === false;
      return;
    }
    resultMeta.textContent = state.query.trim()
      ? faNumber(list.length) + " نتیجه برای «" + state.query.trim() + "»"
      : "";
    emptyState.hidden = list.length !== 0;

    list.forEach(function (p) {
      var id = String(p.id);
      var qty = state.cart[id] || 0;

      var card = document.createElement("article");
      card.className = "card";

      if (p.imageUrl) {
        var img = document.createElement("img");
        img.className = "card-img";
        img.loading = "lazy";
        img.alt = "";
        img.src = p.imageUrl;
        img.onerror = function () { img.remove(); card.prepend(placeholder()); };
        card.appendChild(img);
      } else {
        card.appendChild(placeholder());
      }

      var body = document.createElement("div");
      body.className = "card-body";

      var name = document.createElement("h3");
      name.className = "card-name";
      name.textContent = p.name;
      body.appendChild(name);

      var price = document.createElement("p");
      price.className = "card-price";
      price.textContent = formatPrice(p.price);
      body.appendChild(price);

      var actions = document.createElement("div");
      actions.className = "card-actions";
      if (qty === 0) {
        var add = document.createElement("button");
        add.className = "add-btn";
        add.type = "button";
        add.textContent = "افزودن به سبد";
        add.addEventListener("click", function () { setQty(id, 1); });
        actions.appendChild(add);
      } else {
        actions.appendChild(stepper(id, qty));
      }
      body.appendChild(actions);
      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  function placeholder() {
    var div = document.createElement("div");
    div.className = "card-img placeholder";
    div.textContent = "🛍️";
    return div;
  }

  function stepper(id, qty) {
    var wrap = document.createElement("div");
    wrap.className = "stepper";

    var minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.setAttribute("aria-label", "کم کردن");
    minus.addEventListener("click", function () { setQty(id, qty - 1); });

    var count = document.createElement("strong");
    count.textContent = faNumber(qty);

    var plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.setAttribute("aria-label", "افزودن");
    plus.addEventListener("click", function () { setQty(id, qty + 1); });

    wrap.appendChild(minus);
    wrap.appendChild(count);
    wrap.appendChild(plus);
    return wrap;
  }

  function renderCartChrome() {
    var count = cartCountTotal();
    var total = cartTotalPrice();
    cartCount.textContent = faNumber(count);
    cartBar.hidden = count === 0;
    if (count > 0) {
      cartSummary.textContent = faNumber(count) + " قلم در سبد";
      cartTotal.textContent = "مبلغ تقریبی: " + formatPrice(total);
    }
  }

  function renderCartDialog() {
    var byId = {};
    state.products.forEach(function (p) { byId[String(p.id)] = p; });
    var ids = Object.keys(state.cart);
    cartItems.innerHTML = "";

    if (ids.length === 0) {
      var empty = document.createElement("p");
      empty.className = "cart-empty";
      empty.textContent = "سبد خرید خالی است";
      cartItems.appendChild(empty);
    }

    ids.forEach(function (id) {
      var p = byId[id];
      if (!p) return;
      var qty = state.cart[id];

      var line = document.createElement("div");
      line.className = "cart-line";

      var info = document.createElement("div");
      info.className = "cart-line-info";
      var title = document.createElement("p");
      title.textContent = p.name;
      var sub = document.createElement("small");
      sub.textContent = faNumber(qty) + " × " + formatPrice(p.price) + " = " + formatPrice(p.price * qty);
      info.appendChild(title);
      info.appendChild(sub);

      var stepperBox = document.createElement("div");
      stepperBox.className = "mini-stepper";
      var minus = document.createElement("button");
      minus.type = "button";
      minus.textContent = "−";
      minus.setAttribute("aria-label", "کم کردن");
      minus.addEventListener("click", function () { setQty(id, qty - 1); renderCartDialog(); });
      var count = document.createElement("strong");
      count.textContent = faNumber(qty);
      var plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "+";
      plus.addEventListener("click", function () { setQty(id, qty + 1); renderCartDialog(); });
      stepperBox.appendChild(minus);
      stepperBox.appendChild(count);
      stepperBox.appendChild(plus);

      line.appendChild(info);
      line.appendChild(stepperBox);
      cartItems.appendChild(line);
    });

    dialogTotal.textContent = formatPrice(cartTotalPrice());
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  function faNumber(n) {
    try {
      return Number(n).toLocaleString("fa-IR");
    } catch (e) {
      return String(n);
    }
  }

  function formatPrice(toman) {
    return faNumber(toman) + " تومان";
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  search.addEventListener("input", function () {
    state.query = search.value;
    renderGrid();
  });

  function openCart() {
    renderCartDialog();
    if (typeof cartDialog.showModal === "function") cartDialog.showModal();
    else cartDialog.setAttribute("open", "");
  }

  function closeCartDialog() {
    if (typeof cartDialog.close === "function") cartDialog.close();
    else cartDialog.removeAttribute("open");
  }

  cartButton.addEventListener("click", openCart);
  viewCart.addEventListener("click", openCart);
  closeCart.addEventListener("click", closeCartDialog);
  closeCart2.addEventListener("click", closeCartDialog);
  cartDialog.addEventListener("click", function (e) {
    if (e.target === cartDialog) closeCartDialog();
  });
  clearCart.addEventListener("click", function () {
    state.cart = {};
    saveCart();
    render();
    renderCartDialog();
  });
})();
