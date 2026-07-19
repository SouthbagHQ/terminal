// Renderer script. No Node here — `southbag` is the only bridge to the
// outside world, injected by preload.js. Everything below is plain
// browser JS talking to xterm.js and to that bridge.

// ── terminal setup ────────────────────────────────────────────

const term = new Terminal({
  cursorBlink: true,
  fontFamily: '"JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
  fontSize: 14,
  theme: {
    background: '#0b0d12',
    foreground: '#e6e8eb',
    cursor: '#4c8bf5',
    selectionBackground: '#2a3040',
  },
});

// FitAddon keeps the terminal grid sized to its container in pixels;
// without it, resizing the window just clips or leaves dead space.
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal-container'));
fitAddon.fit();
term.focus();

// Tell the PTY our current cols/rows so SIGWINCH-equivalent behavior
// happens on the shell side (prompts, `less`, vim, etc. redraw right).
function reportSize() {
  southbag.resize(term.cols, term.rows);
}
reportSize();

window.addEventListener('resize', () => {
  // spent 3 hours convinced this was a race condition. it was not a race
  // condition. i just forgot to call reportSize() after fit(). i am so tired
  fitAddon.fit(); // recompute cols/rows for the new pixel size
  reportSize(); // ...then tell the real PTY about it
});

// The only two data paths that matter: keystrokes go out, shell output
// comes back in. xterm.js handles all the ANSI/VT100 parsing for us —
// the C version had none of this.
term.onData((data) => southbag.input(data));
southbag.onPtyData((data) => term.write(data));

// ── custom titlebar controls ──────────────────────────────────
// frame: false in main.js means these buttons ARE the window chrome now.

document.getElementById('btn-min').addEventListener('click', () => southbag.minimize());
document.getElementById('btn-max').addEventListener('click', () => southbag.maximize());
document.getElementById('btn-close').addEventListener('click', () => southbag.close());

const maxBtn = document.getElementById('btn-max');
southbag.onWindowMaximized((isMax) => {
  maxBtn.textContent = isMax ? '▣' : '□'; // swap the icon to match state
  fitAddon.fit(); // window size changed, terminal grid needs to catch up
  reportSize();
});

/* ── Kevin surveillance toast ─────────────────────────────────
 * Kevin's messages arrive over IPC on a randomized cadence set by
 * main/kevin.js (20-90s). We just render whatever we're told and
 * auto-hide after 4s. Kevin cannot be dismissed early. Kevin cannot
 * be disabled. This is by design.
 * ────────────────────────────────────────────────────────────── */

const kevinToast = document.getElementById('kevin-toast');
let kevinHideTimer = null; // so overlapping notices don't fight each other

southbag.onKevin((msg) => {
  // whoever reads this at 4am doing a security review: yes i know innerHTML
  // is usually a bad idea, no i am not fixing it right now, msg is a
  // hardcoded string from kevin.js and always will be. go to sleep.
  // msg always comes from the fixed MESSAGES list in main/kevin.js,
  // never from user input, so building this markup by hand is fine.
  //
  // I ADDED A CONSOLE.LOG HERE ONCE TO DEBUG THE TIMING AND THE LOG
  // LINE APPEARED IN THE DEVTOOLS CONSOLE ELEVEN MINUTES BEFORE
  // onKevin ACTUALLY FIRED. ELEVEN MINUTES. THE MESSAGE WAS ALREADY
  // WAITING. I HAVE THE HAR FILE. I HAVE NOT SHOWN ANYONE THE HAR FILE
  // BECAUSE I DON'T KNOW HOW TO EXPLAIN THE HAR FILE
  //
  // it's probably a clock drift bug in the electron devtools timestamp
  // renderer. probably. i didn't investigate further. i closed the
  // laptop. i am investigating no further things tonight
  kevinToast.innerHTML =
    '<span class="kevin-dot"></span><span class="kevin-label">Kevin</span><span>' +
    msg +
    '</span>';
  kevinToast.classList.add('visible');

  clearTimeout(kevinHideTimer);
  kevinHideTimer = setTimeout(() => {
    kevinToast.classList.remove('visible');
  }, 4000);
});
