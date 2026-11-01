// Display settings: the round button in the corner opens a panel of reading options
// (theme, text size, contrast, font, spacing, motion, links). Each choice is a data
// attribute on <html>, styled in style.css, saved in this browser only, and applied
// before paint by the inline script in the page head (build.mjs). The site works
// without any of it; these are extra preferences. Same design as kylepace.net.
(function () {
  var KEY = "sgd.display";
  var root = document.documentElement;
  var panel = document.getElementById("display-panel");
  if (!panel) return;
  var form = panel.querySelector("form");

  // The first option in each group is the default, which removes the attribute.
  var defaults = {};
  Array.prototype.forEach.call(form.querySelectorAll("fieldset"), function (fs) {
    var first = fs.querySelector("input");
    if (first) defaults[first.name] = first.value;
  });

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function save(values) {
    try { localStorage.setItem(KEY, JSON.stringify(values)); } catch (e) {}
  }
  function apply(values) {
    Object.keys(defaults).forEach(function (key) {
      if (values[key]) root.setAttribute("data-" + key, values[key]);
      else root.removeAttribute("data-" + key);
      var input = form.querySelector('input[name="' + key + '"][value="' + (values[key] || defaults[key]) + '"]');
      if (input) input.checked = true;
    });
    document.dispatchEvent(new CustomEvent("sgd:display", { detail: values }));
  }

  apply(load());

  form.addEventListener("change", function (e) {
    var input = e.target;
    var values = load();
    if (input.value === defaults[input.name]) delete values[input.name];
    else values[input.name] = input.value;
    save(values);
    apply(values);
  });

  panel.querySelector(".dp-reset").addEventListener("click", function () {
    save({});
    apply({});
  });

  // Move focus into the panel when it opens; the browser returns it to the button on close.
  panel.addEventListener("toggle", function (e) {
    if (e.newState === "open") {
      var checked = panel.querySelector("input:checked");
      if (checked) checked.focus();
    }
  });
})();
