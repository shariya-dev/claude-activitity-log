/**
 * The loopback pairing page: inline HTML, CSS and JS, no external assets. It posts the code to
 * `<page>/code` and polls `<page>/status` (both relative to the tokenised page URL).
 */
export const PAIRING_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Pair this device · 6AM Agent</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --fg: #1b1f24; --muted: #5b6470;
    --accent: #2f6fed; --ok: #1a7f37; --err: #c62828; --border: #d9dde3; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f1216; --card: #181c22; --fg: #e8eaed; --muted: #9aa3ad; --accent: #6b9bff;
      --ok: #4ac26b; --err: #ff6b6b; --border: #2a3038; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
    background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 28px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 0 0 16px; color: var(--muted); }
  label { display: block; font-weight: 600; margin-bottom: 6px; }
  input { width: 100%; font: inherit; font-size: 20px; letter-spacing: 2px; text-transform: uppercase;
    padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: inherit; }
  button { margin-top: 14px; width: 100%; font: inherit; font-weight: 600; padding: 10px; border: 0;
    border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  ol { list-style: none; padding: 0; margin: 16px 0 0; }
  li { padding: 6px 0; color: var(--muted); }
  li.active { color: var(--fg); }
  li.done { color: var(--ok); }
  .error { color: var(--err); margin-top: 12px; min-height: 1.5em; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1>Pair this device</h1>
  <p>Enter the pairing code from the 6AM Claude Monitor dashboard.</p>
  <form id="form" autocomplete="off">
    <label for="code">Pairing code</label>
    <input id="code" name="code" maxlength="32" required autofocus spellcheck="false">
    <button id="submit" type="submit">Pair device</button>
    <div id="error" class="error" role="alert"></div>
  </form>
  <ol id="steps" hidden aria-live="polite">
    <li id="s-paired">Pairing…</li>
    <li id="s-detect">Detecting Claude Code…</li>
    <li id="s-sync">Initial sync…</li>
    <li id="s-done" hidden>Done. You can close this tab; monitoring continues in the background.</li>
  </ol>
</main>
<script>
(function () {
  var base = location.pathname;
  var form = document.getElementById('form');
  var input = document.getElementById('code');
  var button = document.getElementById('submit');
  var errorBox = document.getElementById('error');
  var steps = document.getElementById('steps');
  var timer = null;

  function text(id, value, cls) {
    var el = document.getElementById(id);
    el.textContent = value;
    el.className = cls || '';
  }

  function render(s) {
    if (s.phase === 'waiting') return;
    if (s.phase === 'error') {
      form.hidden = false;
      steps.hidden = true;
      button.disabled = false;
      errorBox.textContent = s.message;
      stop();
      return;
    }
    form.hidden = true;
    steps.hidden = false;
    errorBox.textContent = '';
    if (s.phase === 'registering') {
      text('s-paired', 'Pairing…', 'active');
      return;
    }
    text('s-paired', 'Paired as ' + s.developer, 'done');
    if (s.phase === 'detecting') {
      text('s-detect', 'Detecting Claude Code…', 'active');
      return;
    }
    if (s.phase === 'done' && !s.claudeFound) {
      text('s-detect', 'Claude Code data not found yet. The agent keeps looking and syncs once it appears.', 'active');
      text('s-sync', 'Initial sync: waiting for Claude Code data', '');
    } else {
      text('s-detect', 'Claude Code detected', 'done');
      text('s-sync', 'Initial sync: ' + s.sessions + ' sessions, ' + s.usage + ' usage records',
        s.phase === 'done' ? 'done' : 'active');
    }
    if (s.phase === 'done') {
      document.getElementById('s-done').hidden = false;
      stop();
    }
  }

  function poll() {
    fetch(base + '/status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        render(s);
        if (s.phase !== 'waiting' && s.phase !== 'error' && s.phase !== 'done') start();
      })
      .catch(function () {});
  }

  function start() { if (timer === null) timer = setInterval(poll, 1000); }
  function stop() { if (timer !== null) { clearInterval(timer); timer = null; } }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.textContent = '';
    button.disabled = true;
    fetch(base + '/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: input.value })
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok && res.body.message) {
          errorBox.textContent = res.body.message;
          button.disabled = false;
          return;
        }
        render(res.body);
        start();
      })
      .catch(function () {
        errorBox.textContent = 'The agent is not responding. Close this tab and run the pairing again.';
        button.disabled = false;
      });
  });

  poll();
})();
</script>
</body>
</html>
`;
