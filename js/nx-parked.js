/* Parked product: covers the page so nothing on it can be used (no deposits,
 * no wallet transactions, no trading) and points to what is live instead.
 * Pages opt in with <script src="/js/nx-parked.js" data-name="Product name"></script>. */
(function () {
  var me = document.currentScript;
  var name = (me && me.getAttribute('data-name')) || 'This product';
  function show() {
    var o = document.createElement('div');
    o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true');
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(5,8,14,.86);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,system-ui,sans-serif';
    o.innerHTML = '<div style="max-width:440px;background:#0E1420;border:1px solid rgba(138,180,255,.16);border-radius:12px;padding:30px 28px;text-align:center;color:#EAE5D6">' +
      '<img src="/assets/logo-mark.svg" alt="" style="width:36px;height:36px;margin-bottom:12px">' +
      '<div style="font:600 10px/1 JetBrains Mono,monospace;letter-spacing:.12em;text-transform:uppercase;color:#9AA3B2;margin-bottom:10px">Parked</div>' +
      '<h2 style="font:400 26px/1.2 Instrument Serif,Georgia,serif;margin:0 0 10px">' + name.replace(/[<>&]/g, '') + ' is not available</h2>' +
      '<p style="font-size:14px;line-height:1.55;color:rgba(234,229,214,.62);margin:0 0 20px">We are focusing on calibrated probabilities for prediction markets. This product stays parked until there is a public track record and an independent audit. Nothing here can be deposited into or traded.</p>' +
      '<a href="/prediction-terminal" style="display:inline-block;padding:11px 18px;background:#EAE5D6;color:#0A0E17;border-radius:6px;font:600 13px JetBrains Mono,monospace;text-decoration:none">Open the Prediction Terminal →</a></div>';
    document.body.appendChild(o);
    document.documentElement.style.overflow = 'hidden';
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
