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
    version: null,
    feedCount: null,
    query: "",
    store: "all",
    sort: "newest",
    onlyDeals: false,
    cart: loadCart()
  };

  var grid = document.getElementById("grid");
  var search = document.getElementById("search");
  var metaLine = document.getElementById("metaLine");
  var resultMeta = document.getElementById("resultMeta");
  var statsStrip = document.getElementById("statsStrip");
  var statCount = document.getElementById("statCount");
  var statStores = document.getElementById("statStores");
  var statCheaper = document.getElementById("statCheaper");
  var statRange = document.getElementById("statRange");
  var storeChips = document.getElementById("storeChips");
  var sortSelect = document.getElementById("sortSelect");
  var onlyDeals = document.getElementById("onlyDeals");
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
  var dialogSavings = document.getElementById("dialogSavings");
  var dialogSavingsTotal = document.getElementById("dialogSavingsTotal");
  var closeCart = document.getElementById("closeCart");
  var closeCart2 = document.getElementById("closeCart2");
  var clearCart = document.getElementById("clearCart");

  var itemDialog = document.getElementById("itemDialog");
  var itemDialogTitle = document.getElementById("itemDialogTitle");
  var itemDialogContent = document.getElementById("itemDialogContent");
  var itemDialogActions = document.getElementById("itemDialogActions");
  var closeItemDialog = document.getElementById("closeItemDialog");

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
      state.version = feed.version != null ? feed.version : null;
      state.feedCount = feed.count != null ? feed.count : state.products.length;
      pruneCart();
      renderStoreChips();
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
  // Formatting & Helpers
  // ---------------------------------------------------------------------------

  function toPersianDigits(n) {
    if (n === null || n === undefined) return "";
    return String(n).replace(/[0-9]/g, function (d) {
      return "۰۱۲۳۴۵۶۷۸۹"[d];
    });
  }

  function normalizeDigits(s) {
    if (!s) return "";
    return String(s)
      .replace(/[۰-۹]/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹".indexOf(d); })
      .replace(/[٠-٩]/g, function (d) { return "٠١٢٣٤٥٦٧٨٩".indexOf(d); });
  }

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

  function formatDiffPercentage(diff) {
    if (!diff) return "";
    var s = String(diff).trim();
    return toPersianDigits(s).replace(/%/g, "٪");
  }

  /** Images published by the Android app may point at a device-local path. */
  function usableImage(url) {
    if (!url) return null;
    var u = String(url).trim();
    if (/^(https?:)?\/\//.test(u)) return u;
    if (/^images\//.test(u)) return u;
    return null; // /data/user/0/... and other device paths are unreachable from the web
  }

  /** Positive = the Adonia price is lower than the source store price. */
  function savingsOf(p) {
    if (p.sourcePrice == null || p.price == null) return 0;
    return p.sourcePrice - p.price;
  }

  function savingsRatio(p) {
    var s = savingsOf(p);
    if (s <= 0 || !p.sourcePrice) return 0;
    return s / p.sourcePrice;
  }

  function storeList() {
    var seen = {};
    var out = [];
    state.products.forEach(function (p) {
      var name = p.storeName || "نامشخص";
      if (!seen[name]) {
        seen[name] = 0;
        out.push(name);
      }
      seen[name] += 1;
    });
    return out.map(function (name) { return { name: name, count: seen[name] }; });
  }

  function formatDateTime(ts) {
    if (!ts) return "";
    try {
      var d = new Date(ts);
      if (isNaN(d.getTime())) return String(ts);
      return d.toLocaleString("fa-IR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return String(ts);
    }
  }

  function formatDateTimeFull(ts) {
    if (!ts) return "";
    try {
      var d = new Date(ts);
      if (isNaN(d.getTime())) return String(ts);
      return d.toLocaleString("fa-IR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch (e) {
      return String(ts);
    }
  }

  function copyToClipboard(text, el, feedbackText) {
    if (!text) return;
    var originalText = el ? el.textContent : "";
    function showFeedback() {
      if (el) {
        el.textContent = feedbackText || "کپی شد! ✓";
        setTimeout(function () {
          el.textContent = originalText;
        }, 1500);
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text)).then(showFeedback, function () {
        fallbackCopy(String(text), showFeedback);
      });
    } else {
      fallbackCopy(String(text), showFeedback);
    }
  }

  function fallbackCopy(text, cb) {
    try {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      if (cb) cb();
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function filtered() {
    var q = state.query.trim().toLowerCase();
    var qNorm = normalizeDigits(q);

    var list = state.products.filter(function (p) {
      var storeName = p.storeName || "نامشخص";
      if (state.store !== "all" && storeName !== state.store) return false;
      if (state.onlyDeals && savingsOf(p) <= 0) return false;
      if (!q) return true;
      var nameMatch = p.name && p.name.toLowerCase().indexOf(q) !== -1;
      var storeMatch = storeName.toLowerCase().indexOf(q) !== -1;
      var priceMatch = String(p.price).indexOf(qNorm) !== -1;
      var barcodeMatch = p.barcode && (
        p.barcode.indexOf(q) !== -1 || p.barcode.indexOf(qNorm) !== -1
      );
      var refMatch = p.priceSourceRef && (
        String(p.priceSourceRef).indexOf(q) !== -1 ||
        String(p.priceSourceRef).indexOf(qNorm) !== -1
      );
      return nameMatch || storeMatch || priceMatch || barcodeMatch || refMatch;
    });

    return sortList(list);
  }

  function sortList(list) {
    var copy = list.slice();
    switch (state.sort) {
      case "priceAsc":
        copy.sort(function (a, b) { return (a.price || 0) - (b.price || 0); });
        break;
      case "priceDesc":
        copy.sort(function (a, b) { return (b.price || 0) - (a.price || 0); });
        break;
      case "discount":
        copy.sort(function (a, b) { return savingsRatio(b) - savingsRatio(a); });
        break;
      case "name":
        copy.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), "fa"); });
        break;
      default: // newest — the feed is published newest-id first
        copy.sort(function (a, b) { return (b.id || 0) - (a.id || 0); });
    }
    return copy;
  }

  function renderStoreChips() {
    if (!storeChips) return;
    storeChips.innerHTML = "";
    var stores = storeList();
    var entries = [{ name: "all", label: "همه فروشگاه‌ها", count: state.products.length }];
    stores.forEach(function (s) { entries.push({ name: s.name, label: s.name, count: s.count }); });

    entries.forEach(function (entry) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (state.store === entry.name ? " chip-active" : "");
      btn.setAttribute("aria-pressed", String(state.store === entry.name));
      btn.textContent = entry.label + " (" + faNumber(entry.count) + ")";
      btn.addEventListener("click", function () {
        state.store = entry.name;
        renderStoreChips();
        renderGrid();
      });
      storeChips.appendChild(btn);
    });
  }

  function renderStats() {
    if (!statsStrip) return;
    if (state.products.length === 0) {
      statsStrip.hidden = true;
      return;
    }
    statsStrip.hidden = false;

    var prices = state.products
      .map(function (p) { return p.price; })
      .filter(function (v) { return typeof v === "number"; });
    var cheaper = state.products.filter(function (p) { return savingsOf(p) > 0; }).length;

    statCount.textContent = faNumber(state.products.length);
    statStores.textContent = faNumber(storeList().length);
    statCheaper.textContent = faNumber(cheaper);
    statRange.textContent = prices.length
      ? faNumber(Math.min.apply(null, prices)) + " – " + faNumber(Math.max.apply(null, prices))
      : "—";
  }

  function render() {
    renderMeta();
    renderStats();
    renderGrid();
    renderCartChrome();
  }

  function renderMeta() {
    var parts = [];
    parts.push(faNumber(state.feedCount != null ? state.feedCount : state.products.length) + " محصول");
    if (state.version != null) parts.push("نسخهٔ فهرست " + toPersianDigits(state.version));
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
    var bits = [];
    if (state.query.trim()) bits.push("جستجوی «" + state.query.trim() + "»");
    if (state.store !== "all") bits.push("فروشگاه " + state.store);
    if (state.onlyDeals) bits.push("فقط ارزان‌تر از مبدأ");
    resultMeta.textContent = bits.length
      ? faNumber(list.length) + " نتیجه · " + bits.join(" · ")
      : "";
    emptyState.hidden = list.length !== 0;

    list.forEach(function (p) {
      var id = String(p.id);
      var qty = state.cart[id] || 0;

      var card = document.createElement("article");
      card.className = "card";

      // Product Image (device-local paths from the app are not reachable on the web)
      var media = document.createElement("div");
      media.className = "card-media";
      var src = usableImage(p.imageUrl);
      if (src) {
        var img = document.createElement("img");
        img.className = "card-img";
        img.loading = "lazy";
        img.alt = p.name || "";
        img.src = src;
        img.title = "مشاهده مشخصات کامل محصول";
        img.addEventListener("click", function () { openItemDialog(p); });
        img.onerror = function () { img.remove(); media.prepend(placeholder()); };
        media.appendChild(img);
      } else {
        media.appendChild(placeholder());
      }

      var saving = savingsOf(p);
      if (saving > 0) {
        var ribbon = document.createElement("span");
        ribbon.className = "card-ribbon";
        ribbon.textContent = toPersianDigits(Math.round(savingsRatio(p) * 100)) + "٪ ارزان‌تر";
        ribbon.title = formatPrice(saving) + " ارزان‌تر از " + (p.storeName || "مبدأ");
        media.appendChild(ribbon);
      }
      card.appendChild(media);

      var body = document.createElement("div");
      body.className = "card-body";

      // 1. Tags: Store Name & Diff Percentage
      if (p.storeName || p.diffPercentage) {
        var tags = document.createElement("div");
        tags.className = "card-tags";

        if (p.storeName) {
          var storeTag = document.createElement("span");
          storeTag.className = "tag-store";
          storeTag.title = "فروشگاه مبدأ: " + p.storeName;
          storeTag.textContent = "🏪 " + p.storeName;
          tags.appendChild(storeTag);
        }

        if (p.diffPercentage) {
          var saved = savingsOf(p);
          var diffTag = document.createElement("span");
          diffTag.className = "tag-diff " + (saved > 0 ? "tag-diff-down" : saved < 0 ? "tag-diff-up" : "");
          diffTag.title = saved > 0
            ? "نسبت به " + (p.storeName || "مبدأ") + " ارزان‌تر است"
            : saved < 0
              ? "نسبت به " + (p.storeName || "مبدأ") + " گران‌تر است"
              : "درصد اختلاف قیمت نسبت به مبدأ";
          diffTag.textContent = (saved > 0 ? "▼ " : saved < 0 ? "▲ " : "") + formatDiffPercentage(p.diffPercentage);
          tags.appendChild(diffTag);
        }

        body.appendChild(tags);
      }

      // 2. Name
      var name = document.createElement("h3");
      name.className = "card-name";
      name.textContent = p.name;
      name.style.cursor = "pointer";
      name.title = p.name + " (مشاهده مشخصات کامل)";
      name.addEventListener("click", function () { openItemDialog(p); });
      body.appendChild(name);

      // 3. Pricing Section
      var pricing = document.createElement("div");
      pricing.className = "card-pricing";

      var priceRow = document.createElement("div");
      priceRow.className = "card-price-row";
      var priceLabel = document.createElement("span");
      priceLabel.className = "price-label";
      priceLabel.textContent = "قیمت:";
      var priceVal = document.createElement("strong");
      priceVal.className = "card-price";
      priceVal.textContent = formatPrice(p.price);
      priceRow.appendChild(priceLabel);
      priceRow.appendChild(priceVal);
      pricing.appendChild(priceRow);

      if (p.sourcePrice != null && p.sourcePrice === p.price) {
        var sameRow = document.createElement("div");
        sameRow.className = "card-source-row";
        var sameLabel = document.createElement("span");
        sameLabel.className = "source-label";
        sameLabel.textContent = "برابر با قیمت " + (p.storeName || "مبدأ");
        sameRow.appendChild(sameLabel);
        pricing.appendChild(sameRow);
      }

      if (p.sourcePrice != null && p.sourcePrice !== p.price) {
        var sourceRow = document.createElement("div");
        sourceRow.className = "card-source-row";
        var sourceLabel = document.createElement("span");
        sourceLabel.className = "source-label";
        sourceLabel.textContent = "قیمت در " + (p.storeName || "مبدأ") + ":";
        var sourceVal = document.createElement("span");
        sourceVal.className = "source-price-val";
        sourceVal.textContent = formatPrice(p.sourcePrice);
        sourceRow.appendChild(sourceLabel);
        sourceRow.appendChild(sourceVal);
        pricing.appendChild(sourceRow);

        var deltaRow = document.createElement("div");
        deltaRow.className = "card-delta-row " + (saving > 0 ? "delta-down" : "delta-up");
        deltaRow.textContent = (saving > 0 ? "سود شما: " : "اختلاف: ") + formatPrice(Math.abs(saving));
        pricing.appendChild(deltaRow);
      }

      body.appendChild(pricing);

      // 4. Metadata Box (Barcode, Source Ref, Updated At, Source Link)
      var metaBox = document.createElement("div");
      metaBox.className = "card-meta-box";

      if (p.barcode) {
        var barcodeRow = document.createElement("div");
        barcodeRow.className = "meta-row";
        var bcLabel = document.createElement("span");
        bcLabel.className = "meta-label";
        bcLabel.textContent = "بارکد:";
        var bcVal = document.createElement("span");
        bcVal.className = "meta-val barcode-val";
        bcVal.textContent = toPersianDigits(p.barcode);
        bcVal.title = "برای کپی بارکد کلیک کنید (" + p.barcode + ")";
        bcVal.addEventListener("click", function (e) {
          e.stopPropagation();
          copyToClipboard(p.barcode, bcVal, "کپی شد! ✓");
        });
        barcodeRow.appendChild(bcLabel);
        barcodeRow.appendChild(bcVal);
        metaBox.appendChild(barcodeRow);
      }

      if (p.priceSourceRef) {
        var refRow = document.createElement("div");
        refRow.className = "meta-row";
        var refLabel = document.createElement("span");
        refLabel.className = "meta-label";
        refLabel.textContent = "کد مرجع:";
        var refVal = document.createElement("span");
        refVal.className = "meta-val";
        refVal.textContent = toPersianDigits(p.priceSourceRef);
        refRow.appendChild(refLabel);
        refRow.appendChild(refVal);
        metaBox.appendChild(refRow);
      }

      if (p.updatedAt) {
        var updateRow = document.createElement("div");
        updateRow.className = "meta-row";
        var upLabel = document.createElement("span");
        upLabel.className = "meta-label";
        upLabel.textContent = "به‌روزرسانی:";
        var upVal = document.createElement("span");
        upVal.className = "meta-val";
        upVal.textContent = formatDateTime(p.updatedAt);
        updateRow.appendChild(upLabel);
        updateRow.appendChild(upVal);
        metaBox.appendChild(updateRow);
      }

      if (p.priceSourceUrl) {
        var linkRow = document.createElement("div");
        linkRow.className = "meta-row";
        var linkLabel = document.createElement("span");
        linkLabel.className = "meta-label";
        linkLabel.textContent = "منبع:";
        var linkA = document.createElement("a");
        linkA.className = "meta-link";
        linkA.href = p.priceSourceUrl;
        linkA.target = "_blank";
        linkA.rel = "noopener noreferrer";
        linkA.textContent = "مشاهده پیوند ↗";
        linkRow.appendChild(linkLabel);
        linkRow.appendChild(linkA);
        metaBox.appendChild(linkRow);
      }

      if (metaBox.childNodes.length > 0) body.appendChild(metaBox);

      // 5. Details Button
      var detailsBtn = document.createElement("button");
      detailsBtn.className = "details-btn";
      detailsBtn.type = "button";
      detailsBtn.textContent = "مشخصات کامل ℹ️";
      detailsBtn.addEventListener("click", function () { openItemDialog(p); });
      body.appendChild(detailsBtn);

      // 6. Actions (Cart Add / Stepper)
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

    var totalSavings = 0;

    ids.forEach(function (id) {
      var p = byId[id];
      if (!p) return;
      var qty = state.cart[id];

      if (p.sourcePrice && p.sourcePrice > p.price) {
        totalSavings += (p.sourcePrice - p.price) * qty;
      }

      var line = document.createElement("div");
      line.className = "cart-line";

      var info = document.createElement("div");
      info.className = "cart-line-info";
      var title = document.createElement("p");
      title.textContent = p.name;
      info.appendChild(title);

      var metaParts = [];
      if (p.storeName) metaParts.push(p.storeName);
      if (p.barcode) metaParts.push("بارکد: " + toPersianDigits(p.barcode));
      if (metaParts.length > 0) {
        var meta = document.createElement("div");
        meta.className = "cart-line-meta";
        meta.textContent = metaParts.join(" · ");
        info.appendChild(meta);
      }

      var sub = document.createElement("small");
      sub.textContent = faNumber(qty) + " × " + formatPrice(p.price) + " = " + formatPrice(p.price * qty);
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
      plus.setAttribute("aria-label", "افزودن");
      plus.addEventListener("click", function () { setQty(id, qty + 1); renderCartDialog(); });
      stepperBox.appendChild(minus);
      stepperBox.appendChild(count);
      stepperBox.appendChild(plus);

      line.appendChild(info);
      line.appendChild(stepperBox);
      cartItems.appendChild(line);
    });

    dialogTotal.textContent = formatPrice(cartTotalPrice());

    if (dialogSavings && dialogSavingsTotal) {
      if (totalSavings > 0) {
        dialogSavings.hidden = false;
        dialogSavingsTotal.textContent = formatPrice(totalSavings);
      } else {
        dialogSavings.hidden = true;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Item Details Dialog
  // ---------------------------------------------------------------------------

  function openItemDialog(p) {
    if (!p) return;

    itemDialogTitle.textContent = "مشخصات کامل محصول";
    itemDialogContent.innerHTML = "";

    // Hero with thumbnail and quick details
    var hero = document.createElement("div");
    hero.className = "item-dialog-hero";

    var dialogSrc = usableImage(p.imageUrl);
    if (dialogSrc) {
      var img = document.createElement("img");
      img.className = "item-dialog-img";
      img.alt = p.name || "";
      img.src = dialogSrc;
      img.onerror = function () { img.replaceWith(placeholder()); };
      hero.appendChild(img);
    } else {
      hero.appendChild(placeholder());
    }

    var heroInfo = document.createElement("div");
    heroInfo.className = "item-dialog-hero-info";

    var title = document.createElement("h3");
    title.textContent = p.name;
    heroInfo.appendChild(title);

    if (p.storeName || p.diffPercentage) {
      var tags = document.createElement("div");
      tags.className = "card-tags";
      if (p.storeName) {
        var st = document.createElement("span");
        st.className = "tag-store";
        st.textContent = "🏪 " + p.storeName;
        tags.appendChild(st);
      }
      if (p.diffPercentage) {
        var saved2 = savingsOf(p);
        var dt = document.createElement("span");
        dt.className = "tag-diff " + (saved2 > 0 ? "tag-diff-down" : saved2 < 0 ? "tag-diff-up" : "");
        dt.textContent = (saved2 > 0 ? "▼ " : saved2 < 0 ? "▲ " : "") + formatDiffPercentage(p.diffPercentage);
        tags.appendChild(dt);
      }
      heroInfo.appendChild(tags);
    }

    hero.appendChild(heroInfo);
    itemDialogContent.appendChild(hero);

    // Specification Table
    var table = document.createElement("table");
    table.className = "item-table";
    var tbody = document.createElement("tbody");

    function addRow(label, value, isRtl, actionBtn) {
      if (value === undefined || value === null || value === "") return;
      var tr = document.createElement("tr");
      var th = document.createElement("th");
      th.scope = "row";
      th.textContent = label;
      var td = document.createElement("td");
      if (isRtl) td.className = "rtl-text";
      if (typeof value === "string" || typeof value === "number") {
        td.appendChild(document.createTextNode(String(value)));
      } else if (value instanceof HTMLElement) {
        td.appendChild(value);
      }
      if (actionBtn) {
        td.appendChild(actionBtn);
      }
      tr.appendChild(th);
      tr.appendChild(td);
      tbody.appendChild(tr);
    }

    addRow("نام محصول", p.name, true);

    if (p.barcode) {
      var copyBtn = document.createElement("button");
      copyBtn.className = "copy-btn";
      copyBtn.type = "button";
      copyBtn.textContent = "کپی";
      copyBtn.addEventListener("click", function () {
        copyToClipboard(p.barcode, copyBtn, "کپی شد!");
      });
      addRow("بارکد (EAN-13)", toPersianDigits(p.barcode), false, copyBtn);
    }

    if (p.id != null) {
      addRow("شناسه محصول", toPersianDigits(p.id));
    }

    if (p.storeName) {
      addRow("فروشگاه مبدأ", p.storeName, true);
    }

    if (p.priceSourceId) {
      addRow("شناسه منبع (Source ID)", p.priceSourceId);
    }

    if (p.priceSourceRef) {
      addRow("کد مرجع در مبدأ", toPersianDigits(p.priceSourceRef));
    }

    if (p.price != null) {
      addRow("قیمت فروشگاه آدونیا", formatPrice(p.price), true);
    }

    if (p.sourcePrice != null) {
      addRow("قیمت در " + (p.storeName || "مبدأ"), formatPrice(p.sourcePrice), true);
    }

    if (p.diffPercentage) {
      addRow("درصد اختلاف قیمت", formatDiffPercentage(p.diffPercentage));
    }

    if (p.sourcePrice != null && p.price != null && p.sourcePrice !== p.price) {
      var diffAmount = Math.abs(p.sourcePrice - p.price);
      var diffLabel = p.sourcePrice > p.price ? "میزان ارزان‌تر بودن" : "میزان اختلاف قیمت";
      addRow(diffLabel, formatPrice(diffAmount), true);
    }

    if (p.createdAt) {
      addRow("تاریخ ثبت اولیه", formatDateTimeFull(p.createdAt));
    }

    if (p.updatedAt) {
      addRow("آخرین به‌روزرسانی", formatDateTimeFull(p.updatedAt));
    }

    if (p.priceSourceUrl) {
      var a = document.createElement("a");
      a.className = "meta-link";
      a.href = p.priceSourceUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "مشاهده پیوند اصلی ↗";
      addRow("آدرس مرجع قیمت", a);
    }

    table.appendChild(tbody);
    itemDialogContent.appendChild(table);

    // Actions in item dialog foot
    renderItemDialogActions(p);

    if (typeof itemDialog.showModal === "function") itemDialog.showModal();
    else itemDialog.setAttribute("open", "");
  }

  function renderItemDialogActions(p) {
    var id = String(p.id);
    var qty = state.cart[id] || 0;
    itemDialogActions.innerHTML = "";

    var cartBox = document.createElement("div");
    if (qty === 0) {
      var add = document.createElement("button");
      add.className = "primary";
      add.type = "button";
      add.textContent = "افزودن به سبد خرید";
      add.addEventListener("click", function () {
        setQty(id, 1);
        renderItemDialogActions(p);
      });
      cartBox.appendChild(add);
    } else {
      var wrap = document.createElement("div");
      wrap.className = "stepper";

      var minus = document.createElement("button");
      minus.type = "button";
      minus.textContent = "−";
      minus.setAttribute("aria-label", "کم کردن");
      minus.addEventListener("click", function () {
        setQty(id, qty - 1);
        renderItemDialogActions(p);
      });

      var count = document.createElement("strong");
      count.textContent = faNumber(qty);

      var plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "+";
      plus.setAttribute("aria-label", "افزودن");
      plus.addEventListener("click", function () {
        setQty(id, qty + 1);
        renderItemDialogActions(p);
      });

      wrap.appendChild(minus);
      wrap.appendChild(count);
      wrap.appendChild(plus);
      cartBox.appendChild(wrap);
    }

    var closeBtn = document.createElement("button");
    closeBtn.className = "primary";
    closeBtn.type = "button";
    closeBtn.textContent = "بستن";
    closeBtn.addEventListener("click", closeItemDialogModal);

    itemDialogActions.appendChild(cartBox);
    itemDialogActions.appendChild(closeBtn);
  }

  function closeItemDialogModal() {
    if (typeof itemDialog.close === "function") itemDialog.close();
    else itemDialog.removeAttribute("open");
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  search.addEventListener("input", function () {
    state.query = search.value;
    renderGrid();
  });

  if (sortSelect) {
    sortSelect.addEventListener("change", function () {
      state.sort = sortSelect.value;
      renderGrid();
    });
  }

  if (onlyDeals) {
    onlyDeals.addEventListener("change", function () {
      state.onlyDeals = onlyDeals.checked;
      renderGrid();
    });
  }

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

  if (closeItemDialog) closeItemDialog.addEventListener("click", closeItemDialogModal);
  if (itemDialog) {
    itemDialog.addEventListener("click", function (e) {
      if (e.target === itemDialog) closeItemDialogModal();
    });
  }
})();
