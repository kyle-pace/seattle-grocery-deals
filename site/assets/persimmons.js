// Falling persimmons. Click anywhere for more. Off when the visitor prefers reduced motion.
(function () {
  var sky = document.querySelector("[data-persim-sky]");
  var tpl = document.querySelector("[data-persim-svg]");
  if (!sky || !tpl) return;
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function drop(x, opts) {
    opts = opts || {};
    var p = document.createElement("div");
    p.className = "faller";
    p.innerHTML = tpl.innerHTML;
    var size = opts.size || 24 + Math.random() * 40;
    var dur = 6 + Math.random() * 8;
    p.style.left = (x == null ? Math.random() * 100 + "vw" : x - size / 2 + "px");
    p.style.width = p.style.height = size + "px";
    p.style.setProperty("--dur", dur + "s");
    p.style.setProperty("--spin", (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 360) + "deg");
    p.style.setProperty("--sway", (Math.random() * 60 - 30) + "px");
    if (opts.delay != null) p.style.animationDelay = opts.delay + "s";
    if (opts.from != null) p.style.top = opts.from + "px";
    sky.appendChild(p);
    if (opts.once) p.addEventListener("animationend", function () { p.remove(); });
    else p.addEventListener("animationiteration", function () { p.style.left = Math.random() * 100 + "vw"; });
    return p;
  }

  if (!still) {
    for (var i = 0; i < 18; i++) drop(null, { delay: -Math.random() * 14 });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("a, button, select, input")) return;
    if (still) return;
    for (var j = 0; j < 5; j++) {
      var f = drop(e.clientX + (Math.random() * 80 - 40), { once: true, from: e.clientY - 40 });
      f.classList.add("burst");
    }
  });

  var mascot = document.querySelector("[data-bounce]");
  if (mascot) mascot.addEventListener("click", function () {
    mascot.classList.remove("boing");
    void mascot.offsetWidth;
    mascot.classList.add("boing");
  });
})();
