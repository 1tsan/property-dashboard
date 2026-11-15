import { render } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { decodeHandoff, isListingUrl } from "./extract.js";

const API = "/api/reimagine/";
const PASS_KEY = "reimagine:passcode";
const STYLE_KEY = "reimagine:style";
const AUTO_ANALYSE = 12; // photos assessed without being asked; the rest are assessed when opened
const MAX_EDGE = 1568;

const STYLES = [
  ["designer", "Designer's choice"], ["classic", "Modern classic"], ["scandi", "Scandinavian"], ["japandi", "Japandi"],
  ["period", "Period-sympathetic"], ["contemporary", "Contemporary"], ["bold", "Bold colour"],
];
const LEVELS = { refresh: "Refresh", renovate: "Renovate", transform: "Transform" };
const gbp = (n) => "£" + (n >= 1000 ? (n / 1000).toFixed(n >= 10000 || n % 1000 === 0 ? 0 : 1) + "k" : Math.round(n));

const store = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },
};

// ─── API ──────────────────────────────────────────────────────────────────────
// The app registers a function here that shows the passcode dialog and resolves with what was typed.
let askPasscode = async () => "";

async function api(path, { body, query } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let pass = store.get(PASS_KEY);
    if (!pass) {
      pass = await askPasscode(attempt > 0);
      store.set(PASS_KEY, pass);
    }
    const res = await fetch(API + path + (query ? "?" + new URLSearchParams(query) : ""), {
      method: body ? "POST" : "GET",
      headers: { "x-reimagine-passcode": pass, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { store.set(PASS_KEY, ""); continue; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Something went wrong (${res.status}).`);
    }
    return res;
  }
  throw new Error("Wrong passcode.");
}

// Run at most `limit` jobs at a time so a 30-photo listing doesn't fire 30 requests at once.
function limiter(limit) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= limit || !waiting.length) return;
    active++;
    const { job, resolve, reject } = waiting.shift();
    job().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (job) => new Promise((resolve, reject) => { waiting.push({ job, resolve, reject }); next(); });
}
const loadQueue = limiter(4);
const analyseQueue = limiter(3);
const renderQueue = limiter(2);

// Downscale to what the models can use and re-encode as JPEG: smaller uploads, same result.
async function prepare(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const jpeg = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.86));
  const dataUrl = await new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = fail;
    r.readAsDataURL(jpeg);
  });
  return { src: URL.createObjectURL(jpeg), b64: dataUrl.slice(dataUrl.indexOf(",") + 1), w, h };
}

let nextId = 1;
const newPhoto = (source) => ({ id: nextId++, source, status: "loading", error: "", advice: null, renders: {}, active: 0 });

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [listing, setListing] = useState(null); // { url, title }
  const [photos, setPhotos] = useState([]);
  const [selected, setSelected] = useState(null);
  const [style, setStyle] = useState(() => store.get(STYLE_KEY) || "designer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [passPrompt, setPassPrompt] = useState(null); // { retry, resolve }
  const live = useRef({ photos: [], style, title: "", run: 0 });
  live.current.photos = photos;
  live.current.style = style;
  live.current.title = listing?.title || "";

  const patch = useCallback((id, change) => {
    setPhotos((list) => list.map((p) => (p.id === id ? { ...p, ...(typeof change === "function" ? change(p) : change) } : p)));
  }, []);

  useEffect(() => {
    let pending = null; // one dialog serves every request that is waiting for the passcode
    askPasscode = (retry) => (pending ??= new Promise((resolve) => setPassPrompt({ retry, resolve })).finally(() => { pending = null; }));
  }, []);

  const visualise = useCallback((id, index) => {
    const photo = live.current.photos.find((p) => p.id === id);
    const idea = photo?.advice?.ideas[index];
    if (!idea) return;
    const state = photo.renders[index]?.status;
    if (state === "working" || state === "done") return;
    const run = live.current.run;
    const setRender = (r) => patch(id, (p) => ({ renders: { ...p.renders, [index]: r } }));
    setRender({ status: "working" });
    renderQueue(async () => {
      const res = await api("render", { body: { image: photo.b64, prompt: idea.render_prompt } });
      const { image, type } = await res.json();
      const blob = await (await fetch(`data:${type};base64,${image}`)).blob();
      return URL.createObjectURL(blob);
    }).then(
      (src) => run === live.current.run && setRender({ status: "done", src }),
      (err) => run === live.current.run && setRender({ status: "error", error: err.message }),
    );
  }, [patch]);

  const analyse = useCallback((id, { thenVisualise = false } = {}) => {
    const photo = live.current.photos.find((p) => p.id === id);
    if (!photo?.b64 || photo.status === "analysing") return;
    const run = live.current.run;
    patch(id, { status: "analysing", error: "", advice: null, renders: {}, active: 0 });
    analyseQueue(async () => {
      const res = await api("analyze", { body: { image: photo.b64, style: live.current.style, title: live.current.title } });
      return res.json();
    }).then(
      (advice) => {
        if (run !== live.current.run) return;
        patch(id, { status: "ready", advice });
        // The live list is one render behind the patch above; wait a tick so visualise() sees the advice.
        if (thenVisualise && advice.usable && advice.ideas.length) setTimeout(() => visualise(id, 0), 0);
      },
      (err) => run === live.current.run && patch(id, { status: "failed", error: err.message }),
    );
  }, [patch, visualise]);

  // Load a set of photos (remote listing URLs or dropped files), then assess them without being asked.
  const start = useCallback((info, sources) => {
    live.current.photos.forEach((p) => { p.src && URL.revokeObjectURL(p.src); Object.values(p.renders).forEach((r) => r?.src && URL.revokeObjectURL(r.src)); });
    const run = ++live.current.run;
    const list = sources.map(newPhoto);
    live.current.photos = list;
    setListing(info);
    setPhotos(list);
    setSelected(list[0]?.id ?? null);
    setError("");
    list.forEach((photo, i) => {
      loadQueue(async () => {
        const blob = photo.source instanceof Blob ? photo.source : await (await api("img", { query: { u: photo.source } })).blob();
        return prepare(blob);
      }).then(
        (img) => {
          if (run !== live.current.run) return URL.revokeObjectURL(img.src);
          patch(photo.id, { ...img, status: "idle" });
          // The first photo also gets its top idea visualised, so one action ends in a before-and-after.
          if (i < AUTO_ANALYSE) setTimeout(() => run === live.current.run && analyse(photo.id, { thenVisualise: i === 0 }), 0);
        },
        (err) => run === live.current.run && patch(photo.id, { status: "failed", error: err.message }),
      );
    });
  }, [patch, analyse]);

  const fetchListing = useCallback(async (url) => {
    setBusy(true);
    setError("");
    try {
      const data = await (await api("listing", { body: { url } })).json();
      start({ url: data.url, title: data.title }, data.images);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [start]);

  const addFiles = useCallback((files) => {
    const images = [...files].filter((f) => f.type.startsWith("image/")).slice(0, 40);
    if (images.length) start({ url: "", title: images.length === 1 ? images[0].name : `${images.length} photos` }, images);
  }, [start]);

  // Arriving from the bookmarklet: the listing is in the URL fragment.
  useEffect(() => {
    const handoff = decodeHandoff(location.hash);
    if (!handoff) return;
    history.replaceState(null, "", location.pathname);
    start({ url: handoff.url, title: handoff.title }, handoff.images);
  }, [start]);

  useEffect(() => {
    const onPaste = (e) => {
      if (e.target.closest?.("input, textarea")) return;
      if (e.clipboardData?.files?.length) addFiles(e.clipboardData.files);
    };
    const onDrop = (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); };
    const onOver = (e) => e.preventDefault();
    window.addEventListener("paste", onPaste);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onOver);
    return () => { window.removeEventListener("paste", onPaste); window.removeEventListener("drop", onDrop); window.removeEventListener("dragover", onOver); };
  }, [addFiles]);

  const select = (id) => {
    setSelected(id);
    const photo = photos.find((p) => p.id === id);
    if (photo?.status === "idle") analyse(id);
  };

  const changeStyle = (value) => {
    setStyle(value);
    store.set(STYLE_KEY, value);
    live.current.style = value;
    photos.forEach((p) => (p.status === "ready" || p.status === "failed") && p.b64 && analyse(p.id));
  };

  const visualiseAll = () => photos.forEach((p) => p.advice?.usable && p.advice.ideas.length && visualise(p.id, 0));

  const current = photos.find((p) => p.id === selected);
  const pendingTop = photos.filter((p) => p.advice?.usable && p.advice.ideas.length && !p.renders[0]).length;

  return (
    <div class="ri-app">
      <header class="ri-header">
        <a class="ri-brand" href="/">Fasanya</a>
        <span class="ri-product">Reimagine</span>
        {listing && <button class="ri-link" onClick={() => { live.current.run++; setListing(null); setPhotos([]); setSelected(null); }}>New listing</button>}
      </header>

      {!listing ? (
        <Intake busy={busy} error={error} onUrl={fetchListing} onFiles={addFiles} />
      ) : (
        <main class="ri-work">
          <div class="ri-bar">
            <div class="ri-listing">
              <h1>{listing.title || "Your photos"}</h1>
              {listing.url && <a href={listing.url} target="_blank" rel="noopener noreferrer">View listing</a>}
            </div>
            <label class="ri-style">
              <span>Direction</span>
              <select value={style} onChange={(e) => changeStyle(e.target.value)}>
                {STYLES.map(([v, l]) => <option value={v}>{l}</option>)}
              </select>
            </label>
            <button class="ri-btn ri-btn-quiet" disabled={!pendingTop} onClick={visualiseAll}>
              {pendingTop ? `Visualise top idea for ${pendingTop} more` : "Top ideas visualised"}
            </button>
          </div>

          {current && <Detail photo={current} onIdea={(i) => { patch(current.id, { active: i }); visualise(current.id, i); }} onRetry={() => analyse(current.id)} onRetryRender={(i) => { patch(current.id, (p) => ({ renders: { ...p.renders, [i]: undefined } })); setTimeout(() => visualise(current.id, i), 0); }} />}

          <ul class="ri-strip" aria-label="Listing photos">
            {photos.map((p, i) => (
              <li>
                <button class={"ri-thumb" + (p.id === selected ? " is-on" : "")} onClick={() => select(p.id)} aria-pressed={p.id === selected} aria-label={`Photo ${i + 1}${p.advice ? ": " + p.advice.label : ""}`}>
                  {p.src ? <img src={p.renders[0]?.src || p.src} alt="" loading="lazy" /> : <span class="ri-thumb-empty" />}
                  <span class={"ri-dot is-" + thumbState(p)} />
                  {p.advice && <span class="ri-thumb-label">{p.advice.label}</span>}
                </button>
              </li>
            ))}
          </ul>
        </main>
      )}

      {passPrompt && <Passcode retry={passPrompt.retry} onSubmit={(v) => { passPrompt.resolve(v); setPassPrompt(null); }} />}
    </div>
  );
}

const thumbState = (p) =>
  p.status === "failed" ? "bad" : p.status === "loading" || p.status === "analysing" ? "busy" : p.advice ? (p.advice.usable ? (p.renders[0]?.status === "done" ? "done" : "ready") : "skip") : "idle";

// ─── Intake ───────────────────────────────────────────────────────────────────
function Intake({ busy, error, onUrl, onFiles }) {
  const [url, setUrl] = useState("");
  const [local, setLocal] = useState("");
  const file = useRef();
  const marklet = "javascript:" + encodeURIComponent(__BOOKMARKLET__.replace("__ORIGIN__", location.origin));
  const link = useRef();
  // Set the href directly: frameworks refuse to render javascript: URLs, but this one is ours.
  useEffect(() => { link.current?.setAttribute("href", marklet); }, [marklet]);

  const submit = (e) => {
    e.preventDefault();
    const value = url.trim();
    if (!isListingUrl(value)) return setLocal("Paste a Rightmove or Zoopla property link, starting with https://");
    setLocal("");
    onUrl(value);
  };

  return (
    <main class="ri-intake">
      <h1>See what a property <em>could be</em></h1>
      <p class="ri-lede">Point it at a listing. A designer's eye goes over every photo, proposes what to change and shows you the result.</p>

      <section class="ri-card">
        <h2><span class="ri-step">Fastest</span> One click from any listing</h2>
        <p>Drag this button to your bookmarks bar once. Then, on any Rightmove or Zoopla property page, click it.</p>
        <a ref={link} class="ri-marklet" onClick={(e) => { e.preventDefault(); setLocal("Drag that button to your bookmarks bar, then click it while viewing a listing."); }}>Reimagine</a>
      </section>

      <section class="ri-card">
        <h2>Or paste a link</h2>
        <form class="ri-form" onSubmit={submit}>
          <input type="url" inputMode="url" placeholder="https://www.rightmove.co.uk/properties/…" aria-label="Listing link" value={url} onInput={(e) => setUrl(e.target.value)} />
          <button class="ri-btn" disabled={busy}>{busy ? "Fetching…" : "Reimagine"}</button>
        </form>
        <p class="ri-fine">Property sites often block links fetched this way. If it fails, the bookmark button or your own photos always work.</p>
      </section>

      <section class="ri-card ri-drop" onClick={() => file.current.click()}>
        <h2>Or use your own photos</h2>
        <p>Drop, paste or <button class="ri-link" type="button">choose photos</button> of any room or exterior.</p>
        <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} onClick={(e) => e.stopPropagation()} />
      </section>

      {(error || local) && <p class="ri-error" role="alert">{error || local}</p>}
    </main>
  );
}

// ─── Detail ───────────────────────────────────────────────────────────────────
function Detail({ photo, onIdea, onRetry, onRetryRender }) {
  const { advice } = photo;
  const idea = advice?.ideas[photo.active];
  const rendered = photo.renders[photo.active];

  return (
    <section class="ri-detail">
      <div class="ri-stage">
        {!photo.src ? (
          <div class="ri-placeholder">{photo.status === "failed" ? photo.error : "Loading photo…"}</div>
        ) : rendered?.status === "done" ? (
          <Compare before={photo.src} after={rendered.src} ratio={photo.w / photo.h} name={idea?.title} />
        ) : (
          <div class="ri-single" style={{ aspectRatio: `${photo.w} / ${photo.h}` }}>
            <img src={photo.src} alt="Listing photo as it is today" />
            {rendered?.status === "working" && <div class="ri-veil"><span class="ri-spin" />Painting the after…</div>}
            {rendered?.status === "error" && <div class="ri-veil"><span>{rendered.error}</span><button class="ri-btn" onClick={() => onRetryRender(photo.active)}>Try again</button></div>}
          </div>
        )}
      </div>

      <div class="ri-notes">
        {(photo.status === "loading" || photo.status === "analysing" || photo.status === "idle") && <p class="ri-thinking"><span class="ri-spin" />{photo.status === "analysing" ? "The designer is looking at this one…" : "Getting ready…"}</p>}
        {photo.status === "failed" && photo.src && <p class="ri-error" role="alert">{photo.error} <button class="ri-link" onClick={onRetry}>Try again</button></p>}
        {advice && (
          <>
            <h2>{advice.label}</h2>
            <p class="ri-verdict">{advice.verdict}</p>
            {!advice.usable ? null : (
              <>
                <div class="ri-ideas" role="tablist" aria-label="Ideas">
                  {advice.ideas.map((it, i) => (
                    <button role="tab" aria-selected={i === photo.active} class={"ri-idea" + (i === photo.active ? " is-on" : "")} onClick={() => onIdea(i)}>
                      <span class="ri-level">{LEVELS[it.level]}{i === 0 && " · top pick"}</span>
                      <strong>{it.title}</strong>
                      <span class="ri-cost">{gbp(it.cost_low_gbp)} to {gbp(it.cost_high_gbp)}</span>
                    </button>
                  ))}
                </div>
                {idea && (
                  <div class="ri-scheme" role="tabpanel">
                    <p class="ri-summary">{idea.summary}</p>
                    <ul>{idea.changes.map((c) => <li>{c}</li>)}</ul>
                    <p><span class="ri-tag">Why it works</span>{idea.why}</p>
                    <p class="ri-meta">
                      <span><span class="ri-tag">Guide cost</span>{gbp(idea.cost_low_gbp)} to {gbp(idea.cost_high_gbp)}</span>
                      <span><span class="ri-tag">Disruption</span>{idea.disruption}</span>
                    </p>
                    {idea.permissions && <p><span class="ri-tag">Permissions</span>{idea.permissions}</p>}
                  </div>
                )}
                {(advice.strengths.length > 0 || advice.issues.length > 0) && (
                  <details class="ri-read">
                    <summary>The designer's read of the space today</summary>
                    {advice.strengths.length > 0 && <><h3>Worth keeping</h3><ul>{advice.strengths.map((s) => <li>{s}</li>)}</ul></>}
                    {advice.issues.length > 0 && <><h3>Holding it back</h3><ul>{advice.issues.map((s) => <li>{s}</li>)}</ul></>}
                  </details>
                )}
                <p class="ri-fine">Images are AI visualisations and costs are rough guides, not quotes. Structure, services and permissions need checking by a professional before you commit.</p>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Compare({ before, after, ratio, name }) {
  const [pos, setPos] = useState(50);
  return (
    <div class="ri-compare" style={{ aspectRatio: String(ratio) }}>
      <img src={after} alt={`After: ${name || "the idea visualised"}`} />
      <img class="ri-before" src={before} alt="Before: the listing photo" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <span class="ri-divider" style={{ left: pos + "%" }} aria-hidden="true" />
      <span class="ri-flag ri-flag-l" aria-hidden="true">Before</span>
      <span class="ri-flag ri-flag-r" aria-hidden="true">After</span>
      <input type="range" min="0" max="100" value={pos} aria-label="Before and after slider" onInput={(e) => setPos(Number(e.target.value))} />
      <a class="ri-save" href={after} download={`reimagine-${(name || "after").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`}>Save image</a>
    </div>
  );
}

function Passcode({ retry, onSubmit }) {
  const [value, setValue] = useState("");
  return (
    <div class="ri-modal" role="dialog" aria-modal="true" aria-labelledby="ri-pass-title">
      <form class="ri-card" onSubmit={(e) => { e.preventDefault(); value && onSubmit(value); }}>
        <h2 id="ri-pass-title">Passcode</h2>
        <p>{retry ? "That passcode wasn't right. Try again." : "Reimagine is private for now. Enter the passcode to continue."}</p>
        <input type="password" autoFocus autocomplete="current-password" aria-label="Passcode" value={value} onInput={(e) => setValue(e.target.value)} />
        <button class="ri-btn">Continue</button>
      </form>
    </div>
  );
}

render(<App />, document.getElementById("root"));
