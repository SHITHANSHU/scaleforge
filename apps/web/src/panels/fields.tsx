import { rovingKeys } from "../lib/roving";
import { useEffect, useState, type ComponentType } from "react";
import * as Slider from "@radix-ui/react-slider";
import * as Switch from "@radix-ui/react-switch";
import type { ConfigValue, FieldSpec, NumberField } from "@scaleforge/engine";
import { useStore } from "../state/store";

export interface FieldProps { field: FieldSpec; value: ConfigValue; onChange(v: ConfigValue, o?: { commit?: boolean }): void }

/** Custom editors register here by name and are selected with `field.editor`. */
export const customEditors: Record<string, ComponentType<FieldProps>> = {};

const toPos = (f: NumberField, v: number) => (f.scale === "log" ? Math.log(Math.max(v, f.min || 1e-9)) / Math.LN10 : v);
const fromPos = (f: NumberField, p: number) => (f.scale === "log" ? Math.pow(10, p) : p);
const snap = (f: NumberField, v: number) => {
  const s = f.step ?? 1;
  const r = f.scale === "log" && v > s * 20 ? Math.round(v / (s * Math.pow(10, Math.floor(Math.log10(v)) - 1))) * (s * Math.pow(10, Math.floor(Math.log10(v)) - 1)) : Math.round(v / s) * s;
  return Math.min(f.max, Math.max(f.min, +r.toPrecision(6)));
};

export function NumberEditor({ field, value, onChange }: FieldProps & { field: NumberField }) {
  const v = Number(value);
  const [text, setText] = useState(String(v));
  useEffect(() => setText(String(v)), [v]);
  const commitText = () => {
    const n = Number(text);
    if (Number.isFinite(n)) { const sn = snap(field, n); if (sn !== v) onChange(sn); else setText(String(v)); } else setText(String(v));
  };
  const lo = toPos(field, field.min), hi = toPos(field, field.max);
  return (
    <div className="flex items-center gap-2.5">
      {field.control !== "input" && (
        <Slider.Root
          className="relative flex h-5 flex-1 touch-none select-none items-center"
          min={lo} max={hi} step={field.scale === "log" ? (hi - lo) / 200 : (field.step ?? 1)} value={[toPos(field, v)]}
          onPointerDown={() => useStore.getState().commit()}
          onKeyDown={(e) => { if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End" || e.key.startsWith("Page")) useStore.getState().commit(); }}
          onValueChange={([p]) => onChange(snap(field, fromPos(field, p!)), { commit: false })}
          aria-label={field.label}
        >
          <Slider.Track className="relative h-1 grow rounded-full bg-line-strong"><Slider.Range className="absolute h-full rounded-full bg-accent" /></Slider.Track>
          <Slider.Thumb aria-label={field.label} aria-valuetext={`${v}${field.unit ? " " + field.unit : ""}`} className="block h-3.5 w-3.5 rounded-full border-2 border-accent bg-bg shadow transition-transform hover:scale-110" />
        </Slider.Root>
      )}
      <div className="flex w-[84px] shrink-0 items-center rounded-md border border-line bg-bg focus-within:border-accent">
        <input
          className="mono w-full min-w-0 bg-transparent px-1.5 py-1 text-right text-[12px] outline-none" inputMode="decimal" value={text} aria-label={`${field.label} value`} aria-invalid={text !== "" && !Number.isFinite(Number(text))}
          onChange={(e) => setText(e.target.value)} onBlur={commitText} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setText(String(v)); }}
        />
        {field.unit && <span className="pr-1.5 text-[10px] text-faint">{field.unit}</span>}
      </div>
    </div>
  );
}

function SelectEditor({ field, value, onChange }: FieldProps & { field: Extract<FieldSpec, { type: "select" }> }) {
  const cur = field.options.find((o) => o.value === value);
  if (field.options.length <= 3)
    return (
      <div>
        <div role="radiogroup" aria-label={field.label} onKeyDown={rovingKeys} className="flex rounded-md border border-line bg-bg p-0.5">
          {field.options.map((o) => (
            <button key={o.value} role="radio" tabIndex={o.value === value ? 0 : -1} aria-checked={o.value === value} onClick={() => onChange(o.value)}
              className={`flex-1 rounded px-2 py-1 text-[11.5px] ${o.value === value ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{o.label}</button>
          ))}
        </div>
        {cur?.hint && <div className="mt-1 text-[11px] text-faint">{cur.hint}</div>}
      </div>
    );
  return (
    <div>
      <select value={String(value)} onChange={(e) => onChange(e.target.value)} aria-label={field.label} className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[12px] outline-none focus:border-accent">
        {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {cur?.hint && <div className="mt-1 text-[11px] text-faint">{cur.hint}</div>}
    </div>
  );
}

export function FieldRow({ field, value, onChange, disabled }: FieldProps & { disabled?: boolean }) {
  const Custom = field.editor ? customEditors[field.editor] : undefined;
  const id = `f-${field.key}`;
  void id;
  const inline = field.type === "switch";
  return (
    <div className={`py-1.5 ${disabled ? "pointer-events-none opacity-45" : ""}`} {...(disabled ? { inert: true } : {})} title={disabled ? "Locked by this challenge" : undefined}>
      {disabled && <span className="sr-only">Locked by this challenge.</span>}
      <div className={inline ? "flex items-center justify-between gap-3" : ""}>
        <label htmlFor={id} className="text-[12px] text-fg">{field.label}</label>
        {field.type === "switch" && (
          <Switch.Root id={id} checked={Boolean(value)} onCheckedChange={(c) => onChange(c)} className="relative h-4 w-7 rounded-full bg-line-strong transition-colors data-[state=checked]:bg-accent">
            <Switch.Thumb className="block h-3 w-3 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-3.5" />
          </Switch.Root>
        )}
      </div>
      {field.type === "number" && (Custom ? <Custom field={field} value={value} onChange={onChange} /> : <NumberEditor field={field} value={value} onChange={onChange} />)}
      {field.type === "select" && <SelectEditor field={field} value={value} onChange={onChange} />}
      {field.help && <div className="mt-0.5 text-[11px] leading-snug text-faint">{field.help}</div>}
    </div>
  );
}

/** Example custom editor: Zipf skew slider with a live popularity-curve preview. */
customEditors.zipf = (p) => {
  const f = p.field as NumberField;
  const s = Number(p.value);
  const bars = Array.from({ length: 24 }, (_, i) => Math.pow(i + 1, -s));
  const max = bars[0]!;
  return (
    <div>
      <NumberEditor {...p} field={f} />
      <svg viewBox="0 0 96 20" className="mt-1 h-5 w-full" aria-label="Key popularity preview" role="img">
        {bars.map((b, i) => <rect key={i} x={i * 4} y={20 - (b / max) * 20} width="3" height={(b / max) * 20} rx="0.5" fill="var(--accent)" opacity={0.75} />)}
      </svg>
    </div>
  );
};
