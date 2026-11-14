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
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, className: dark ? "tiles-dark" : "",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    items.forEach(function (li) {
      var pin = li.querySelector(".mp-pin");
      var link = li.querySelector("h3 a");
      var icon = L.divIcon({ className: "", html: '<span class="mp-pin mp-' + li.dataset.kind + '">' + pin.textContent + "</span>", iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] });
      // Pins are for pointers and touch. Keyboards and screen readers get the same thing from the
      // list's "Show on map" buttons (pins overlap too much to be tab stops or 24px targets).
      var m = L.marker([+li.dataset.lat, +li.dataset.lon], { icon: icon, title: link.textContent, keyboard: false });
      // The popup is a copy of the list entry, without its own "Show on map" button.
      var card = li.cloneNode(true);
      card.querySelectorAll("[data-show],[data-dist]").forEach(function (x) { x.remove(); });
      m.bindPopup('<div class="mp-pop">' + card.innerHTML + "</div>", { maxWidth: 280 });
      m.addTo(map);
      markers.push(m);
      var show = li.querySelector("[data-show]");
      show.hidden = false;
      show.addEventListener("click", function () {
        el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
        map.setView(m.getLatLng(), Math.max(map.getZoom(), 14));
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
      if (map) {
        if (ok) { markers[i].addTo(map); pts.push(markers[i].getLatLng()); } else map.removeLayer(markers[i]);
      }
    });
    count.textContent = shown === items.length ? items.length + " places" : shown + " of " + items.length + " places";
    empty.hidden = shown > 0;
    // Frame the places shown, leaving out far-off stores (Tacoma, Everett) unless they're all there is.
    var core = pts.filter(function (p) { return p.lat > 47.42 && p.lat < 47.83; });
    if (map && fit && pts.length) map.fitBounds(L.latLngBounds(core.length ? core : pts), { padding: [24, 24], maxZoom: 14 });
  }
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
      if (map) map.setView([lat, lon], 13);
    }, function () {
      near.disabled = false;
      apply(false);
      count.textContent += ". Couldn't get your location, so the list is in A to Z order.";
    }, { maximumAge: 600000, timeout: 10000 });
  });

  apply(true);
});
