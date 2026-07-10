"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ─── TYPES ────────────────────────────────────────────────────
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
type AuthType = "bearer" | "basic" | "apikey" | "none";
type BodyType = "none" | "json" | "form" | "raw";
type ResTab = "body" | "headers";

interface KVRow { id: number; key: string; val: string; on: boolean; }
interface HistEntry { method: Method; url: string; status?: number; ms: number; ts: number; }
interface SavedReq {
  name: string;
  method: Method;
  url: string;
  ts: number;
  params?: KVRow[];
  authType?: AuthType;
  bearerTok?: string;
  basicUser?: string;
  basicPass?: string;
  akName?: string;
  akVal?: string;
  akIn?: "header" | "query";
  hdrs?: KVRow[];
  bodyType?: BodyType;
  jsonBody?: string;
  formBody?: KVRow[];
  rawBody?: string;
  rawCT?: string;
}
interface Collections { [col: string]: SavedReq[]; }
interface SavedToken { name: string; val: string; }

// ─── HELPERS ──────────────────────────────────────────────────
let _kvId = 0;
const mkKV = (key = "", val = "", on = true): KVRow => ({ id: ++_kvId, key, val, on });
const escH = (s: string) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const fmtBytes = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`;
const shortURL = (u: string) => { try { const p = new URL(u); return p.pathname + (p.search ? "?…" : ""); } catch { return u; } };
const stClass = (s: number) => s >= 500 ? "s5" : s >= 400 ? "s4" : s >= 300 ? "s3" : "s2";
const stColor = (s?: number) => !s ? "var(--t3)" : s >= 500 ? "var(--rd)" : s >= 400 ? "#fb923c" : s >= 300 ? "var(--bl)" : "var(--gr)";
const METHOD_COLORS: Record<string, string> = {
  GET:"#10b981", POST:"#f59e0b", PUT:"#60a5fa",
  PATCH:"#a78bfa", DELETE:"#ef4444", HEAD:"#8b8ba7", OPTIONS:"#8b8ba7",
};

function hiliteJSON(s: string): string {
  return escH(s).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (m) => {
      let c = "jn";
      if (/^"/.test(m)) c = /:$/.test(m) ? "jk" : "js";
      else if (/true|false/.test(m)) c = "jb";
      else if (/null/.test(m)) c = "jnull";
      return `<span class="${c}">${m}</span>`;
    }
  );
}

const LS = {
  get: (k: string, def: unknown) => {
    if (typeof window === "undefined") return def;
    try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? def; } catch { return def; }
  },
  set: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k: string) => { try { localStorage.removeItem(k); } catch {} },
};

// ─── KV EDITOR COMPONENT ──────────────────────────────────────
function KVEditor({ rows, onChange, placeholder = ["Key", "Value"] }: {
  rows: KVRow[];
  onChange: (rows: KVRow[]) => void;
  placeholder?: [string, string];
}) {
  const upd = (id: number, field: keyof KVRow, val: unknown) =>
    onChange(rows.map(r => r.id === id ? { ...r, [field]: val } : r));
  const rm = (id: number) => onChange(rows.filter(r => r.id !== id));

  return (
    <div className="kv-ed">
      {rows.map(r => (
        <div className="kv-row" key={r.id}>
          <input className={`kv-i${!r.on ? " dim" : ""}`} placeholder={placeholder[0]}
            value={r.key} onChange={e => upd(r.id, "key", e.target.value)} />
          <input className={`kv-i${!r.on ? " dim" : ""}`} placeholder={placeholder[1]}
            value={r.val} onChange={e => upd(r.id, "val", e.target.value)} />
          <input type="checkbox" className="kv-chk" checked={r.on}
            onChange={e => upd(r.id, "on", e.target.checked)} />
          <button className="kv-rm" onClick={() => rm(r.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────
export default function Home() {
  // Sidebar
  const [sbOpen, setSbOpen] = useState(false);

  // Tokens
  const [tokenName, setTokenName] = useState("");
  const [tokenVal, setTokenVal] = useState("");
  const [savedTokens, setSavedTokens] = useState<SavedToken[]>([]);

  // Request
  const [method, setMethod] = useState<Method>("GET");
  const [url, setUrl] = useState("");
  const [activeTab, setActiveTab] = useState("params");
  const [params, setParams] = useState<KVRow[]>([mkKV()]);
  const [authType, setAuthType] = useState<AuthType>("bearer");
  const [bearerTok, setBearerTok] = useState("");
  const [basicUser, setBasicUser] = useState("");
  const [basicPass, setBasicPass] = useState("");
  const [akName, setAkName] = useState("");
  const [akVal, setAkVal] = useState("");
  const [akIn, setAkIn] = useState<"header"|"query">("header");
  const [hdrs, setHdrs] = useState<KVRow[]>([mkKV()]);
  const [bodyType, setBodyType] = useState<BodyType>("none");
  const [jsonBody, setJsonBody] = useState("");
  const [chatView, setChatView] = useState(false);
  const [formBody, setFormBody] = useState<KVRow[]>([mkKV()]);
  const [rawBody, setRawBody] = useState("");
  const [rawCT, setRawCT] = useState("text/plain");

  // Response
  const [loading, setLoading] = useState(false);
  const [resTab, setResTab] = useState<ResTab>("body");
  const [status, setStatus] = useState<number | null>(null);
  const [statusText, setStatusText] = useState("");
  const [resTime, setResTime] = useState("");
  const [resSize, setResSize] = useState("");
  const [resBody, setResBody] = useState<string | null>(null);
  const [resHdrs, setResHdrs] = useState<Record<string, string> | null>(null);
  const [latchDec, setLatchDec] = useState<string | null>(null);
  const [latchFlt, setLatchFlt] = useState("");
  const [latchRsn, setLatchRsn] = useState("");
  const [resErr, setResErr] = useState<string | null>(null);

  // History & Collections
  const [history, setHistory] = useState<HistEntry[]>([]);
  const [collections, setCollections] = useState<Collections>({});

  // Save modal
  const [saveModal, setSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveCol, setSaveCol] = useState("");

  // Toast
  const [toastMsg, setToastMsg] = useState("");
  const [toastType, setToastType] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Init from localStorage ──
  useEffect(() => {
    const ts = LS.get("latch_tokens", []) as SavedToken[];
    setSavedTokens(ts);
    setHistory(LS.get("latch_history", []) as HistEntry[]);
    setCollections(LS.get("latch_cols", {}) as Collections);
  }, []);

  // ── Toast ──
  const toast = useCallback((msg: string, type = "") => {
    setToastMsg(msg); setToastType(type); setToastVisible(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), 2500);
  }, []);

  // ── Save token ──
  const saveToken = () => {
    const name = tokenName.trim() || "Default";
    const val = tokenVal.trim();
    if (!val) { toast("Please enter a token value", "err"); return; }

    const updated = [...savedTokens.filter(t => t.name !== name), { name, val }];
    setSavedTokens(updated);
    LS.set("latch_tokens", updated);
    setTokenName("");
    setTokenVal("");
    toast(`Token "${name}" saved!`, "ok");
  };

  const deleteToken = (name: string) => {
    const updated = savedTokens.filter(t => t.name !== name);
    setSavedTokens(updated);
    LS.set("latch_tokens", updated);
    toast(`Token "${name}" deleted`);
  };

  // ── Active KV helpers ──
  const activeKV = (rows: KVRow[]) => rows.filter(r => r.on && r.key.trim()).map(r => [r.key.trim(), r.val.trim()] as [string, string]);
  const paramCount = activeKV(params).length;
  const hdrCount = activeKV(hdrs).length;

  // ── Build & send request ──
  const sendRequest = async (bodyOverride?: string) => {
    if (loading) return;
    let reqUrl = url.trim();
    if (!reqUrl) { toast("Please enter a URL", "err"); return; }
    if (!/^https?:\/\//i.test(reqUrl)) reqUrl = "https://" + reqUrl;

    const qParams = activeKV(params);
    if (qParams.length) {
      const sep = reqUrl.includes("?") ? "&" : "?";
      reqUrl += sep + qParams.map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    }

    const headers: Record<string, string> = {};
    activeKV(hdrs).forEach(([k,v]) => { headers[k] = v; });

    if (authType === "bearer" && bearerTok.trim()) headers["Authorization"] = `Bearer ${bearerTok.trim()}`;
    else if (authType === "basic" && basicUser) headers["Authorization"] = `Basic ${btoa(`${basicUser}:${basicPass}`)}`;
    else if (authType === "apikey" && akName.trim()) {
      if (akIn === "header") headers[akName.trim()] = akVal;
      else { const sep = reqUrl.includes("?") ? "&" : "?"; reqUrl += `${sep}${encodeURIComponent(akName.trim())}=${encodeURIComponent(akVal)}`; }
    }

    let body: string | undefined = bodyOverride;
    if (body === undefined && method !== "GET" && method !== "HEAD") {
      if (bodyType === "json" && jsonBody.trim()) {
        body = jsonBody.trim();
        if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
      } else if (bodyType === "form") {
        const fd = activeKV(formBody);
        if (fd.length) {
          const f = new URLSearchParams(); fd.forEach(([k,v]) => f.append(k,v));
          body = f.toString();
          if (!headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";
        }
      } else if (bodyType === "raw" && rawBody.trim()) {
        body = rawBody.trim();
        if (!headers["Content-Type"]) headers["Content-Type"] = rawCT;
      }
    }

    setLoading(true);
    setStatus(null); setResBody(null); setResHdrs(null);
    setResErr(null); setLatchDec(null); setResTime(""); setResSize("");
    const t0 = performance.now();

    try {
      const proxyRes = await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: reqUrl, method, headers, body }),
      });
      const ms = Math.round(performance.now() - t0);
      const data = await proxyRes.json();

      if (!proxyRes.ok || data.error) {
        throw new Error(data.error || `Proxy returned status ${proxyRes.status}`);
      }

      const text = data.body || "";
      const size = new Blob([text]).size;
      const rHdrs = data.headers || {};

      setStatus(data.status); setStatusText(data.statusText || "");
      setResTime(`${ms}ms`); setResSize(fmtBytes(size));
      setResBody(text); setResHdrs(rHdrs);

      // Auto-append assistant response or Latch error to Chat completion messages
      try {
        const respObj = JSON.parse(text);
        const choice = respObj.choices?.[0];
        if (choice && choice.message) {
          const reqObj = JSON.parse(body || "{}");
          if (reqObj && Array.isArray(reqObj.messages)) {
            reqObj.messages.push(choice.message);
            setJsonBody(JSON.stringify(reqObj, null, 2));
          }
        } else if (respObj.error) {
          const reqObj = JSON.parse(body || "{}");
          if (reqObj && Array.isArray(reqObj.messages)) {
            const errContent = `❌ [Policy Blocked]\nFilter: ${respObj.deniedBy || "N/A"}\nReason: ${respObj.reason || respObj.error}`;
            reqObj.messages.push({ role: "assistant", content: errContent });
            setJsonBody(JSON.stringify(reqObj, null, 2));
          }
        }
      } catch {}

      const dec = rHdrs["x-latch-decision"];
      if (dec) {
        setLatchDec(dec);
        setLatchFlt(rHdrs["x-latch-filter"] ? `via ${rHdrs["x-latch-filter"]}` : "");
        setLatchRsn(rHdrs["x-latch-reason"] || (rHdrs["x-latch-eval-ms"] ? `${rHdrs["x-latch-eval-ms"]}ms eval` : ""));
      }

      const newHist: HistEntry = { method, url: reqUrl, status: data.status, ms, ts: Date.now() };
      const updated = [newHist, ...history].slice(0, 30);
      setHistory(updated); LS.set("latch_history", updated);

    } catch (err: unknown) {
      const ms = Math.round(performance.now() - t0);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setResErr(msg); setResTime(`${ms}ms`);
    } finally {
      setLoading(false);
    }
  };

  const copyResponse = async () => {
    if (!resBody) return;
    try { await navigator.clipboard.writeText(resBody); toast("Copied!", "ok"); }
    catch { toast("Copy failed", "err"); }
  };

  const formatJSON = () => {
    try { setJsonBody(JSON.stringify(JSON.parse(jsonBody), null, 2)); }
    catch { toast("Invalid JSON", "err"); }
  };

  const doSave = () => {
    if (!saveName.trim()) { toast("Enter a request name", "err"); return; }
    if (!url.trim()) { toast("Enter a URL first", "err"); return; }
    const col = saveCol.trim() || "Default";
    const updated = { ...collections };
    if (!updated[col]) updated[col] = [];
    
    updated[col] = [
      ...updated[col],
      {
        name: saveName.trim(),
        method,
        url,
        ts: Date.now(),
        params,
        authType,
        bearerTok,
        basicUser,
        basicPass,
        akName,
        akVal,
        akIn,
        hdrs,
        bodyType,
        jsonBody,
        formBody,
        rawBody,
        rawCT
      }
    ];
    setCollections(updated); LS.set("latch_cols", updated);
    setSaveModal(false); setSaveName(""); setSaveCol("");
    toast("Saved!", "ok");
  };

  const loadHist = (e: HistEntry) => { setMethod(e.method as Method); setUrl(e.url); setSbOpen(false); };

  const loadCol = (r: SavedReq) => {
    setMethod(r.method);
    setUrl(r.url);
    if (r.params) setParams(r.params);
    if (r.authType) setAuthType(r.authType);
    if (r.bearerTok !== undefined) setBearerTok(r.bearerTok);
    if (r.basicUser !== undefined) setBasicUser(r.basicUser);
    if (r.basicPass !== undefined) setBasicPass(r.basicPass);
    if (r.akName !== undefined) setAkName(r.akName);
    if (r.akVal !== undefined) setAkVal(r.akVal);
    if (r.akIn) setAkIn(r.akIn);
    if (r.hdrs) setHdrs(r.hdrs);
    if (r.bodyType) setBodyType(r.bodyType);
    if (r.jsonBody !== undefined) setJsonBody(r.jsonBody);
    if (r.formBody) setFormBody(r.formBody);
    if (r.rawBody !== undefined) setRawBody(r.rawBody);
    if (r.rawCT !== undefined) setRawCT(r.rawCT);
    setSbOpen(false);
    toast(`Loaded "${r.name}"`, "ok");
  };

  const clearHistory = () => { setHistory([]); LS.del("latch_history"); toast("History cleared"); };

  const deleteReq = (col: string, index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = { ...collections };
    updated[col] = updated[col].filter((_, i) => i !== index);
    if (updated[col].length === 0) {
      delete updated[col];
    }
    setCollections(updated);
    LS.set("latch_cols", updated);
    toast("Request template deleted");
  };

  const deleteCol = (col: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = { ...collections };
    delete updated[col];
    setCollections(updated);
    LS.set("latch_cols", updated);
    toast(`Collection "${col}" deleted`);
  };

  const addComHdr = (k: string, v: string) => { setActiveTab("headers"); setHdrs(prev => [...prev, mkKV(k, v)]); };

  // ── Render response body HTML ──
  const renderBodyHTML = () => {
    if (!resBody) return "";
    try {
      const pretty = JSON.stringify(JSON.parse(resBody), null, 2);
      return `<pre class="jview">${hiliteJSON(pretty)}</pre>`;
    } catch {
      return `<pre class="jview">${escH(resBody)}</pre>`;
    }
  };

  const renderHeadersHTML = () => {
    if (!resHdrs) return "";
    const lk = Object.keys(resHdrs).filter(k => k.startsWith("x-latch"));
    const ok = Object.keys(resHdrs).filter(k => !k.startsWith("x-latch"));
    let html = `<table class="rht">`;
    if (lk.length) {
      html += `<tr><td colspan="2" style="color:var(--ac);font-size:10px;font-weight:700;padding:7px 8px 3px;letter-spacing:.06em">— LATCH HEADERS</td></tr>`;
      lk.forEach(k => { html += `<tr class="rht-lt"><td>${escH(k)}</td><td>${escH(resHdrs![k])}</td></tr>`; });
      if (ok.length) html += `<tr><td colspan="2" style="color:var(--t3);font-size:10px;font-weight:700;padding:7px 8px 3px;letter-spacing:.06em">— OTHER HEADERS</td></tr>`;
    }
    ok.forEach(k => { html += `<tr><td>${escH(k)}</td><td>${escH(resHdrs![k])}</td></tr>`; });
    return html + `</table>`;
  };

  const isCORS = (msg: string) => /fetch|network|failed/i.test(msg);

  return (
    <div className="app">
      {/* ── HEADER ── */}
      <header>
        <div className="brand">
          <div className="brand-ico">🔒</div>
          <div className="brand-name">Latch Tester</div>
          <span className="brand-tag">Mobile</span>
        </div>
        <div className="hdr-btns">
          <button className="ico-btn" onClick={() => setSaveModal(true)} title="Save Request">💾</button>
          <button className="ico-btn" onClick={() => setSbOpen(v => !v)} title="Toggle Sidebar">☰</button>
        </div>
      </header>

      {/* ── LOADING BAR ── */}
      <div className={`lbar${loading ? " on" : ""}`} />

      <div className="main">
        {/* ── SIDEBAR OVERLAY ── */}
        {sbOpen && <div className="sb-ov on" onClick={() => setSbOpen(false)} />}

        {/* ── SIDEBAR ── */}
        <aside className={`sidebar${sbOpen ? " open" : ""}`}>
          <div className="tok-box">
            <div className="tok-lbl">🔑 Latch Tokens</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <input type="text" className="tok-in" placeholder="Token Name (e.g. GROQ)"
                value={tokenName} onChange={e => setTokenName(e.target.value)}
                style={{ fontSize: "11px", fontFamily: "var(--fn)" }} />
              <div className="tok-row">
                <input type="password" className="tok-in" placeholder="lat_..."
                  value={tokenVal} onChange={e => setTokenVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveToken(); }} />
                <button className="tok-sv" onClick={saveToken}>Save</button>
              </div>
            </div>
            {savedTokens.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4, maxHeight: 110, overflowY: "auto" }}>
                {savedTokens.map(t => (
                  <div key={t.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg2)", padding: "4px 6px", borderRadius: "var(--rs)", border: "1px solid var(--br)" }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: "var(--t2)" }} title={t.val}>🔑 {t.name}</span>
                    <button onClick={() => deleteToken(t.name)} style={{ background: "none", border: "none", color: "var(--t3)", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="sb-in">
            {/* Collections */}
            <div className="sb-h">Collections</div>
            {Object.keys(collections).length === 0
              ? <div className="sb-empty">No collections yet.<br />Save a request to start.</div>
              : Object.entries(collections).map(([col, reqs]) => (
                <div key={col} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)", paddingBottom: 6 }}>
                  <div className="col-n" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>📁 {col} <span style={{ color: "var(--t3)" }}>({reqs.length})</span></span>
                    <button onClick={(e) => deleteCol(col, e)} style={{ background: "none", border: "none", color: "var(--t3)", cursor: "pointer", fontSize: 14, padding: "0 6px" }} title="Delete Collection">×</button>
                  </div>
                  {reqs.map((r, i) => (
                    <div key={i} className="sb-item" style={{ paddingLeft: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }} onClick={() => loadCol(r)}>
                      <span className={`mb ${r.method}`} style={{ marginRight: 4 }}>{r.method}</span>
                      <span className="sb-txt" style={{ flex: 1 }}>{r.name}</span>
                      <button onClick={(e) => deleteReq(col, i, e)} style={{ background: "none", border: "none", color: "var(--t3)", cursor: "pointer", fontSize: 13, padding: "0 6px" }} title="Delete Request">×</button>
                    </div>
                  ))}
                </div>
              ))
            }

            <div className="sb-div" />

            {/* History */}
            <div className="sb-h">
              History
              <button className="sb-hb" style={{ fontSize: 12, color: "var(--t3)" }} onClick={clearHistory}>✕</button>
            </div>
            {history.length === 0
              ? <div className="sb-empty">No history yet.</div>
              : history.map((e, i) => (
                <div key={i} className="sb-item" onClick={() => loadHist(e)}>
                  <span className={`mb ${e.method}`}>{e.method}</span>
                  <span className="sb-txt">{shortURL(e.url)}</span>
                  <span className="sb-st" style={{ color: stColor(e.status) }}>{e.status}</span>
                </div>
              ))
            }
          </div>
        </aside>

        {/* ── CONTENT ── */}
        <div className="content">
          <div className="split">
            {/* ── REQUEST PANE ── */}
            <div className="req-pane">
              <div className="rqb">
                {/* URL Bar */}
                <div className="url-bar">
                  <select className="msel" value={method}
                    style={{ color: METHOD_COLORS[method] }}
                    onChange={e => setMethod(e.target.value as Method)}>
                    {["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"].map(m => (
                      <option key={m} value={m} style={{ color: METHOD_COLORS[m] }}>{m}</option>
                    ))}
                  </select>
                  <input type="url" className="url-in" placeholder="https://api.example.com/v1/endpoint"
                    autoComplete="off" spellCheck={false}
                    value={url} onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") sendRequest(); }} />
                  <button className={`send-btn${loading ? " loading" : ""}`} onClick={sendRequest}>
                    <span className={loading ? "spin" : ""}>{loading ? "⟳" : "▶"}</span>
                    <span>{loading ? "Sending..." : "Send"}</span>
                  </button>
                </div>

                {/* Tab Bar */}
                <div className="tab-bar">
                  {[
                    { id:"params", label:"Params", badge: paramCount },
                    { id:"auth",   label:"Auth",   badge: 0 },
                    { id:"headers",label:"Headers",badge: hdrCount },
                    { id:"body",   label:"Body",   badge: 0 },
                  ].map(t => (
                    <button key={t.id} className={`tb${activeTab===t.id?" on":""}`} onClick={() => setActiveTab(t.id)}>
                      {t.label}
                      {t.badge > 0 && <span className="tbdg">{t.badge}</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── TAB PANELS ── */}
              <div className="tab-pnls">

                {/* PARAMS */}
                <div className={`tp${activeTab==="params"?" on":""}`} data-panel="params">
                  <KVEditor rows={params} onChange={setParams} placeholder={["Key","Value"]} />
                  <button className="add-row" onClick={() => setParams(p => [...p, mkKV()])}>+ Add Parameter</button>
                </div>

                {/* AUTH */}
                <div className={`tp${activeTab==="auth"?" on":""}`} data-panel="auth">
                  <div className="ag">
                    {(["bearer","basic","apikey","none"] as AuthType[]).map(a => (
                      <button key={a} className={`abtn${authType===a?" on":""}`} onClick={() => setAuthType(a)}>
                        {a === "bearer" ? "Bearer Token" : a === "basic" ? "Basic Auth" : a === "apikey" ? "API Key" : "No Auth"}
                      </button>
                    ))}
                  </div>

                  {authType === "bearer" && (
                    <div className="af">
                      {savedTokens.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 8 }}>
                          <div className="fl">Use Saved Token</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                            {savedTokens.map(t => {
                              const isCurrent = bearerTok === t.val;
                              return (
                                <button key={t.name} className="ch-pill"
                                  style={{
                                    borderColor: isCurrent ? "var(--ac)" : "var(--br)",
                                    color: isCurrent ? "var(--ac)" : "var(--t2)",
                                    background: isCurrent ? "var(--acg)" : "var(--bg3)",
                                  }}
                                  onClick={() => setBearerTok(t.val)}>
                                  🔑 {t.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="fl">Token</div>
                        <input className="fi" type="text" placeholder="lat_... or any bearer token"
                          value={bearerTok} onChange={e => setBearerTok(e.target.value)} />
                      </div>
                    </div>
                  )}
                  {authType === "basic" && (
                    <div className="af">
                      <div><div className="fl">Username</div><input className="fi" type="text" placeholder="Username" value={basicUser} onChange={e => setBasicUser(e.target.value)} /></div>
                      <div><div className="fl">Password</div><input className="fi" type="password" placeholder="Password" value={basicPass} onChange={e => setBasicPass(e.target.value)} /></div>
                    </div>
                  )}
                  {authType === "apikey" && (
                    <div className="af">
                      <div><div className="fl">Key Name</div><input className="fi" type="text" placeholder="e.g. X-API-Key" value={akName} onChange={e => setAkName(e.target.value)} /></div>
                      <div><div className="fl">Value</div><input className="fi" type="text" placeholder="Your key value" value={akVal} onChange={e => setAkVal(e.target.value)} /></div>
                      <div>
                        <div className="fl">Send As</div>
                        <div className="rr">
                          <label><input type="radio" name="akIn" value="header" checked={akIn==="header"} onChange={() => setAkIn("header")} /> Header</label>
                          <label><input type="radio" name="akIn" value="query" checked={akIn==="query"} onChange={() => setAkIn("query")} /> Query Param</label>
                        </div>
                      </div>
                    </div>
                  )}
                  {authType === "none" && <p style={{ fontSize: 12, color: "var(--t3)" }}>No authentication will be sent.</p>}
                </div>

                {/* HEADERS */}
                <div className={`tp${activeTab==="headers"?" on":""}`} data-panel="headers">
                  <KVEditor rows={hdrs} onChange={setHdrs} placeholder={["Header","Value"]} />
                  <button className="add-row" onClick={() => setHdrs(h => [...h, mkKV()])}>+ Add Header</button>
                  <div className="sl" style={{ marginTop: 14 }}>Quick Add</div>
                  <div className="ch-pills">
                    {[
                      ["Content-Type","application/json","Content-Type: JSON"],
                      ["Accept","application/json","Accept: JSON"],
                      ["X-Request-ID","","X-Request-ID"],
                      ["User-Agent","LatchTester/1.0","User-Agent"],
                      ["Cache-Control","no-cache","Cache-Control"],
                    ].map(([k,v,label]) => (
                      <span key={label} className="ch-pill" onClick={() => addComHdr(k, v)}>{label}</span>
                    ))}
                  </div>
                </div>

                {/* BODY */}
                <div className={`tp${activeTab==="body"?" on":""}`} data-panel="body">
                  <div className="btypes">
                    {(["none","json","form","raw"] as BodyType[]).map(b => (
                      <button key={b} className={`btb${bodyType===b?" on":""}`} onClick={() => setBodyType(b)}>
                        {b.charAt(0).toUpperCase() + b.slice(1)}
                      </button>
                    ))}
                  </div>
                  {bodyType === "none" && <p style={{ textAlign:"center", padding:"16px 0", fontSize:12, color:"var(--t3)" }}>No body will be sent.</p>}
                  {bodyType === "json" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", gap: 5 }}>
                          <button className={`fmtb ${!chatView ? "on" : ""}`} style={{ margin: 0, padding: "3px 8px" }} onClick={() => setChatView(false)}>JSON Raw</button>
                          <button className={`fmtb ${chatView ? "on" : ""}`} style={{ margin: 0, padding: "3px 8px" }} onClick={() => setChatView(true)}>Chat UI</button>
                        </div>
                        {!chatView && <button className="fmtb" style={{ margin: 0 }} onClick={formatJSON}>Format ✦</button>}
                      </div>
                      {!chatView ? (
                        <textarea className="bta" placeholder={'{"key": "value"}'} value={jsonBody} onChange={e => setJsonBody(e.target.value)} />
                      ) : (
                        <ChatUI jsonBody={jsonBody} onChange={setJsonBody} onSend={(newBody) => sendRequest(newBody)} />
                      )}
                    </div>
                  )}
                  {bodyType === "form" && (
                    <>
                      <KVEditor rows={formBody} onChange={setFormBody} placeholder={["Field","Value"]} />
                      <button className="add-row" onClick={() => setFormBody(f => [...f, mkKV()])}>+ Add Field</button>
                    </>
                  )}
                  {bodyType === "raw" && (
                    <>
                      <select className="msel" value={rawCT} onChange={e => setRawCT(e.target.value)}
                        style={{ fontFamily:"var(--fn)", fontSize:12, marginBottom:7, width:"auto" }}>
                        <option value="text/plain">Plain Text</option>
                        <option value="application/xml">XML</option>
                        <option value="text/html">HTML</option>
                      </select>
                      <textarea className="bta" placeholder="Raw body content..." value={rawBody} onChange={e => setRawBody(e.target.value)} />
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* ── RESPONSE PANE ── */}
            <div className="res-pane">
              {/* Response header */}
              <div className="res-hdr">
                <span className="res-ttl">Response</span>
                {status !== null && <span className={`stb ${stClass(status)}`}>{status} {statusText}</span>}
                <div className="rmeta">
                  {resTime && <span className="meta">{resTime}</span>}
                  {resSize && <span className="meta">{resSize}</span>}
                  {resBody && <button className="cpb" onClick={copyResponse}>Copy</button>}
                </div>
              </div>

              {/* Latch decision bar */}
              {latchDec && (
                <div className={`ltbar ${latchDec.toLowerCase()}`}>
                  <span className="ltbdg">LATCH</span>
                  <span className={`ltdec ${latchDec.toLowerCase()}`}>{latchDec.toUpperCase()}</span>
                  {latchFlt && <span className="ltflt">{latchFlt}</span>}
                  {latchRsn && <span className="ltrsn">{latchRsn}</span>}
                </div>
              )}

              {/* Response tabs */}
              <div className="res-btabs">
                <button className={`rbt${resTab==="body"?" on":""}`} onClick={() => setResTab("body")}>Body</button>
                <button className={`rbt${resTab==="headers"?" on":""}`} onClick={() => setResTab("headers")}>
                  Headers
                  {resHdrs && <span className="tbdg" style={{ marginLeft: 3 }}>{Object.keys(resHdrs).length}</span>}
                </button>
              </div>

              {/* Response content */}
              <div className="res-ct">
                {!status && !resErr && (
                  <div className="res-empty">
                    <div className="ico">◎</div>
                    <div>Send a request to see the response</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>Results will appear here</div>
                  </div>
                )}
                {resErr && (
                  <div className="err-box">
                    <h4>Request Failed</h4>
                    <p>{resErr}</p>
                    {resTime && <p style={{ marginTop: 4, color: "var(--t3)" }}>Failed after {resTime}</p>}
                    {isCORS(resErr) && (
                      <div className="cors-hint">
                        <strong>Possible CORS Issue</strong><br />
                        The server may not allow browser requests. Ensure the API returns <code>Access-Control-Allow-Origin</code> headers.
                      </div>
                    )}
                  </div>
                )}
                {status !== null && resTab === "body" && (
                  <div dangerouslySetInnerHTML={{ __html: renderBodyHTML() }} />
                )}
                {status !== null && resTab === "headers" && resHdrs && (
                  <div dangerouslySetInnerHTML={{ __html: renderHeadersHTML() }} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── SAVE MODAL ── */}
      {saveModal && (
        <div className="modal-ov" onClick={e => { if (e.target === e.currentTarget) setSaveModal(false); }}>
          <div className="modal">
            <h3>Save Request</h3>
            <div>
              <div className="fl" style={{ marginBottom: 4 }}>Request Name</div>
              <input className="fi" type="text" placeholder="e.g. Test GROQ Chat Completion"
                value={saveName} onChange={e => setSaveName(e.target.value)} />
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="fl" style={{ marginBottom: 4 }}>Collection (optional)</div>
              <input className="fi" type="text" placeholder="e.g. GROQ Tests"
                value={saveCol} onChange={e => setSaveCol(e.target.value)} />
            </div>
            <div className="ma">
              <button className="btn btnp" onClick={doSave}>Save</button>
              <button className="btn btng" onClick={() => setSaveModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      <div className={`toast${toastVisible ? " show" : ""} ${toastType}`}>{toastMsg}</div>
    </div>
  );
}

// ─── CHAT UI PANEL ────────────────────────────────────────────
function ChatUI({ jsonBody, onChange, onSend }: { jsonBody: string; onChange: (val: string) => void; onSend: (newBody: string) => void }) {
  let payload: any = null;
  let error = false;
  try {
    payload = JSON.parse(jsonBody || "{}");
    if (!payload || !Array.isArray(payload.messages)) {
      error = true;
    }
  } catch {
    error = true;
  }

  const [input, setInput] = useState("");
  const chatStreamRef = useRef<HTMLDivElement>(null);

  // Auto-scroll stream to bottom on new messages
  useEffect(() => {
    if (chatStreamRef.current) {
      chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
    }
  }, [jsonBody]);

  const sendMessage = () => {
    if (!input.trim() || error) return;
    const messages = [...(payload.messages || [])];
    messages.push({ role: "user", content: input.trim() });
    const newPayload = { ...payload, messages };
    const newJson = JSON.stringify(newPayload, null, 2);
    onChange(newJson);
    setInput("");
    onSend(newJson);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (error) {
    return (
      <div style={{ padding: 14, background: "var(--rdb)", border: "1px solid var(--rd)", borderRadius: "var(--rs)" }}>
        <p style={{ fontSize: 12, color: "var(--rd)", lineHeight: 1.5 }}>To use Chat UI, your JSON body must contain a standard <code>messages</code> array.</p>
        <button className="fmtb" style={{ marginTop: 10 }} onClick={() => {
          onChange(JSON.stringify({
            messages: [{ role: "user", content: "Hello!" }],
            model: "llama-3.3-70b-versatile"
          }, null, 2));
        }}>Initialize Chat Template</button>
      </div>
    );
  }

  const messages: any[] = payload.messages || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 260, background: "var(--bgi)", border: "1px solid var(--br)", borderRadius: "var(--rs)", overflow: "hidden" }}>
      {/* Model display */}
      <div style={{ padding: "6px 10px", background: "var(--bg3)", borderBottom: "1px solid var(--br)", display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--t2)" }}>
        <span>Model: <code>{payload.model || "not-specified"}</code></span>
      </div>
      {/* Message stream */}
      <div ref={chatStreamRef} style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.map((m, idx) => {
          const isUser = m.role === "user";
          return (
            <div key={idx} style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "85%",
                padding: "8px 12px",
                borderRadius: 10,
                borderBottomRightRadius: isUser ? 2 : 10,
                borderBottomLeftRadius: isUser ? 10 : 2,
                background: isUser ? "var(--acg)" : "var(--bg3)",
                border: "1px solid " + (isUser ? "var(--ac)" : "var(--br)"),
                color: "var(--t1)",
                fontSize: 12,
                wordBreak: "break-word"
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: isUser ? "var(--ac)" : "var(--t2)", marginBottom: 2 }}>{m.role}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
              </div>
            </div>
          );
        })}
      </div>
      {/* Input bar */}
      <div style={{ display: "flex", borderTop: "1px solid var(--br)", background: "var(--bg2)" }}>
        <input type="text" placeholder="Type a message..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyPress}
          style={{ flex: 1, background: "none", border: "none", color: "var(--t1)", padding: "10px 12px", outline: "none", fontSize: 12 }} />
        <button onClick={sendMessage} style={{ background: "var(--ac)", border: "none", color: "#000", fontWeight: 700, padding: "0 14px", cursor: "pointer", fontSize: 12 }}>Send</button>
      </div>
    </div>
  );
}
