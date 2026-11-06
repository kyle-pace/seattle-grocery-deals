// The list, kept in this browser only (localStorage "sgd.list"), like the app's List tab.
// Every deal row has a + (build.mjs dealRow, with the deal in data-li). The list shows in two
// places that work the same way: the floating List button's panel on every page, and the
// /list/ page. Each is a [data-list-view]. Getting it into Reminders works for everyone:
// Copy list (each pasted line becomes its own reminder), plus Share where the browser has it.
(function () {
  var KEY = "sgd.list";

  function load() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
    refresh();
  }
  function all(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return i; return -1; }
  var BASE = document.documentElement.dataset.base || "/";

  // Days left counting today in Seattle: 1 is "Ends today", 0 or less has ended.
  var today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  function left(d) { return Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000) + 1; }
  function ended(i) { return Boolean(i.ends) && left(i.ends) <= 0; }
  var ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function endsWord(d) {
    if (!d) return "";
    var n = left(d), dt = new Date(d + "T12:00:00Z");
    if (n <= 0) return "Ended";
    if (n === 1) return "Ends today";
    if (n === 2) return "Ends tomorrow";
    return "Through " + (n <= 7 ? ABBR[dt.getUTCDay()] : MON[dt.getUTCMonth()] + " " + dt.getUTCDate());
  }

  // A small note at the bottom of the screen ("Added to your list"), read out by screen readers.
  var toast = document.createElement("p");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.hidden = true;
  document.body.appendChild(toast);
  var toastTimer;
  function say(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 2600);
  }

  // ---- + buttons on deal rows ----
  function rowDeal(btn) {
    var row = btn.closest("[data-li]");
    try { return row ? JSON.parse(row.dataset.li) : null; } catch (e) { return null; }
  }
  function paintButtons(list) {
    all("[data-add]").forEach(function (btn) {
      var d = rowDeal(btn);
      if (!d) return;
      var on = find(list, d.id) >= 0;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("aria-label", (on ? "Remove " : "Add ") + d.name + " at " + d.storeName + (on ? " from your list" : " to your list"));
    });
  }
  var fab = document.querySelector("[data-list-fab]");
  function bump() {
    if (!fab) return;
    fab.classList.remove("bump");
    void fab.offsetWidth;
    fab.classList.add("bump");
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-add]");
    if (!btn) return;
    var d = rowDeal(btn);
    if (!d) return;
    var list = load(), at = find(list, d.id);
    if (at >= 0) {
      list.splice(at, 1);
      save(list);
      say("Removed " + d.name + " from your list");
      return;
    }
    d.added = today;
    list.push(d);
    save(list);
    bump();
    var w = endsWord(d.ends);
    say("Added " + d.name + (w === "Ends today" || w === "Ends tomorrow" ? ". Heads up: it " + w.toLowerCase() : w === "Ended" ? ". This sale has ended" : ""));
  });

  // The counts on the floating button and the List tab.
  function paintCount(list) {
    var open = list.filter(function (i) { return !i.done; }).length;
    all("[data-list-count]").forEach(function (el) {
      el.textContent = open;
      el.hidden = open === 0;
    });
    if (fab) fab.setAttribute("aria-label", "Your list, " + open + (open === 1 ? " item" : " items"));
  }

  // ---- the list views (the panel and the List page) ----

  // One line per item, each starting with a dash so they read as a list wherever they're pasted:
  // "- Chicken Drumsticks (99¢/lb at Viet-Wah, ends today)".
  function line(i) {
    if (i.custom) return "- " + i.name;
    var w = endsWord(i.ends);
    return "- " + i.name + " (" + i.price + " at " + i.storeName + (w ? ", " + w.charAt(0).toLowerCase() + w.slice(1) : "") + ")";
  }
  function exportLines() {
    return load().filter(function (i) { return !i.done && !ended(i); }).map(line);
  }

  var TRASH = '<svg class="ic" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.8 4.3h10.4M6.3 4.3V2.8h3.4v1.5M4.2 4.3l.6 9h6.4l.6-9"/></svg>';
  function renderView(view, list) {
    var groups = {}, order = [];
    list.forEach(function (i) {
      var k = i.custom ? "~" : i.store;
      if (!groups[k]) { groups[k] = { name: i.custom ? "Other things" : i.storeName, store: i.custom ? null : i.store, items: [] }; order.push(k); }
      groups[k].items.push(i);
    });
    order.sort(function (a, b) { return a === "~" ? 1 : b === "~" ? -1 : groups[a].name.localeCompare(groups[b].name); });
    view.querySelector("[data-list-body]").innerHTML = order.map(function (k) {
      var g = groups[k];
      return '<section class="list-group"><h3 class="sec-label">' + (g.store ? '<a href="' + BASE + "stores/" + esc(g.store) + '/">' + esc(g.name) + "</a>" : esc(g.name)) +
        ' <span class="sec-note">' + g.items.length + '</span></h3><ul class="list-items">' + g.items.map(function (i) {
          var w = endsWord(i.ends), n = i.ends ? left(i.ends) : 99;
          var badge = n <= 2 ? '<span class="badge tone-' + (n <= 0 ? "neutral" : "bad") + '">' + w + "</span>" : "";
          var meta = i.custom ? "" : [esc(i.price), n > 2 && w ? w : ""].filter(Boolean).join(" · ");
          return '<li class="list-item' + (i.done ? " done" : "") + (n <= 0 ? " ended" : "") + '" data-id="' + esc(i.id) + '">' +
            '<label class="list-check"><input type="checkbox" data-list-done' + (i.done ? " checked" : "") + '><span class="list-text"><span class="list-name">' + esc(i.name) + "</span>" +
            (badge || meta ? '<span class="list-meta">' + badge + (meta ? "<span>" + meta + "</span>" : "") + "</span>" : "") + "</span></label>" +
            '<button type="button" class="icon-btn" data-list-remove aria-label="Remove ' + esc(i.name) + '">' + TRASH + "</button></li>";
        }).join("") + "</ul></section>";
    }).join("");
    var has = list.length > 0;
    var q = function (s) { return view.querySelector(s); };
    q("[data-list-empty]").hidden = has;
    q("[data-list-tools]").hidden = !has;
    var foot = q("[data-list-foot]");
    if (foot) foot.hidden = !has;
    var ce = q("[data-list-clear-ended]"), cd = q("[data-list-clear-done]");
    if (ce) ce.hidden = !list.some(ended);
    if (cd) cd.hidden = !list.some(function (i) { return i.done; });
  }

  function wire(view) {
    var status = view.querySelector("[data-list-status]");
    var share = view.querySelector("[data-list-share]");
    if (share && navigator.share) share.hidden = false;
    function tell(text) { if (status) status.textContent = text; }

    view.addEventListener("change", function (e) {
      if (!e.target.matches("[data-list-done]")) return;
      var id = e.target.closest("[data-id]").dataset.id, list = load(), at = find(list, id);
      if (at >= 0) { list[at].done = e.target.checked; save(list); }
    });
    view.addEventListener("click", function (e) {
      var b = e.target.closest("[data-list-remove]");
      if (b) {
        var li = b.closest("[data-id]"), list = load(), at = find(list, li.dataset.id);
        if (at < 0) return;
        var name = list[at].name;
        list.splice(at, 1);
        save(list);
        say("Removed " + name);
        return;
      }
      if (e.target.closest("[data-list-clear-done]")) { save(load().filter(function (i) { return !i.done; })); say("Cleared checked items"); return; }
      if (e.target.closest("[data-list-clear-ended]")) { save(load().filter(function (i) { return !ended(i); })); say("Removed ended deals"); return; }
      if (e.target.closest("[data-list-copy]")) { copy(); return; }
      if (e.target.closest("[data-list-share]")) {
        var lines = exportLines();
        if (!lines.length) return tell("Nothing to share: everything is checked off or has ended.");
        navigator.share({ title: "Grocery list", text: lines.join("\n") }).catch(function () {});
      }
    });
    var form = view.querySelector("[data-list-add]");
    if (form) form.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = form.querySelector("input"), text = input.value.trim();
      if (!text) return;
      var list = load();
      list.push({ id: "t|" + Date.now(), name: text, custom: true, added: today });
      save(list);
      input.value = "";
      say("Added " + text);
    });

    function copy() {
      var lines = exportLines();
      if (!lines.length) return tell("Nothing to copy: everything is checked off or has ended.");
      var text = lines.join("\n");
      var done = function () { tell("Copied " + lines.length + (lines.length === 1 ? " item" : " items") + ". Paste into a list in Reminders and each line becomes its own reminder."); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { tell("Couldn't copy here. Select the list and copy it yourself."); }
        document.body.removeChild(ta);
      }
    }
  }

  var views = all("[data-list-view]");
  views.forEach(wire);

  function refresh() {
    var list = load();
    paintButtons(list);
    paintCount(list);
    views.forEach(function (v) { renderView(v, list); });
  }

  // Another tab changed the list: keep this one in step.
  window.addEventListener("storage", function (e) { if (e.key === KEY) refresh(); });
  refresh();
})();
