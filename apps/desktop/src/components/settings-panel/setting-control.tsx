import { useState } from "react";
import type { SettingDef } from "@/lib/settings-schema";
import { FontControl } from "./font-control";
import { SelectControl } from "./select-control";

interface SettingControlProps {
  def: SettingDef;
  value: unknown;
  onChange: (value: unknown) => void | Promise<void>;
  onReset: () => void;
  isModified: boolean;
}

function BooleanControl({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      aria-label="Toggle setting"
      className="relative h-5 w-9 rounded-full transition-colors duration-200"
      style={{
        backgroundColor: value ? "var(--link-color)" : "var(--border-color)",
      }}
    >
      <span
        className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-200 ease-out"
        style={{ transform: value ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

function NumberControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      aria-label="Number value"
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
      className="w-28 h-9 rounded-lg border border-transparent bg-[var(--surface-input)] px-3 text-[13px] text-[var(--text-secondary)] font-[inherit] outline-none focus:border-[var(--focus-border)] focus-visible:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}

function StringControl({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  // A non-null draft belongs to the active edit. External persistence updates
  // remain visible when idle, but cannot replace newer typing after a commit.
  const [draft, setDraft] = useState<string | null>(null);
  const displayedValue = draft ?? value;

  const commit = () => {
    if (displayedValue !== value) onChange(displayedValue);
    setDraft(null);
  };

  return (
    <input
      type="text"
      value={displayedValue}
      placeholder={placeholder}
      aria-label="Text value"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="w-64 h-9 rounded-lg border border-transparent bg-[var(--surface-input)] px-3 text-[13px] text-[var(--text-secondary)] font-[inherit] outline-none focus:border-[var(--focus-border)] focus-visible:outline-none"
    />
  );
}

function EnumControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return <SelectControl value={value} options={options} onChange={onChange} />;
}

const HEX_RE = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i;

function ColorControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Local text state so the user can type intermediate invalid hex while editing.
  // Callers key this component on `value` so an external value change remounts it
  // and resets `text` to the new value.
  // Intentional editable local copy: caller keys this on `value` so external changes remount and reset; local state allows typing intermediate invalid hex before commit.
  // eslint-disable-next-line react-doctor/no-derived-useState
  const [text, setText] = useState(value);

  function commit(next: string) {
    if (HEX_RE.test(next)) {
      onChange(next.toUpperCase());
    } else {
      setText(value);
    }
  }

  const swatch = HEX_RE.test(value) ? value : "#000000";

  return (
    <div className="relative inline-flex h-9 w-44 items-center gap-2 rounded-lg bg-[var(--surface-input)] pr-3 pl-1">
      <span
        className="relative inline-flex h-7 w-7 shrink-0 overflow-hidden rounded-md ring-1 ring-[var(--border-color)]"
        style={{ backgroundColor: swatch }}
      >
        <input
          type="color"
          value={swatch}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          aria-label="Pick color"
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </span>
      <input
        type="text"
        value={text}
        aria-label="Hex color value"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        spellCheck={false}
        className="flex-1 bg-transparent font-mono text-[13px] uppercase tracking-wide text-[var(--text-secondary)] outline-none"
      />
    </div>
  );
}

function RangeControl({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label="Range value"
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-44 appearance-none rounded-full bg-[var(--surface-subtle)] accent-[var(--accent)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
      />
      <span className="w-10 shrink-0 text-right text-[13px] tabular-nums text-[var(--text-muted)]">
        {Math.round(value)}
      </span>
    </div>
  );
}

function ListControl({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  function handleRemove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleAdd() {
    onChange([...value, ""]);
  }

  function handleChange(index: number, newVal: string) {
    const updated = [...value];
    updated[index] = newVal;
    onChange(updated);
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {value.map((item, i) => (
        // eslint-disable-next-line react-doctor/no-array-index-as-key -- positional string[] (may be empty/duplicated) bound to controlled inputs by position; a value-derived key would collide on dupes and remount inputs on each keystroke.
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            value={item}
            aria-label={`List item ${i + 1}`}
            onChange={(e) => handleChange(i, e.target.value)}
            className="h-9 w-64 rounded-lg border border-transparent bg-[var(--surface-input)] px-3 text-[13px] text-[var(--text-secondary)] font-[inherit] outline-none focus:border-[var(--focus-border)] focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={() => handleRemove(i)}
            aria-label="Remove item"
            className="pointer-events-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[13px] leading-none text-[var(--text-icon-muted)] hover:text-[var(--text-secondary)]"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={handleAdd}
        className="mr-6 flex h-9 w-64 items-center justify-center rounded-lg border border-dashed border-[var(--line-subtle)] text-[13px] text-[var(--text-muted)] transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        + Add
      </button>
    </div>
  );
}

/** Dispatch a control widget for a SettingDef. The single switch keeps the
 *  schema → control mapping centralized; any view rendering settings should
 *  use this rather than re-implementing the type dispatch. */
function Control({
  def,
  value,
  onChange,
}: {
  def: SettingDef;
  value: unknown;
  onChange: (value: unknown) => void | Promise<void>;
}) {
  switch (def.type) {
    case "boolean":
      return <BooleanControl value={value as boolean} onChange={onChange} />;
    case "number":
      return <NumberControl value={value as number} onChange={onChange} />;
    case "string":
      return (
        <StringControl value={value as string} placeholder={def.placeholder} onChange={onChange} />
      );
    case "font":
      return <FontControl def={def} value={value as string} onChange={onChange} />;
    case "enum":
      return (
        <EnumControl value={value as string} options={def.options ?? []} onChange={onChange} />
      );
    case "list":
      return <ListControl value={(value as string[]) ?? []} onChange={onChange} />;
    case "color":
      return <ColorControl key={value as string} value={value as string} onChange={onChange} />;
    case "range":
      return (
        <RangeControl
          value={value as number}
          min={def.min ?? 0}
          max={def.max ?? 100}
          step={def.step ?? 1}
          onChange={onChange}
        />
      );
  }
}

export function SettingControl({ def, value, onChange, onReset, isModified }: SettingControlProps) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[var(--text-primary)]">{def.label}</div>
        {def.description && (
          <div className="mt-0.5 text-[13px] text-[var(--text-muted)]">{def.description}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onReset}
          tabIndex={isModified ? 0 : -1}
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-subtle-strong)] hover:text-[var(--text-primary)] ${
            isModified ? "" : "invisible pointer-events-none"
          }`}
          title="Reset to default"
        >
          Reset
        </button>
        <Control def={def} value={value} onChange={onChange} />
      </div>
    </div>
  );
}
