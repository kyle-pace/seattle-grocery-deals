// The map page (/map/): filters the server-built list and draws a pin for each place in it.
// The list is the page without JavaScript; this adds the map, filters, search and "Near me".
// "Near me" asks the browser for a location once, uses it on this device to sort the list and
// show distances, and sends it nowhere.
document.addEventListener("DOMContentLoaded", function () {
  var list = document.querySelector("[data-map-list]");
  var el = document.getElementById("big-map");
  if (!list || !el) return;
  var items = [].slice.call(list.querySelectorAll(".mp-item"));
  var tools = document.querySelector("[data-map-tools]");
  var count = document.querySelector("[data-map-count]");
  var empty = document.querySelector("[data-map-empty]");
  var q = document.querySelector("[data-map-q]");
  var kinds = [].slice.call(document.querySelectorAll("[data-map-kind]"));
  var flags = [].slice.call(document.querySelectorAll("[data-map-f]"));
  var near = document.querySelector("[data-map-near]");
  tools.hidden = false;
  var map = null, markers = [];

  if (window.L) {
    el.hidden = false;
    var theme = document.documentElement.getAttribute("data-theme");
    var dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    map = L.map(el, { scrollWheelZoom: false });
    // OpenStreetMap tiles, grayed and quieted in CSS (.tiles-quiet) so the pins carry the color.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, className: dark ? "tiles-quiet tiles-dark" : "tiles-quiet",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    var layer = L.layerGroup().addTo(map);
    items.forEach(function (li) {
      var pin = li.querySelector(".mp-pin");
      var link = li.querySelector("h3 a");
      var icon = L.divIcon({ className: "", html: '<span class="mp-pin mp-' + li.dataset.kind + '">' + pin.textContent + "</span>", iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -10] });
      // Pins are for pointers and touch. Keyboards and screen readers get the same thing from the
      // list's "Show on map" buttons (pins overlap too much to be tab stops or 24px targets).
      var m = L.marker([+li.dataset.lat, +li.dataset.lon], { icon: icon, title: link.textContent, keyboard: false });
      // The popup is a copy of the list entry, without its own "Show on map" button.
      var card = li.cloneNode(true);
      card.querySelectorAll("[data-show],[data-dist]").forEach(function (x) { x.remove(); });
      m.bindPopup('<div class="mp-pop">' + card.innerHTML + "</div>", { maxWidth: 280 });
      markers.push(m);
      var show = li.querySelector("[data-show]");
      show.hidden = false;
      show.addEventListener("click", function () {
        el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
        map.setView(m.getLatLng(), Math.max(map.getZoom(), 16));
        draw();
        m.openPopup();
      });
    });
  }

  function on(b) { return b.getAttribute("aria-pressed") === "true"; }
  function apply(fit) {
    var words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    var wantKinds = kinds.filter(on).map(function (b) { return b.dataset.mapKind; });
    var wantFlags = flags.filter(on).map(function (b) { return b.dataset.mapF; });
    var shown = 0, pts = [];
    items.forEach(function (li, i) {
      var ok = (!wantKinds.length || wantKinds.indexOf(li.dataset.kind) > -1)
        && wantFlags.every(function (f) { return f in li.dataset; })
        && words.every(function (w) { return li.dataset.text.indexOf(w) > -1; });
      li.hidden = !ok;
      if (ok) shown++;
      if (map && ok) pts.push(markers[i].getLatLng());
    });
    count.textContent = shown === items.length ? items.length + " places" : shown + " of " + items.length + " places";
    empty.hidden = shown > 0;
    // Frame the places shown, leaving out far-off stores (Tacoma, Everett) unless they're all there is.
    var core = pts.filter(function (p) { return p.lat > 47.42 && p.lat < 47.83; });
    if (map && fit && pts.length) map.fitBounds(L.latLngBounds(core.length ? core : pts), { padding: [24, 24], maxZoom: 14 });
    draw();
  }

  // Pins that would sit on top of each other at this zoom become one numbered circle; tap it to
  // zoom in. Done by hand on a pixel grid, to keep the page's JavaScript small (no plugin).
  function draw() {
    if (!map) return;
    layer.clearLayers();
    var cells = {};
    items.forEach(function (li, i) {
      if (li.hidden) return;
      var p = map.latLngToLayerPoint(markers[i].getLatLng());
      var key = Math.round(p.x / 34) + ":" + Math.round(p.y / 34);
      (cells[key] = cells[key] || []).push(markers[i]);
    });
    Object.keys(cells).forEach(function (k) {
      var group = cells[k];
      if (group.length === 1 || map.getZoom() >= 16) return group.forEach(function (m) { layer.addLayer(m); });
      var b = L.latLngBounds(group.map(function (m) { return m.getLatLng(); }));
      var c = L.marker(b.getCenter(), { keyboard: false, title: group.length + " places", icon: L.divIcon({ className: "", html: '<span class="mp-cluster">' + group.length + "</span>", iconSize: [34, 34], iconAnchor: [17, 17] }) });
      c.on("click", function () { map.fitBounds(b, { padding: [40, 40], maxZoom: 17 }); });
      layer.addLayer(c);
    });
  }
  if (map) map.on("zoomend", draw);
  [].concat(kinds, flags).forEach(function (b) {
    b.addEventListener("click", function () { b.setAttribute("aria-pressed", String(!on(b))); apply(true); });
  });
  var t;
  q.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { apply(true); }, 200); });

  // Near me: sort by distance, show it on each entry, and center the map.
  if (!navigator.geolocation) near.hidden = true;
  near.addEventListener("click", function () {
    near.disabled = true;
    count.textContent = "Finding where you are...";
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lon = pos.coords.longitude;
      var r = Math.PI / 180;
      items.forEach(function (li) {
        var dLat = (li.dataset.lat - lat) * r, dLon = (li.dataset.lon - lon) * r;
        var a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat * r) * Math.cos(li.dataset.lat * r) * Math.pow(Math.sin(dLon / 2), 2);
        li._mi = 3959 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        li.querySelector("[data-dist]").textContent = ", " + (li._mi < 10 ? li._mi.toFixed(1) : Math.round(li._mi)) + " mi away";
      });
      items.slice().sort(function (a, b) { return a._mi - b._mi; }).forEach(function (li) { list.appendChild(li); });
      near.setAttribute("aria-pressed", "true");
      near.disabled = false;
      apply(false);
      if (map) { map.setView([lat, lon], 13); draw(); }
    }, function () {
      near.disabled = false;
      apply(false);
      count.textContent += ". Couldn't get your location, so the list is in A to Z order.";
    }, { maximumAge: 600000, timeout: 10000 });
  });

  // /map/#market or /map/#shops (from the markets and shops pages) starts with those kinds on.
  var want = { market: ["market"], shops: ["butcher", "seafood", "world", "neighborhood"] }[location.hash.slice(1)] || [];
  kinds.forEach(function (b) { if (want.indexOf(b.dataset.mapKind) > -1) b.setAttribute("aria-pressed", "true"); });
  apply(!want.length);
  // With nothing picked, open on Seattle itself rather than every far-off store.
  if (map && !want.length) { map.fitBounds([[47.5, -122.42], [47.74, -122.2]]); draw(); }
  else apply(true);
});
