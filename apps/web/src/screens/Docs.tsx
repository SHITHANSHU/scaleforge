import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, Info, Lightbulb, Search, TriangleAlert } from "lucide-react";
import type { ComponentDefinition, FieldSpec } from "@scaleforge/engine";
import { useRegistry } from "../lib/registry";
import { Icon, categoryColor, categoryLabel } from "../lib/icons";
import { guides, type Block, type Guide, type Ref } from "../docs/guides";

type Sel = { kind: "guide"; id: string } | { kind: "component"; id: string };
const ORDER = ["traffic", "network", "compute", "cache", "messaging", "data"];
const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** Product documentation: guides plus a reference page generated from every registered component. */
export function Docs() {
  const reg = useRegistry();
  const [sel, setSel] = useState<Sel>({ kind: "guide", id: guides[0]!.id });
  const [q, setQ] = useState("");
  const main = useRef<HTMLDivElement>(null);
  useEffect(() => { main.current?.scrollTo({ top: 0 }); }, [sel]);

  const term = q.trim().toLowerCase();
  const components = reg.list();
  const filteredGuides = guides.filter((g) => !term || `${g.title} ${g.summary}`.toLowerCase().includes(term) || g.sections.some((s) => s.title.toLowerCase().includes(term)));
  const filteredComps = components.filter((d) => !term || `${d.name} ${d.kind} ${d.description} ${d.category}`.toLowerCase().includes(term));
  const groups: Guide["group"][] = ["Start here", "Concepts", "Reference"];

  const def = sel.kind === "component" ? reg.get(sel.id) : undefined;
  const guide = sel.kind === "guide" ? guides.find((g) => g.id === sel.id) : undefined;

  return (
    <div className="flex h-full">
      <nav className="flex w-[264px] shrink-0 flex-col border-r border-line bg-surface" aria-label="Documentation">
        <div className="p-3">
          <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-2 focus-within:border-accent">
            <Search size={13} className="text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the docs" aria-label="Search the docs" className="w-full bg-transparent py-1.5 text-[12px] outline-none placeholder:text-faint" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
          {groups.map((grp) => {
            const items = filteredGuides.filter((g) => g.group === grp);
            if (!items.length) return null;
            return (
              <section key={grp} className="mb-3">
                <h3 className="px-2 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-wider text-faint">{grp}</h3>
                {items.map((g) => <NavItem key={g.id} active={sel.kind === "guide" && sel.id === g.id} onClick={() => setSel({ kind: "guide", id: g.id })}><BookOpen size={14} className="shrink-0 text-faint" />{g.title}</NavItem>)}
              </section>
            );
          })}
          {filteredComps.length > 0 && <h3 className="px-2 pb-1 pt-3 text-[10.5px] font-medium uppercase tracking-wider text-faint">Components</h3>}
          {ORDER.map((cat) => {
            const items = filteredComps.filter((d) => d.category === cat);
            if (!items.length) return null;
            return (
              <section key={cat} className="mb-1.5">
                <div className="px-2 pb-0.5 pt-1.5 text-[11px] text-muted">{categoryLabel[cat]}</div>
                {items.map((d) => (
                  <NavItem key={d.kind} active={sel.kind === "component" && sel.id === d.kind} onClick={() => setSel({ kind: "component", id: d.kind })}>
                    <span className="shrink-0" style={{ color: categoryColor[d.category] }}><Icon name={d.icon} size={14} /></span>{d.name}
                  </NavItem>
                ))}
              </section>
            );
          })}
          {filteredGuides.length === 0 && filteredComps.length === 0 && <p className="px-2 py-6 text-center text-[12px] text-faint">Nothing matches “{q}”.</p>}
        </div>
      </nav>

      <div ref={main} className="min-w-0 flex-1 overflow-y-auto scroll-smooth">
        {guide && <GuidePage guide={guide} onOpenComponent={(id) => setSel({ kind: "component", id })} />}
        {def && <ComponentPage def={def} />}
      </div>
    </div>
  );
}

