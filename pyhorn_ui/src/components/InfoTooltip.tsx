import React, { useState, useRef } from "react";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
}

export default function InfoTooltip({ content, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (e: React.MouseEvent) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Position top-right of the trigger element, adjusted to stay in viewport
    const vw = window.innerWidth;
    const tooltipW = 320;
    const left = Math.min(rect.right, vw - tooltipW - 8);
    setPos({ x: left, y: rect.top });
    setVisible(true);
  };

  const hide = () => {
    timeoutRef.current = setTimeout(() => setVisible(false), 200);
  };

  const child = React.cloneElement(children, {
    onMouseEnter: show,
    onMouseLeave: hide,
    style: { cursor: "help", ...children.props.style },
  });

  return (
    <>
      {child}
      {visible && (
        <div
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            transform: "translateY(-8px)",
            background: "#1a1a2e",
            border: "1px solid var(--border, #30363d)",
            borderRadius: "8px",
            padding: "10px 14px",
            maxWidth: "320px",
            zIndex: 9999,
            pointerEvents: "none",
            boxShadow: "0 6px 20px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ fontSize: "11.5px", color: "#e6edf3", lineHeight: 1.55 }}>
            {content}
          </div>
        </div>
      )}
    </>
  );
}