// Filters, search and sorting for deal lists, the "Vegetarian" chip kept in localStorage,
// the delivery chip on the Stores page, the edition notes, and date-based notices.
(function () {
  var KEY_VEG = "sgd.vegOnly";
  var root = document.documentElement;

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
  function all(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }

  var vegOnly = load(KEY_VEG, false);
  var area = document.querySelector("[data-filterable]");
  var search = document.querySelector("[data-search]");
  var storeSel = document.querySelector('[data-filter="store"]');
  var sortSel = document.querySelector("[data-sort]");
  var home = document.querySelector("[data-home]");
  var results = document.querySelector("[data-results]");

  function query() { return search ? search.value.trim().toLowerCase() : ""; }

  function rowOk(el, q) {
    if (vegOnly && el.dataset.veg === "0") return false;
    if (el.dataset.hl && el.dataset.hl.indexOf(vegOnly ? "v" : "a") === -1) return false;
    if (storeSel && storeSel.value && el.dataset.store !== storeSel.value) return false;
    if (q && el.dataset.text && el.dataset.text.indexOf(q) === -1) return false;
    return true;
  }

  function apply() {
    root.classList.toggle("veg-on", vegOnly);
    all("[data-veg-toggle]").forEach(function (b) { b.setAttribute("aria-pressed", vegOnly ? "true" : "false"); });
    if (!area) { showEnding(); return; }
    var q = query();
    // On the home page, a search swaps the summary sections for the full list.
    if (home && results) {
      home.hidden = Boolean(q);
      results.hidden = !q;
    }
    var scope = results && !results.hidden ? results : home && results ? home : area;
    var shown = 0;
    all(".deal", area).forEach(function (el) {
      var ok = rowOk(el, scope === home ? "" : q);
      el.hidden = !ok;
      if (ok && scope.contains(el)) shown++;
    });
    all("[data-group]", scope).forEach(function (g) {
      var n = all(".deal", g).filter(function (r) { return !r.hidden; }).length;
      g.hidden = n === 0;
      var c = g.querySelector("[data-group-count]");
      if (c) c.textContent = n;
    });
    // Store cards on This week follow the store picker.
    if (home && storeSel) all("[data-store-card]", home).forEach(function (li) {
      li.hidden = Boolean(storeSel.value) && li.dataset.storeCard !== storeSel.value;
    });
    var count = scope.querySelector("[data-count]");
    if (count) {
      count.textContent = (q ? shown + (shown === 1 ? " deal matches “" : " deals match “") + search.value.trim() + "”" : "Showing " + shown + (shown === 1 ? " deal" : " deals")) +
        (vegOnly ? ", vegetarian only" : "") + (storeSel && storeSel.value ? ", at " + storeSel.options[storeSel.selectedIndex].text : "") + ".";
    }
    // With nothing to show, the empty state says it; the count stays for screen readers.
    if (count) count.classList.toggle("sr-only", shown === 0);
    var empty = scope.querySelector("[data-empty]");
    if (empty) {
      empty.hidden = shown !== 0;
      var msg = empty.querySelector("[data-empty-msg]");
      if (msg) msg.textContent = q ? "Nothing matches “" + search.value.trim() + "”. Check back Friday." : empty.dataset.fallback;
    }
    showEnding();
  }

  function sortRows() {
    var by = sortSel ? sortSel.value : "rank";
    var key = {
      rank: function (el) { return +el.dataset.rank; },
      off: function (el) { return -(+el.dataset.off) * 1000 + +el.dataset.rank / 1000; },
      price: function (el) { return +el.dataset.price; },
      name: null,
    }[by];
    all("[data-sortable]").forEach(function (ul) {
      var rows = all(":scope > .deal", ul);
      rows.sort(key ? function (a, b) { return key(a) - key(b); } : function (a, b) { return a.dataset.name.localeCompare(b.dataset.name); });
      rows.forEach(function (r) { ul.appendChild(r); });
    });
  }

  all("[data-veg-toggle]").forEach(function (b) {
    b.addEventListener("click", function () {
      vegOnly = !vegOnly;
      save(KEY_VEG, vegOnly);
      apply();
    });
  });
  if (search) search.addEventListener("input", apply);
  if (storeSel) storeSel.addEventListener("change", apply);
  if (sortSel) sortSel.addEventListener("change", function () { sortRows(); apply(); });

  // Stores page: only stores that deliver.
  var deliv = document.querySelector("[data-deliv-toggle]");
  if (deliv) deliv.addEventListener("click", function () {
    var on = deliv.getAttribute("aria-pressed") !== "true";
    deliv.setAttribute("aria-pressed", on ? "true" : "false");
    var tiles = all("[data-store-tiles] > li");
    tiles.forEach(function (li) { li.hidden = on && !li.hasAttribute("data-delivers"); });
    var none = document.querySelector("[data-deliv-empty]");
    if (none) none.hidden = tiles.some(function (li) { return !li.hidden; });
  });

  // Dates: hide expired content and show "ending soon" against today in Seattle.
  var today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  function daysUntil(iso) { return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000); }
  all("[data-expired-after]").forEach(function (el) { el.hidden = !(today > el.dataset.expiredAfter); });

  // "Ends Thursday", "Ends tomorrow", "Ends today" or "Ended" after the edition's dates.
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  all("[data-ends-line]").forEach(function (el) {
    var d = daysUntil(el.dataset.end);
    var text = d < 0 ? "Ended" : d === 0 ? "Ends today" : d === 1 ? "Ends tomorrow" : "Ends " + DAYS[new Date(el.dataset.end + "T12:00:00Z").getUTCDay()];
    el.querySelector("[data-ends-text]").textContent = text;
    el.hidden = false;
  });

  // The edition note on This week: "Fresh off the press" once per edition until dismissed,
  // "Next edition lands Friday" in the last two days, and a sleepy note once sales end.
  var edition = document.querySelector("[data-edition]");
  if (edition && edition.dataset.end) {
    var SEEN = "sgd.seenEdition";
    var left = daysUntil(edition.dataset.end);
    var fresh = edition.querySelector("[data-edition-fresh]");
    var show = left < 0 ? "[data-edition-ended]" : left <= 2 ? "[data-edition-next]" : load(SEEN, "") !== edition.dataset.week ? "[data-edition-fresh]" : null;
    var card = show && edition.querySelector(show);
    if (card) card.hidden = false;
    var dismiss = edition.querySelector("[data-edition-dismiss]");
    if (dismiss) dismiss.addEventListener("click", function () {
      save(SEEN, edition.dataset.week);
      fresh.hidden = true;
      var next = document.querySelector("#h-best");
      if (next) { next.setAttribute("tabindex", "-1"); next.focus(); }
    });
  }

  // Store pages: the about text shows three lines, with "Read more" when there's more.
  all("[data-clamp]").forEach(function (p) {
    var btn = p.parentNode.querySelector("[data-clamp-toggle]");
    if (!btn || p.scrollHeight <= p.clientHeight + 2) return;
    btn.hidden = false;
    btn.addEventListener("click", function () {
      var open = btn.getAttribute("aria-expanded") !== "true";
      p.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.textContent = open ? "Read less" : "Read more";
    });
  });
  var ending = document.querySelector("[data-ending]");
  function showEnding() {
    if (!ending) return;
    var shown = 0;
    all("[data-ends]", ending).forEach(function (li) {
      var d = daysUntil(li.dataset.ends);
      var ok = d >= 0 && d <= 2 && shown < 8 && !(vegOnly && li.dataset.veg === "0") && !(storeSel && storeSel.value && li.dataset.store !== storeSel.value);
      li.hidden = !ok;
      if (ok) {
        shown++;
        li.querySelector("[data-ends-label]").textContent = d === 0 ? "ends today" : d === 1 ? "ends tomorrow" : "ends in 2 days";
      }
    });
    ending.hidden = shown === 0;
  }

  apply();
})();

// About page: turn Amplitude off (or back on) in this browser.
(function () {
  var btn = document.querySelector("[data-analytics-toggle]");
  var state = document.querySelector("[data-analytics-state]");
  if (!btn) return;
  function off() { try { return localStorage.getItem("sgd.analyticsOff") === "true"; } catch (e) { return false; } }
  function show() {
    var gpc = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
    btn.textContent = off() ? "Turn analytics back on in this browser" : "Turn off analytics in this browser";
    if (state) state.textContent = gpc ? "(already off: your browser asks sites not to track)" : off() ? "(off)" : "";
  }
  btn.addEventListener("click", function () {
    try { localStorage.setItem("sgd.analyticsOff", off() ? "false" : "true"); } catch (e) {}
    show();
    if (off()) location.reload();
  });
  show();
})();
