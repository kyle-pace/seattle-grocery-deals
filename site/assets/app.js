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
  // "Not ending today" or "3+ days left": the fewest days a deal must have left, counting today.
  // Kept in localStorage like Vegetarian, so it follows you from page to page.
  var KEY_ENDS = "sgd.endsMin";
  var endsSel = document.querySelector('[data-filter="ends"]');
  var endsMin = +load(KEY_ENDS, 0) || 0;
  if (endsSel) endsSel.value = String(endsMin);
  function enoughLeft(iso) { return !endsMin || !iso || daysUntil(iso) + 1 >= endsMin; }
  var home = document.querySelector("[data-home]");
  var results = document.querySelector("[data-results]");

  function query() { return search ? search.value.trim().toLowerCase() : ""; }

  function rowOk(el, q) {
    if (vegOnly && el.dataset.veg === "0") return false;
    if (el.dataset.hl && el.dataset.hl.indexOf(vegOnly ? "v" : "a") === -1) return false;
    if (storeSel && storeSel.value && el.dataset.store !== storeSel.value) return false;
    if (!enoughLeft(el.dataset.ends)) return false;
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
        (vegOnly ? ", vegetarian only" : "") + (endsMin === 2 ? ", not ending today" : endsMin ? ", with " + endsMin + "+ days left" : "") + (storeSel && storeSel.value ? ", at " + storeSel.options[storeSel.selectedIndex].text : "") + ".";
    }
    // With nothing to show, the empty state says it; the count stays for screen readers.
    if (count) count.classList.toggle("sr-only", shown === 0);
    var empty = scope.querySelector("[data-empty]");
    if (empty) {
      empty.hidden = shown !== 0;
      var msg = empty.querySelector("[data-empty-msg]");
      if (msg) msg.textContent = q ? "Nothing matches “" + search.value.trim() + "”. New flyers come in all week, so check back soon." : empty.dataset.fallback;
    }
    showEnding();
  }

  function sortRows() {
    var by = sortSel ? sortSel.value : "rank";
    var key = {
      rank: function (el) { return +el.dataset.rank; },
      off: function (el) { return -(+el.dataset.off) * 1000 + +el.dataset.rank / 1000; },
      // Unit price when there is one, as the app sorts ("99¢ ea" no longer beats "89¢/lb").
      price: function (el) { return +(el.dataset.unit || el.dataset.price); },
      name: null,
    }[by];
    all("[data-sortable]").forEach(function (ul) {
      var rows = all(":scope > .deal", ul);
      // Ended deals stay at the bottom whatever the sort.
      var end = function (el) { return el.classList.contains("deal-ended") ? 1 : 0; };
      rows.sort(function (a, b) { return end(a) - end(b) || (key ? key(a) - key(b) : a.dataset.name.localeCompare(b.dataset.name)); });
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
  if (endsSel) endsSel.addEventListener("change", function () {
    endsMin = +endsSel.value || 0;
    save(KEY_ENDS, endsMin);
    apply();
  });
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

  // "Fresh off the press" on This week, once per week until dismissed (Moments.swift
  // EditionBanner). The "next edition" and "sales have ended" notes are gone (2026-11-05):
  // stores update on their own days, so each row says when it ends instead.
  var edition = document.querySelector("[data-edition]");
  if (edition) {
    var SEEN = "sgd.seenEdition";
    var fresh = edition.querySelector("[data-edition-fresh]");
    if (fresh && load(SEEN, "") !== edition.dataset.week) fresh.hidden = false;
    var dismiss = edition.querySelector("[data-edition-dismiss]");
    if (dismiss) dismiss.addEventListener("click", function () {
      save(SEEN, edition.dataset.week);
      fresh.hidden = true;
      var next = document.querySelector("#h-best");
      if (next) { next.setAttribute("tabindex", "-1"); next.focus(); }
    });
  }

  // When each deal ends, counted from today in Seattle, as the app says it: a red "Ends today"
  // or "Ends tomorrow" badge, a gray "Ended", or "Through Sat" in the details. The build writes
  // the same words for its own day; this keeps a cached page right.
  var ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var CLOCK = '<svg class="ic ic-clock" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.3"/><path d="M8 4.6V8l2.4 1.6"/></svg>';
  all(".deal[data-ends]").forEach(function (row) {
    var d = row.dataset.ends, left = daysUntil(d) + 1;
    var word = left <= 0 ? "Ended" : left === 1 ? "Ends today" : left === 2 ? "Ends tomorrow" : "";
    var b = row.querySelector("[data-ends-badge]"), det = row.querySelector("[data-ends-detail]");
    if (b) {
      b.innerHTML = word ? '<span class="badge tone-' + (left <= 0 ? "neutral" : "bad") + '">' + CLOCK + word + "</span>" : "";
      b.hidden = !word;
    }
    if (det) {
      var dt = new Date(d + "T12:00:00Z");
      det.textContent = word ? "" : (det.hasAttribute("data-sep") ? " \u00b7 " : "") + "Through " + (left <= 7 ? ABBR[dt.getUTCDay()] : MON[dt.getUTCMonth()] + " " + dt.getUTCDate());
      det.hidden = !!word;
    }
    row.classList.toggle("deal-ended", left <= 0);
  });

  // Store pages: "3 days left" on the weekly ad, counted again here in case the page is old.
  all("[data-days-left]").forEach(function (el) {
    var left = daysUntil(el.dataset.daysLeft) + 1;
    if (left < 1) { el.hidden = true; return; }
    el.textContent = " \u00b7 " + (left === 1 ? "Ends today" : left + " days left");
  });

  // This week's season card: the X hides it for this season, as in the app. The buddy in the
  // top bar still opens the season's page.
  var hiddenSeasons = load("sgd.hiddenSeasons", []);
  all("[data-season-card]").forEach(function (card) {
    var id = card.dataset.seasonCard;
    if (hiddenSeasons.indexOf(id) >= 0) { card.hidden = true; return; }
    var x = card.querySelector("[data-season-hide]");
    if (x) x.addEventListener("click", function () {
      hiddenSeasons.push(id);
      save("sgd.hiddenSeasons", hiddenSeasons);
      card.hidden = true;
      var next = document.querySelector("#h-best");
      if (next) { next.setAttribute("tabindex", "-1"); next.focus(); }
    });
  });

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
      var ok = d >= 0 && d <= 2 && enoughLeft(li.dataset.ends) && shown < 8 && !(vegOnly && li.dataset.veg === "0") && !(storeSel && storeSel.value && li.dataset.store !== storeSel.value);
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
