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

import { useEffect, useRef, useState } from "react";

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
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (
        wrapRef.current &&
        !wrapRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // eslint-disable-next-line no-undef
    document.addEventListener("mousedown", onDown);
    // eslint-disable-next-line no-undef
    document.addEventListener("keydown", onKey);
    return () => {
      // eslint-disable-next-line no-undef
      document.removeEventListener("mousedown", onDown);
      // eslint-disable-next-line no-undef
      document.removeEventListener("keydown", onKey);
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

  return (
    <div
      ref={wrapRef}
      className={`pcm-wrap pcm-wrap-${productId}`}
    >
      <style>{`
        .pcm-wrap-${productId} { position: relative; }
        .pcm-wrap-${productId} .pcm-trigger {
          display: inline-flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; border-radius: 6px;
          background: rgba(255,255,255,0.92); border: 1px solid #e1e3e5;
          font-size: 18px; line-height: 1; cursor: pointer; padding: 0;
        }
        .pcm-wrap-${productId} .pcm-trigger:hover { background: #f6f6f7; }
        .pcm-wrap-${productId} .pcm-pop {
          position: absolute; right: 0; top: calc(100% + 4px);
          min-width: 200px; z-index: 5;
          background: #fff; border: 1px solid #e1e3e5; border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          padding: 4px; display: flex; flex-direction: column;
        }
        .pcm-wrap-${productId} .pcm-item {
          text-align: left; background: transparent; border: none;
          padding: 8px 10px; border-radius: 4px; cursor: pointer;
          font: inherit; color: #202223;
        }
        .pcm-wrap-${productId} .pcm-item:hover:not(:disabled) { background: #f1f2f3; }
        .pcm-wrap-${productId} .pcm-item:disabled { color: #8c9196; cursor: not-allowed; }
        .pcm-wrap-${productId} .pcm-hint { display: block; font-size: 11px; color: #8c9196; margin-top: 2px; }
      `}</style>
      <button
        type="button"
        className="pcm-trigger"
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
      {open ? (
        <div role="menu" className="pcm-pop">
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
        </div>
      ) : null}
    </div>
  );
}
