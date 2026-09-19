import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { createPortal } from "react-dom";
const palette = [
  "#3B82F6",
  "#EF4444",
  "#22C55E",
  "#F59E0B",
  "#A78BFA",
  "#EC4899",
  "#14B8A6",
  "#E8793E",
  "#60A5FA",
  "#F87171",
  "#86EFAC",
  "#FCD34D",
  "#C4B5FD",
  "#F9A8D4",
  "#5EEAD4",
  "#808080",
];
export function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(color: string): void;
}) {
  const root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [hex, setHex] = useState(value);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useEffect(() => {
    setHex(value);
  }, [value]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (
        !root.current?.contains(e.target as Node) &&
        !popup.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    if (open) document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      className="color-picker"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        className="color-trigger"
        onClick={() => {
          const rect = button.current!.getBoundingClientRect();
          setPosition({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 240)),
            top: Math.max(
              8,
              Math.min(rect.bottom + 4, window.innerHeight - 180),
            ),
          });
          setOpen(!open);
        }}
      >
        <span style={{ background: value }} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            style={position}
            className="color-popup"
            role="group"
            aria-label={label}
            data-popup
          >
            <div className="swatch-grid">
              {palette.map((color) => (
                <button
                  type="button"
                  key={color}
                  aria-label={`Use ${color}`}
                  aria-pressed={color.toLowerCase() === value.toLowerCase()}
                  style={{ background: color }}
                  onClick={() => {
                    onChange(color);
                    setOpen(false);
                    button.current?.focus();
                  }}
                >
                  {color.toLowerCase() === value.toLowerCase() && (
                    <Check size={13} />
                  )}
                </button>
              ))}
            </div>
            <label>
              Custom hex
              <input
                aria-label="Custom Category color"
                value={hex}
                maxLength={7}
                onChange={(e) => {
                  setHex(e.target.value);
                  if (/^#[0-9a-f]{6}$/i.test(e.target.value))
                    onChange(e.target.value);
                }}
                placeholder="#3B82F6"
              />
            </label>
          </div>,
          button.current?.closest('[role="dialog"]') || document.body,
        )}
    </div>
  );
}
