// Runs before first paint so the saved theme never flashes.
(function () {
  try {
    var t = localStorage.getItem("sbm.theme");
    if (t) document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
