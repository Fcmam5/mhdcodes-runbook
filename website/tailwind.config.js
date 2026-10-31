// Tailwind settings for the landing page. After changing classes in index.html, 404.html or style.css,
// rebuild tailwind.css with the command in CONTRIBUTING.md.
export default {
  content: { relative: true, files: ["./index.html", "./404.html"] },
  theme: {
    extend: {
      // Dark surfaces, lightest last, and the brand pink. The accent lives in style.css as
      // custom properties so the page has one place to change it.
      colors: {
        page: "#141217",
        card: "#1a171e", // the app window, the feature cards, the download panel
        cell: "#201c25", // a shell cell in the app window, the recommended download
        raised: "#26212c", // the open runbook in the sidebar, the Copy buttons
        term: "#110f14", // commands and their output
        rule: "#2a2530", // section and window dividers
        line: "#2e2935", // card and command borders
        edge: "#3a3442", // outlined buttons
        split: "#24202a", // between a command and its output
        ink: "#f4eff5",
        body: "#c9c1cf", // the hero's lede
        muted: "#b3abba",
        faint: "#9c94a3",
        ok: "#7ddba5", // exit 0
        hash: "#e8c27a", // commit hashes
        acc: "var(--accent)",
        "acc-soft": "var(--accent-soft)",
        "on-acc": "#1a0f15", // text on the accent
      },
      fontFamily: {
        sans: ["Archivo", "system-ui", "sans-serif"],
        hand: ["Caveat", "cursive"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
    },
  },
};
