import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string; color?: string };
/** App-owned select: the OS never creates a popup. Focus stays on the trigger. */
export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
  display,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange(value: string): void;
  disabled?: boolean;
  display?: ReactNode;
}) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 160,
    maxHeight: 280,
  });
  const selected = options.find((o) => o.value === value);
  const close = () => setOpen(false);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const height = Math.min(options.length * 34 + 10, 280);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < height && above > below;
      const maxHeight = Math.max(60, Math.min(height, upwards ? above : below));
      const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: upwards ? rect.top - maxHeight - 4 : rect.bottom + 4,
        width,
        maxHeight,
      });
    };
    place();
    const outside = (e: PointerEvent) => {
      if (
        !trigger.current?.contains(e.target as Node) &&
        !popup.current?.contains(e.target as Node)
      )
        close();
    };
    const scroll = (e: Event) => {
      if (!popup.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useEffect(() => {
    if (open)
      popup.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);
  const choose = (index: number) => {
    if (options[index]) onChange(options[index].value);
    close();
    trigger.current?.focus();
  };
  const show = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  };
  return (
    <div className="custom-select">
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        className={`select-trigger ${open ? "open" : ""}`}
        onClick={() => (open ? close() : show())}
        onBlur={close}
        onKeyDown={(e) => {
          if (
            [
              "ArrowDown",
              "ArrowUp",
              "Home",
              "End",
              "Enter",
              " ",
              "Escape",
            ].includes(e.key)
          ) {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Escape") {
              close();
              return;
            }
            if (!open) {
              show();
              return;
            }
            if (e.key === "Enter" || e.key === " ") choose(active);
            else if (e.key === "Home") setActive(0);
            else if (e.key === "End") setActive(options.length - 1);
            else
              setActive(
                (i) =>
                  (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) %
                  options.length,
              );
          } else if (e.key === "Tab") close();
          else if (
            e.key.length === 1 &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey
          ) {
            e.stopPropagation();
            const next = options.findIndex((o) =>
              o.label.toLowerCase().startsWith(e.key.toLowerCase()),
            );
            if (next >= 0) {
              setActive(next);
              setOpen(true);
            }
          }
        }}
      >
        {display || (
          <>
            {selected?.color && (
              <span
                className="color-dot"
                style={{ background: selected.color }}
              />
            )}
            <span className="select-label">{selected?.label || label}</span>
            <ChevronDown size={12} />
          </>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            role="listbox"
            aria-label={label}
            id={id}
            className="select-popup"
            style={position}
            data-popup
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                id={`${id}-${index}`}
                tabIndex={-1}
                data-index={index}
                className={`select-option ${index === active ? "highlighted" : ""}`}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                {option.color && (
                  <span
                    className="color-dot"
                    style={{ background: option.color }}
                  />
                )}
                <span>{option.label}</span>
                {option.value === value && <Check size={13} />}
              </button>
            ))}
          </div>,
          trigger.current?.closest('[role="dialog"]') || document.body,
        )}
    </div>
  );
}
