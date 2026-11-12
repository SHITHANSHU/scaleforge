import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Canvas } from "./canvas/Canvas";
import { Palette } from "./panels/Palette";
import { Inspector } from "./panels/Inspector";
import { Dock } from "./panels/Dock";
import { TopBar, type Screen } from "./panels/TopBar";
import { QuickAdd } from "./panels/QuickAdd";
import { Home } from "./screens/Home";
import { Docs } from "./screens/Docs";
import { Challenges } from "./screens/Challenges";
import { Labs } from "./screens/Labs";
import { Presets } from "./screens/Presets";
import { loadCustomPresets } from "./lib/custom-presets";
import { ChallengePanel } from "./panels/ChallengePanel";
import { OpenChallengePanel } from "./panels/OpenChallengePanel";
import { Toasts } from "./lib/toast";
import { useHotkeys } from "./lib/hotkeys";
import { loadInitial, startAutosave } from "./lib/persistence";
import { useStore } from "./state/store";
import "./lib/lint";

const EMBED = new URLSearchParams(location.search).get("embed") === "1";

export function App() {
  const [screen, setScreen] = useState<Screen>("workspace");
  const [quick, setQuick] = useState(false);
  const [help, setHelp] = useState(false);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "dark");
  const load = useStore((s) => s.load);

  useEffect(() => { loadCustomPresets(); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem("sf-theme", theme); } catch { /* private mode */ } }, [theme]);
  useEffect(() => {
    let off = () => {}, cancelled = false;
    void loadInitial().then((d) => { if (cancelled) return; if (d) load(d, { fromDb: true }); else setScreen("home"); off = startAutosave(); });
    return () => { cancelled = true; off(); };
  }, [load]);
  useHotkeys({ quickAdd: () => setQuick(true), help: () => setHelp((h) => !h) });

  if (EMBED) {
    // read-only embed for blogs and docs: canvas + dock, no editing chrome
    return (
      <div className="flex h-full flex-col"><div className="min-h-0 flex-1"><Canvas readOnly /></div><Dock /><Toasts /></div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar screen={screen} setScreen={setScreen} theme={theme} toggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")} />
      <main className="min-h-0 flex-1">
        {screen === "workspace" && (
          <div className="flex h-full flex-col">
            <div className="flex min-h-0 flex-1">
              <div className="hidden lg:contents"><Palette /></div>
              <OpenChallengePanel />
              <div className="relative min-w-0 flex-1"><Canvas /><ChallengePanel /></div>
              <div className="hidden md:contents"><Inspector /></div>
            </div>
            <Dock />
          </div>
        )}
        {screen === "home" && <Home go={setScreen} />}
        {screen === "docs" && <Docs />}
        {screen === "challenges" && <Challenges go={setScreen} />}
        {screen === "playgrounds" && <Labs />}
        {screen === "presets" && <Presets />}
      </main>
      <QuickAdd open={quick} onClose={() => setQuick(false)} />
      {help && <Shortcuts onClose={() => setHelp(false)} />}
      <Toasts />
    </div>
  );
}

const keys: [string, string][] = [["Space", "Run / pause"], [".", "Step 100 ms"], ["⌘K", "Quick-add component"], ["/", "Search palette"], ["⌘Z / ⇧⌘Z", "Undo / redo"], ["⌘C ⌘V ⌘D", "Copy, paste, duplicate"], ["⌘G", "Group in boundary"], ["Del", "Delete selection"], ["⌘A", "Select all"], ["Esc", "Clear selection"], ["Scroll / ⌘+scroll", "Pan / zoom"], ["Shift-drag", "Box select"]];
function Shortcuts({ onClose }: { onClose(): void }) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 w-[min(380px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line-strong bg-raised p-4 shadow-2xl">
          <Dialog.Title className="mb-2 text-[13px] font-medium">Keyboard shortcuts</Dialog.Title>
          {keys.map(([k, d]) => <div key={k} className="flex justify-between py-1 text-[12px]"><span className="text-muted">{d}</span><kbd className="mono rounded bg-bg px-1.5">{k}</kbd></div>)}
          <Dialog.Close className="mt-3 rounded-md border border-line-strong px-3 py-1 text-[12px] hover:border-accent">Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
