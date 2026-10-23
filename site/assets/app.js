// Filters deals by store and category, plus a "my stores" choice kept in localStorage.
(function () {
  var KEY_STORES = "sgd.myStores";
  var KEY_ONLY = "sgd.onlyMine";

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

  var mine = load(KEY_STORES, []);
  var onlyMine = load(KEY_ONLY, false);

  var bar = document.querySelector("[data-filters]");
  var list = document.querySelector("[data-deals]");
  var dialog = document.querySelector("[data-mystores]");
  var storeSel = bar && bar.querySelector('[data-filter="store"]');
  var catSel = bar && bar.querySelector('[data-filter="category"]');
  var mineBox = bar && bar.querySelector('[data-filter="mine"]');
  var count = document.querySelector("[data-count]");
  var empty = document.querySelector("[data-empty]");

  function apply() {
    var useMine = onlyMine && mine.length > 0;
    if (list) {
      var cards = list.querySelectorAll(".deal");
      var shown = 0;
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var ok = (!storeSel || !storeSel.value || c.dataset.store === storeSel.value) &&
          (!catSel || !catSel.value || c.dataset.category === catSel.value) &&
          (!useMine || mine.indexOf(c.dataset.store) !== -1);
        c.hidden = !ok;
        if (ok) shown++;
      }
      if (count) count.textContent = "Showing " + shown + " of " + cards.length + " deals" + (useMine ? " at my stores" : "") + ".";
      if (empty) empty.hidden = shown !== 0;
    }
    var flyers = document.querySelectorAll(".flyer");
    for (var j = 0; j < flyers.length; j++) {
      flyers[j].hidden = useMine && mine.indexOf(flyers[j].dataset.store) === -1;
    }
    if (mineBox) mineBox.checked = onlyMine;
  }

  if (storeSel) storeSel.addEventListener("change", apply);
  if (catSel) catSel.addEventListener("change", apply);
  if (mineBox) mineBox.addEventListener("change", function () {
    onlyMine = mineBox.checked;
    save(KEY_ONLY, onlyMine);
    if (onlyMine && mine.length === 0 && dialog && dialog.showModal) dialog.showModal();
    apply();
  });

  var openBtn = document.querySelector("[data-mystores-open]");
  if (openBtn && dialog && dialog.showModal) {
    openBtn.addEventListener("click", function () { dialog.showModal(); });
    var boxes = dialog.querySelectorAll("[data-mystore]");
    for (var k = 0; k < boxes.length; k++) {
      boxes[k].checked = mine.indexOf(boxes[k].value) !== -1;
      boxes[k].addEventListener("change", function () {
        mine = [];
        for (var m = 0; m < boxes.length; m++) if (boxes[m].checked) mine.push(boxes[m].value);
        save(KEY_STORES, mine);
        if (mine.length && !onlyMine) { onlyMine = true; save(KEY_ONLY, true); }
        apply();
      });
    }
  } else if (openBtn) {
    openBtn.hidden = true;
  }

  apply();
})();
