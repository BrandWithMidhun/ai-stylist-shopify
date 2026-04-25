// 3-dot action menu for a single product card.
//
// Two-menu pattern, intentionally:
//   - WorkflowBar uses Polaris <s-menu> (command-for / popovertarget). That
//     pattern works well for ONE stable trigger that hands off to the
//     browser's native popover positioning.
//   - Per-card menus need many short-lived, dynamically-positioned triggers
//     with payloads bound to the row. Routing every card through <s-menu>
//     would require per-card DOM ids and brittle anchoring. A small custom
//     div + click-outside hook is simpler and keeps the card body the
//     primary click target. Future contributors: this divergence is
//     deliberate — don't unify them just for consistency's sake.
//
// Items: Generate tags / Mark Human Reviewed / Edit tags.
// Exclude lives on the card body (separate visible button) — frequency of
// use justifies the separate placement (005d clarification C).
//
// The dropdown is rendered via createPortal to document.body so it escapes
// the card's overflow:hidden image wrapper and any sibling z-index stacks.
// Position is computed from the trigger's getBoundingClientRect; the menu
// closes on scroll/resize rather than tracking the trigger live.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type MenuItemSpec = {
  key: "generate" | "mark_reviewed" | "edit";
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  hint?: string;
};

type Props = {
  productId: string;
  canGenerate: boolean;
  canMarkReviewed: boolean;
  generating: boolean;
  onGenerate: () => void;
  onMarkReviewed: () => void;
  onEdit: () => void;
};

type PopoverPosition = { top: number; right: number };

export function ProductCardMenu({
  productId,
  canGenerate,
  canMarkReviewed,
  generating,
  onGenerate,
  onMarkReviewed,
  onEdit,
}: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const computePosition = (): PopoverPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    // eslint-disable-next-line no-undef
    const viewportWidth = window.innerWidth;
    return {
      top: rect.bottom + 4,
      right: Math.max(8, viewportWidth - rect.right),
    };
  };

  useLayoutEffect(() => {
    if (!open) return;
    setPosition(computePosition());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current && triggerRef.current.contains(target)) return;
      if (popRef.current && popRef.current.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onScrollOrResize = () => setOpen(false);
    // eslint-disable-next-line no-undef
    document.addEventListener("mousedown", onDown);
    // eslint-disable-next-line no-undef
    document.addEventListener("keydown", onKey);
    // eslint-disable-next-line no-undef
    window.addEventListener("scroll", onScrollOrResize, true);
    // eslint-disable-next-line no-undef
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      // eslint-disable-next-line no-undef
      document.removeEventListener("mousedown", onDown);
      // eslint-disable-next-line no-undef
      document.removeEventListener("keydown", onKey);
      // eslint-disable-next-line no-undef
      window.removeEventListener("scroll", onScrollOrResize, true);
      // eslint-disable-next-line no-undef
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  const items: MenuItemSpec[] = [
    {
      key: "generate",
      label: generating ? "Generating…" : "Generate tags",
      disabled: !canGenerate || generating,
      hint: !canGenerate ? "Nothing left to tag" : undefined,
      onSelect: () => {
        setOpen(false);
        onGenerate();
      },
    },
    {
      key: "mark_reviewed",
      label: "Mark human reviewed",
      disabled: !canMarkReviewed,
      hint: !canMarkReviewed ? "Already reviewed or no tags" : undefined,
      onSelect: () => {
        setOpen(false);
        onMarkReviewed();
      },
    },
    {
      key: "edit",
      label: "Edit tags",
      onSelect: () => {
        setOpen(false);
        onEdit();
      },
    },
  ];

  // eslint-disable-next-line no-undef
  const portalTarget = typeof document !== "undefined" ? document.body : null;

  return (
    <>
      <style>{`
        .pcm-trigger-${productId} {
          display: inline-flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; border-radius: 6px;
          background: rgba(255,255,255,0.92); border: 1px solid #e1e3e5;
          font-size: 18px; line-height: 1; cursor: pointer; padding: 0;
        }
        .pcm-trigger-${productId}:hover { background: #f6f6f7; }
      `}</style>
      <button
        ref={triggerRef}
        type="button"
        className={`pcm-trigger-${productId}`}
        aria-label="Product actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && portalTarget && position
        ? createPortal(
            <div
              ref={popRef}
              role="menu"
              tabIndex={-1}
              data-pcm-pop={productId}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              style={{
                position: "fixed",
                top: position.top,
                right: position.right,
                minWidth: 200,
                zIndex: 1000,
                background: "#fff",
                border: "1px solid #e1e3e5",
                borderRadius: 8,
                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                padding: 4,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <style>{`
                [data-pcm-pop="${productId}"] .pcm-item {
                  text-align: left; background: transparent; border: none;
                  padding: 8px 10px; border-radius: 4px; cursor: pointer;
                  font: inherit; color: #202223;
                }
                [data-pcm-pop="${productId}"] .pcm-item:hover:not(:disabled) { background: #f1f2f3; }
                [data-pcm-pop="${productId}"] .pcm-item:disabled { color: #8c9196; cursor: not-allowed; }
                [data-pcm-pop="${productId}"] .pcm-hint { display: block; font-size: 11px; color: #8c9196; margin-top: 2px; }
              `}</style>
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className="pcm-item"
                  disabled={item.disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!item.disabled) item.onSelect();
                  }}
                >
                  {item.label}
                  {item.hint ? <span className="pcm-hint">{item.hint}</span> : null}
                </button>
              ))}
            </div>,
            portalTarget,
          )
        : null}
    </>
  );
}
