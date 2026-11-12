import { useRef, useState } from "react";
import { Check, CircleAlert, Download, FolderOpen, Link2, Loader2, Moon, Redo2, Sun, Undo2, Upload, BookOpen, FlaskConical, Trophy, LayoutGrid, SlidersHorizontal } from "lucide-react";
import { useStore, designFromStore } from "../state/store";
import { exportBundle, importBundle, saveGist, shareUrl } from "../lib/persistence";
import { toast } from "../lib/toast";

export type Screen = "workspace" | "home" | "docs" | "challenges" | "playgrounds" | "presets";

export function TopBar({ screen, setScreen, theme, toggleTheme }: { screen: Screen; setScreen(s: Screen): void; theme: string; toggleTheme(): void }) {
  const name = useStore((s) => s.doc.name);
  const save = useStore((s) => s.saveState);
  const canUndo = useStore((s) => s.past.length > 0), canRedo = useStore((s) => s.future.length > 0);
  const { setName, undo, redo, load } = useStore.getState();
  const file = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const download = () => {
    const d = designFromStore();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([exportBundle(d)], { type: "application/json" }));
    a.download = `${d.name.replace(/\W+/g, "-").toLowerCase()}.sdsim.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const share = async () => {
    const url = shareUrl(designFromStore());
    await navigator.clipboard?.writeText(url).catch(() => {});
    history.replaceState(null, "", url);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
    toast(url.length > 6000 ? "Link copied — large design, may be too long for some apps. Use Export instead." : "Share link copied", url.length > 6000 ? "warn" : "ok");
  };
  const gist = async () => {
    const token = window.prompt("GitHub token with the gist scope (used once, never stored):");
    if (!token) return;
    try {
      const id = await saveGist(token.trim(), designFromStore());
      const url = `${location.origin}${location.pathname}#gist=${id}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast("Gist saved — link copied", "ok");
    } catch (e) { toast(`Gist failed: ${(e as Error).message}`, "warn"); }
  };
  const onFile = async (f?: File) => {
    if (!f) return;
    try { const d = importBundle(await f.text()); load(d); setScreen("workspace"); toast(`Imported “${d.name}”`, "ok"); }
    catch (e) { toast(`Import failed: ${(e as Error).message.slice(0, 120)}`, "warn"); }
  };

  const nav: { id: Screen; label: string; icon: React.ReactNode }[] = [
    { id: "workspace", label: "Workspace", icon: <LayoutGrid size={14} /> }, { id: "challenges", label: "Challenges", icon: <Trophy size={14} /> },
    { id: "playgrounds", label: "Labs", icon: <FlaskConical size={14} /> }, { id: "presets", label: "Presets", icon: <SlidersHorizontal size={14} /> }, { id: "docs", label: "Docs", icon: <BookOpen size={14} /> },
  ];
  const Btn = ({ onClick, label, children, disabled }: { onClick(): void; label: string; children: React.ReactNode; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label} className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent">{children}</button>
  );

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
      <button onClick={() => setScreen("home")} className="flex items-center gap-2 rounded-md pr-1 hover:opacity-80" aria-label="Home">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-accent-fg"><svg width="14" height="14" viewBox="0 0 32 32"><path d="M6 24l7-14 5 9 3-5 5 10" stroke="currentColor" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        <span className="text-[13px] font-semibold tracking-tight">ScaleForge</span>
      </button>
      <nav className="flex items-center gap-0.5" aria-label="Sections">
        {nav.map((n) => (
          <button key={n.id} onClick={() => setScreen(n.id)} aria-current={screen === n.id ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] ${screen === n.id ? "bg-hover text-fg" : "text-muted hover:text-fg"}`}>{n.icon}{n.label}</button>
        ))}
      </nav>
      <div className="mx-auto flex items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Design name" className="w-56 rounded-md bg-transparent px-2 py-1 text-center text-[13px] font-medium outline-none hover:bg-hover focus:bg-bg" />
        <span className="flex w-[74px] items-center gap-1 text-[11px] text-faint" role="status" aria-live="polite">
          {save === "saving" && <><Loader2 size={11} className="animate-spin" /> Saving</>}
          {save === "saved" && <><Check size={11} className="text-ok" /> Saved</>}
          {save === "dirty" && <>Unsaved…</>}
          {save === "error" && <span className="flex items-center gap-1 text-bad"><CircleAlert size={11} /> Not saved</span>}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <Btn onClick={undo} label="Undo (⌘Z)" disabled={!canUndo}><Undo2 size={15} /></Btn>
        <Btn onClick={redo} label="Redo (⇧⌘Z)" disabled={!canRedo}><Redo2 size={15} /></Btn>
        <span className="mx-1 h-4 w-px bg-line" />
        <Btn onClick={() => file.current?.click()} label="Import .sdsim.json"><Upload size={15} /></Btn>
        <Btn onClick={download} label="Export .sdsim.json"><Download size={15} /></Btn>
        <button onClick={gist} className="hidden rounded-md px-1.5 py-1 text-[11px] text-faint hover:bg-hover hover:text-fg xl:block" title="Save to a private GitHub Gist with your own token">Gist</button>
        <Btn onClick={() => setScreen("home")} label="Open design"><FolderOpen size={15} /></Btn>
        <button onClick={share} className="ml-1 flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-[12px] hover:border-accent hover:text-accent">{copied ? <Check size={13} /> : <Link2 size={13} />}{copied ? "Copied" : "Share"}</button>
        <Btn onClick={toggleTheme} label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</Btn>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    </header>
  );
}
