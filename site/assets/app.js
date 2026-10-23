// Filters everything on a week page by store, category and tier, plus a
// "my stores" choice kept in localStorage.
(function () {
  var KEY_STORES = "sgd.myStores";
  var KEY_ONLY = "sgd.onlyMine";
  var RANK = { sale: 0, good: 1, standout: 2 };

  function load(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var mine = load(KEY_STORES, []);
  var onlyMine = load(KEY_ONLY, false);

  var bar = document.querySelector("[data-filters]");
  var dialog = document.querySelector("[data-mystores]");
  var storeSel = bar && bar.querySelector('[data-filter="store"]');
  var catSel = bar && bar.querySelector('[data-filter="category"]');
  var tierSel = bar && bar.querySelector('[data-filter="tier"]');
  var mineBox = bar && bar.querySelector('[data-filter="mine"]');
  var count = document.querySelector("[data-count]");
  var empty = document.querySelector("[data-empty]");

  function storeOk(id) {
    if (storeSel && storeSel.value && id !== storeSel.value) return false;
    if (onlyMine && mine.length && mine.indexOf(id) === -1) return false;
    return true;
  }
  function itemOk(el) {
    if (!storeOk(el.dataset.store)) return false;
    if (catSel && catSel.value && el.dataset.category !== catSel.value) return false;
    if (tierSel && tierSel.value && RANK[el.dataset.tier] < RANK[tierSel.value]) return false;
    return true;
  }

  function apply() {
    var rows = all("[data-filterable] [data-tier], .mini [data-tier]");
    var shown = 0, total = 0;
    rows.forEach(function (el) {
      var ok = itemOk(el);
      el.hidden = !ok;
      if (el.classList.contains("row")) { total++; if (ok) shown++; }
    });
    all("[data-cat-section]").forEach(function (sec) {
      var visible = all(".row", sec).filter(function (r) { return !r.hidden; }).length;
      sec.hidden = visible === 0;
      var c = sec.querySelector("[data-cat-count]");
      if (c) c.textContent = visible;
    });
    all(".store-card, .flyer").forEach(function (el) { el.hidden = !storeOk(el.dataset.store); });
    all(".cmp-group, .cat-box").forEach(function (g) {
      g.hidden = all("[data-tier]", g).every(function (r) { return r.hidden; });
    });
    if (count) count.textContent = "Showing " + shown + " of " + total + " items" + (onlyMine && mine.length ? " at my stores" : "") + ".";
    if (empty) empty.hidden = shown !== 0;
    if (mineBox) mineBox.checked = onlyMine;
  }

  [storeSel, catSel, tierSel].forEach(function (s) { if (s) s.addEventListener("change", apply); });
  if (mineBox) mineBox.addEventListener("change", function () {
    onlyMine = mineBox.checked;
    save(KEY_ONLY, onlyMine);
    if (onlyMine && mine.length === 0 && dialog && dialog.showModal) dialog.showModal();
    apply();
  });

  // "See all" on a store card filters the full list to that store.
  all("[data-jump-store]").forEach(function (a) {
    a.addEventListener("click", function () {
      if (storeSel) { storeSel.value = a.dataset.jumpStore; apply(); }
    });
  });

  var openBtn = document.querySelector("[data-mystores-open]");
  if (openBtn && dialog && dialog.showModal) {
    openBtn.addEventListener("click", function () { dialog.showModal(); });
    var boxes = all("[data-mystore]", dialog);
    boxes.forEach(function (b) {
      b.checked = mine.indexOf(b.value) !== -1;
      b.addEventListener("change", function () {
        mine = boxes.filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
        save(KEY_STORES, mine);
        if (mine.length && !onlyMine) { onlyMine = true; save(KEY_ONLY, true); }
        apply();
      });
    });
  } else if (openBtn) {
    openBtn.hidden = true;
  }

  apply();
})();
