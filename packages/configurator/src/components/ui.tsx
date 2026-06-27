/// <reference lib="dom" />
import type { JSX } from "solid-js";

/** Bouton stylé Tailwind-friendly, autonome (inline styles de secours). */
export function Button(props: {
  children: JSX.Element;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  class?: string;
}) {
  const variant = () => props.variant ?? "primary";
  const cls = () => {
    const base =
      "ml-cfg-btn inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
    const v =
      variant() === "primary"
        ? "bg-indigo-600 text-white hover:bg-indigo-700"
        : variant() === "secondary"
          ? "bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-300"
          : "bg-transparent text-gray-600 hover:bg-gray-100";
    return `${base} ${v} ${props.class ?? ""}`;
  };
  const bg = () =>
    variant() === "primary"
      ? "#4f46e5"
      : variant() === "secondary"
        ? "#f3f4f6"
        : "transparent";
  const color = () => (variant() === "primary" ? "#ffffff" : "#1f2937");
  return (
    <button
      type={props.type ?? "button"}
      class={cls()}
      disabled={props.disabled}
      onClick={() => props.onClick?.()}
      style={{
        background: bg(),
        color: color(),
        border:
          variant() === "secondary" ? "1px solid #d1d5db" : "1px solid transparent",
        "border-radius": "6px",
        padding: "8px 16px",
        "font-size": "14px",
        "font-weight": "500",
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? "0.5" : "1",
      }}
    >
      {props.children}
    </button>
  );
}

export function Field(props: { label: string; children: JSX.Element }) {
  return (
    <label
      class="ml-cfg-field"
      style={{ display: "block", "margin-bottom": "12px" }}
    >
      <span
        style={{
          display: "block",
          "font-size": "13px",
          "font-weight": "600",
          color: "#374151",
          "margin-bottom": "4px",
        }}
      >
        {props.label}
      </span>
      {props.children}
    </label>
  );
}
