(() => {
  const NS = globalThis.__swanlabYAutoRange;

  const STORAGE_KEY = "swanlab-y-auto-range:v1";
  const DEFAULTS = {
    mode: "auto", // "auto" | "manual"，manual 对应「指定 Y 的范围」
    filterMin: { enabled: true, t: 0 },
    filterMax: { enabled: true, t: 1 },
  };

  const listeners = new Set();
  let state = load();

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? structuredClone(DEFAULTS) : JSON.parse(raw);
  }

  function get() {
    return state;
  }

  function update(mutate) {
    mutate(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    for (const fn of listeners) fn(state);
  }

  function subscribe(fn) {
    listeners.add(fn);
  }

  NS.settings = { STORAGE_KEY, DEFAULTS, get, update, subscribe };
})();
