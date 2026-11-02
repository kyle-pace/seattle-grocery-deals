// Store map. Reads locations from <script type="application/json" id="map-data">
// and draws them with Leaflet on OpenStreetMap tiles.
(function () {
  var el = document.getElementById("store-map");
  var dataEl = document.getElementById("map-data");
  if (!el || !dataEl || !window.L) return;
  var data = JSON.parse(dataEl.textContent);

  // Dark tiles follow the page's theme: the display settings choice, else the device.
  var theme = document.documentElement.getAttribute("data-theme");
  var dark = theme ? theme === "dark" : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  // Colors are light-dark() pairs in style.css; resolve them through a probe element.
  var probe = document.createElement("span");
  probe.hidden = true;
  document.body.appendChild(probe);
  function color(name, fallback) {
    probe.style.color = "var(" + name + ")";
    return getComputedStyle(probe).color || fallback;
  }
  var green = color("--green", "#1d4d3a");
  var tomato = color("--tomato", "#d9442b");
  var muted = color("--muted", "#5d6b64");
  var surface = color("--surface", "#ffffff");
  probe.remove();

  var map = L.map(el, { scrollWheelZoom: false, zoomControl: true });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    className: dark ? "tiles-dark" : "",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  var layers = {};
  var bounds = [];
  data.locations.forEach(function (l) {
    var style = l.noFlyer
      ? { radius: 6, color: muted, weight: 2, fillColor: surface, fillOpacity: 1 }
      : l.flyer
        ? { radius: 8, color: surface, weight: 2, fillColor: l.highlight ? tomato : green, fillOpacity: 1 }
        : { radius: 6, color: green, weight: 2, fillColor: surface, fillOpacity: 1 };
    var m = L.circleMarker([l.lat, l.lon], style);
    var note = l.noFlyer ? "No online flyer" : l.flyer ? "Uses the flyer tracked here" : "Other location; prices may differ";
    m.bindPopup(
      '<strong><a href="' + esc(l.url) + '">' + esc(l.store) + "</a></strong><br>" +
      esc(l.label) + "<br><span class=\"muted\">" + esc(l.address) + "</span><br>" +
      "<em>" + esc(note) + "</em>" +
      (l.summary ? "<br>" + esc(l.summary) : "")
    );
    m.bindTooltip(esc(l.store), { direction: "top", offset: [0, -6] });
    (layers[l.storeId] = layers[l.storeId] || []).push(m);
    m.addTo(map);
    if (l.lat > 47.35 && l.lat < 47.85) bounds.push([l.lat, l.lon]);
  });
  function fit() { map.invalidateSize(); map.fitBounds(bounds.length ? bounds : [[47.45, -122.45], [47.8, -122.1]], { padding: [10, 10], maxZoom: 14 }); }
  fit();
  window.addEventListener("load", fit);

  // Store toggles
  document.querySelectorAll("[data-map-store]").forEach(function (box) {
    box.addEventListener("change", function () {
      (layers[box.value] || []).forEach(function (m) {
        if (box.checked) m.addTo(map); else map.removeLayer(m);
      });
    });
  });
  document.querySelectorAll("[data-map-focus]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      var ms = layers[a.dataset.mapFocus];
      if (!ms || !ms.length) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (ms.length === 1) { map.setView(ms[0].getLatLng(), 14); ms[0].openPopup(); }
      else map.fitBounds(L.latLngBounds(ms.map(function (m) { return m.getLatLng(); })), { padding: [30, 30], maxZoom: 14 });
    });
  });
})();