function NavItem({ active, onClick, children }: { active: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${active ? "bg-hover font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}>{children}</button>
  );
}

/* ---------- layout: article + "on this page" ---------- */

function Page({ eyebrow, title, lead, toc, children, header }: { eyebrow?: string; title: string; lead?: string; toc: { id: string; title: string }[]; header?: React.ReactNode; children: React.ReactNode }) {
  const [active, setActive] = useState(toc[0]?.id);
  const art = useRef<HTMLElement>(null);
  useEffect(() => {
    const els = toc.map((t) => document.getElementById(t.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver((entries) => { const v = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setActive(v.target.id); }, { rootMargin: "-10% 0px -75% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [toc]);
  return (
    <div className="mx-auto flex max-w-[1080px] gap-12 px-8 py-10">
      <article ref={art} className="min-w-0 max-w-[720px] flex-1">
        {eyebrow && <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-accent">{eyebrow}</div>}
        {header}
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">{title}</h1>
        {lead && <p className="mt-3 text-[15px] leading-relaxed text-muted">{lead}</p>}
        <div className="mt-8 space-y-10">{children}</div>
        <footer className="mt-14 border-t border-line pt-4 text-[11.5px] text-faint">ScaleForge models are teaching tools, not production predictors. Check the sources before relying on any figure.</footer>
      </article>
      {toc.length > 1 && (
        <aside className="sticky top-10 hidden h-fit w-48 shrink-0 xl:block" aria-label="On this page">
          <div className="mb-2 text-[10.5px] font-medium uppercase tracking-wider text-faint">On this page</div>
          <ul className="space-y-1 border-l border-line">
            {toc.map((t) => (
              <li key={t.id}><a href={`#${t.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(t.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                className={`-ml-px block border-l py-0.5 pl-3 text-[12px] ${active === t.id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}>{t.title}</a></li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}

const H2 = ({ id, children }: { id: string; children: React.ReactNode }) => <h2 id={id} className="mb-3 scroll-mt-6 border-b border-line pb-2 text-[17px] font-semibold tracking-tight">{children}</h2>;

/* ---------- guides ---------- */

function GuidePage({ guide, onOpenComponent }: { guide: Guide; onOpenComponent(id: string): void }) {
  void onOpenComponent;
  return (
    <Page eyebrow={guide.group} title={guide.title} lead={guide.summary} toc={guide.sections.map((s) => ({ id: s.id, title: s.title }))}>
      {guide.sections.map((s) => <section key={s.id}><H2 id={s.id}>{s.title}</H2><div className="space-y-4">{s.blocks.map((b, i) => <BlockView key={i} b={b} />)}</div></section>)}
    </Page>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "p": return <p className="text-[13.5px] leading-[1.7] text-fg/90">{b.text}</p>;
    case "h3": return <h3 className="pt-2 text-[14px] font-semibold">{b.text}</h3>;
    case "ul": return <ul className="ml-5 list-disc space-y-1.5 text-[13.5px] leading-[1.65] text-fg/90 marker:text-faint">{b.items.map((i) => <li key={i}>{i}</li>)}</ul>;
    case "ol": return <ol className="ml-5 list-decimal space-y-1.5 text-[13.5px] leading-[1.65] text-fg/90 marker:text-faint">{b.items.map((i) => <li key={i}>{i}</li>)}</ol>;
    case "callout": return <Callout tone={b.tone} title={b.title}>{b.text}</Callout>;
    case "table": return <Table head={b.head} rows={b.rows} />;
    case "refs": return <Refs items={b.items} />;
  }
}

function Callout({ tone, title, children }: { tone: "info" | "warn" | "tip"; title: string; children: React.ReactNode }) {
  const cfg = { info: ["border-info/40 bg-info/10", "text-info", <Info key="i" size={15} />], warn: ["border-warn/40 bg-warn/10", "text-warn", <TriangleAlert key="w" size={15} />], tip: ["border-ok/40 bg-ok/10", "text-ok", <Lightbulb key="t" size={15} />] }[tone];
  return (
    <div className={`flex gap-3 rounded-lg border px-4 py-3 ${cfg[0]}`} role="note">
      <span className={`mt-0.5 shrink-0 ${cfg[1]}`}>{cfg[2]}</span>
      <div><div className="text-[13px] font-medium">{title}</div><p className="mt-0.5 text-[13px] leading-relaxed text-muted">{children}</p></div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-[12.5px]">
        <thead className="bg-surface text-left text-[11px] uppercase tracking-wider text-faint"><tr>{head.map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line align-top">{r.map((c, j) => <td key={j} className={`px-3 py-2 leading-snug ${j === 0 ? "whitespace-nowrap font-medium" : "text-muted"}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** External sources, shown as cards: title, why it is relevant, and where it lives. */
function Refs({ items }: { items: Ref[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2" aria-label="References">
      {items.map((r) => (
        <li key={r.url}>
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="group flex h-full flex-col rounded-lg border border-line bg-surface p-3 hover:border-accent">
            <span className="flex items-start gap-1.5 text-[13px] font-medium leading-snug group-hover:text-accent">{r.title}<ArrowUpRight size={13} className="mt-0.5 shrink-0 text-faint group-hover:text-accent" aria-hidden /></span>
            {r.note && <span className="mt-1 text-[12px] leading-snug text-muted">{r.note}</span>}
            <span className="mono mt-auto pt-2 text-[10.5px] text-faint">{host(r.url)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/* ---------- component reference ---------- */

function fieldRange(f: FieldSpec): string {
  if (f.type === "number") return `${f.min.toLocaleString()} – ${f.max.toLocaleString()}${f.unit ? ` ${f.unit}` : ""}${f.scale === "log" ? " (log)" : ""}`;
  if (f.type === "select") return f.options.map((o) => o.label).join(" · ");
  return "on / off";
}

function ComponentPage({ def }: { def: ComponentDefinition<any, any> }) {
  const reg = useRegistry();
  const presets = reg.presetsFor(def.kind);
  const groups = useMemo(() => { const m = new Map<string, FieldSpec[]>(); for (const f of def.fields) { const g = f.group ?? "General"; if (!m.has(g)) m.set(g, []); m.get(g)!.push(f); } return [...m]; }, [def]);
  const color = categoryColor[def.category];
  const d = def.docs;
  const toc = [
    { id: "overview", title: "Overview" }, { id: "connections", title: "Connections" }, { id: "configuration", title: "Configuration" },
    ...(presets.length ? [{ id: "presets", title: "Presets" }] : []), { id: "metrics", title: "Metrics" },
    ...(def.faults?.length ? [{ id: "faults", title: "Failure injection" }] : []),
    { id: "models", title: "What it models" }, { id: "simplifies", title: "What it simplifies" }, { id: "failures", title: "Failure scenarios" }, { id: "references", title: "References" },
  ];
  const stat = (l: string, v: string | number) => <div className="rounded-lg border border-line bg-surface px-3 py-2"><div className="text-[10.5px] uppercase tracking-wider text-faint">{l}</div><div className="mt-0.5 text-[14px] font-medium">{v}</div></div>;

  return (
    <Page
      eyebrow={`${categoryLabel[def.category]} component`} title={def.name} lead={def.description} toc={toc}
      header={<div className="mb-3 flex items-center gap-2.5"><span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: `${color}22`, color }}><Icon name={def.icon} size={19} /></span><span className="mono rounded bg-surface px-2 py-0.5 text-[11px] text-muted">{def.kind} · v{def.version}</span></div>}
    >
      <section><H2 id="overview">Overview</H2>
        <p className="text-[13.5px] leading-[1.7] text-fg/90">{d.summary}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{stat("Ports", def.ports.filter((p) => !p.hidden).length)}{stat("Settings", def.fields.length)}{stat("Metrics", def.metrics.length)}{stat("Faults", (def.faults?.length ?? 0) + 1)}</div>
      </section>

      <section><H2 id="connections">Connections</H2>
        <p className="mb-3 text-[13px] text-muted">Ports decide what can be wired to what. Two ports connect when they share a protocol; the first shared one in the output's list is used.</p>
        <Table head={["Port", "Direction", "Protocols"]} rows={def.ports.filter((p) => !p.hidden).map((p) => [p.label, p.direction === "in" ? "Input" : "Output", p.protocols.join(", ")])} />
        {def.ports.some((p) => p.hidden) && <p className="mt-2 text-[12px] text-faint">Hidden ports end a request successfully when nothing is attached ({def.ports.filter((p) => p.hidden).map((p) => p.label).join(", ")}).</p>}
      </section>

      <section><H2 id="configuration">Configuration</H2>
        <div className="space-y-5">
          {groups.map(([g, fields]) => (
            <div key={g}>
              <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{g}</h3>
              <div className="overflow-hidden rounded-lg border border-line">
                {fields.map((f, i) => (
                  <div key={f.key} className={`grid gap-x-4 px-3 py-2.5 sm:grid-cols-[200px_1fr] ${i ? "border-t border-line" : ""}`}>
                    <div><div className="text-[12.5px] font-medium">{f.label}</div><div className="mono text-[10.5px] text-faint">{f.key}</div></div>
                    <div><div className="mono text-[11.5px] text-muted">{fieldRange(f)}</div>{f.help && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{f.help}</p>}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {presets.length > 0 && (
        <section><H2 id="presets">Presets</H2>
          <p className="mb-3 text-[13px] text-muted">Starting points, not guarantees. Values marked approximate are illustrative until calibrated against your own measurements; every value stays editable.</p>
          <Table head={["Preset", "Status", "Source"]} rows={presets.map((p) => [p.label, `${p.approximate ? "approximate" : "documented"} · v${p.version}`, p.source ? (p.source.url ? `${p.source.title} (${host(p.source.url)})` : p.source.title) : "none provided"])} />
        </section>
      )}

      <section><H2 id="metrics">Metrics</H2>
        <Table head={["Metric", "Meaning", "Unit"]} rows={def.metrics.map((m) => [m.label, m.description ?? m.id, m.unit || "count"])} />
      </section>

      {def.faults && def.faults.length > 0 && (
        <section><H2 id="faults">Failure injection</H2>
          <p className="mb-3 text-[13px] text-muted">Schedule these in the scenario. Every component can also be killed outright.</p>
          <Table head={["Fault", "Effect"]} rows={def.faults.map((f) => [f.label, f.description])} />
        </section>
      )}

      <section><H2 id="models">What it models</H2><ul className="ml-5 list-disc space-y-1.5 text-[13.5px] leading-[1.65] text-fg/90 marker:text-faint">{d.models.map((x) => <li key={x}>{x}</li>)}</ul></section>
      <section><H2 id="simplifies">What it simplifies</H2>
        <Callout tone="warn" title="Read before relying on a result">These are deliberate simplifications. A design that depends on one of them should be validated against your real system.</Callout>
        <ul className="ml-5 mt-4 list-disc space-y-1.5 text-[13.5px] leading-[1.65] text-fg/90 marker:text-faint">{d.simplifies.map((x) => <li key={x}>{x}</li>)}</ul></section>
      <section><H2 id="failures">Failure scenarios</H2><ul className="ml-5 list-disc space-y-1.5 text-[13.5px] leading-[1.65] text-fg/90 marker:text-faint">{d.failureScenarios.map((x) => <li key={x}>{x}</li>)}</ul></section>
      <section><H2 id="references">References</H2>
        <Refs items={d.references.filter((r): r is { title: string; url: string } => !!r.url)} />
        {d.references.some((r) => !r.url) && <p className="mt-2 text-[12px] text-faint">Also informed by: {d.references.filter((r) => !r.url).map((r) => r.title).join("; ")}.</p>}
      </section>
    </Page>
  );
}
