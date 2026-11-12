import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { ConfigRecord, Preset } from "@scaleforge/engine";
import { useRegistry } from "../lib/registry";
import { FieldRow } from "../panels/fields";
import { deleteCustomPreset, saveCustomPreset } from "../lib/custom-presets";
import { Icon, categoryColor } from "../lib/icons";
import { toast } from "../lib/toast";

/** View built-in presets with their sources, and author your own. Everything a preset sets is editable. */
export function Presets() {
  const reg = useRegistry();
  const defs = reg.list().filter((d) => d.fields.length);
  const [kind, setKind] = useState(defs[0]?.kind ?? "");
  const def = reg.get(kind);
  const presets = reg.presetsFor(kind);
  const [draft, setDraft] = useState<ConfigRecord | null>(null);
  const [name, setName] = useState("My preset"), [source, setSource] = useState("");
  const cfg = draft ?? def?.defaults ?? {};

  const save = () => {
    if (!def) return;
    const id = `custom-${name.toLowerCase().replace(/\W+/g, "-")}`;
    const values = Object.fromEntries(Object.entries(cfg).filter(([k, v]) => v !== def.defaults[k])) as Preset["values"];
    const p: Preset = { id, label: name, version: (presets.find((x) => x.id === id)?.version ?? 0) + 1, approximate: true, source: source ? { title: source } : undefined, values };
    saveCustomPreset(kind, p);
    toast(`Saved “${name}” (v${p.version})`, "ok");
  };

  return (
    <div className="flex h-full">
      <nav className="w-56 shrink-0 overflow-y-auto border-r border-line bg-surface p-2" aria-label="Components">
        {defs.map((d) => (
          <button key={d.kind} onClick={() => { setKind(d.kind); setDraft(null); }} aria-current={d.kind === kind} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${d.kind === kind ? "bg-hover" : "hover:bg-hover"}`}>
            <span style={{ color: categoryColor[d.category] }}><Icon name={d.icon} size={14} /></span>{d.name}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {def && (
          <div className="mx-auto grid max-w-4xl gap-8 px-6 py-8 lg:grid-cols-2">
            <section>
              <h1 className="text-[18px] font-semibold">{def.name} presets</h1>
              <p className="mt-1 text-[12px] text-muted">Every shipped number is approximate until calibrated. Check the source, then change anything.</p>
              {presets.length === 0 && <p className="mt-4 text-faint">No presets for this component yet. Create one on the right.</p>}
              <ul className="mt-4 space-y-2">
                {presets.map((p) => (
                  <li key={p.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center gap-2"><span className="text-[13px] font-medium">{p.label}</span><span className="text-[10.5px] text-faint">v{p.version}{p.approximate ? " · approximate" : ""}{p.builtin ? " · built-in" : " · custom"}</span>
                      <button onClick={() => setDraft({ ...def.defaults, ...p.values })} className="ml-auto text-[11.5px] text-info hover:underline">Edit copy</button>
                      {!p.builtin && <button aria-label={`Delete ${p.label}`} onClick={() => deleteCustomPreset(kind, p.id)} className="text-faint hover:text-bad"><Trash2 size={13} /></button>}</div>
                    <div className="mono mt-1.5 text-[11px] leading-relaxed text-muted">{Object.entries(p.values).map(([k, v]) => `${k}=${String(v)}`).join("  ")}</div>
                    <div className="mt-1 text-[11px] text-faint">Source: {p.source ? (p.source.url ? <a className="text-info underline" target="_blank" rel="noreferrer" href={p.source.url}>{p.source.title}</a> : p.source.title) : "none provided"}</div>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h2 className="text-[13px] font-medium">New preset from values</h2>
              <div className="mt-2 flex gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Preset name" className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent" />
                <button onClick={save} className="rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-accent-fg">Save</button>
              </div>
              <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source (benchmark, docs link, your measurement)" aria-label="Source" className="mt-2 w-full rounded-md border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent" />
              {def.fields.filter((f) => !f.showIf || cfg[f.showIf.key] === f.showIf.equals).map((f) => (
                <FieldRow key={f.key} field={f} value={cfg[f.key]!} onChange={(v) => setDraft({ ...cfg, [f.key]: v })} />
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

