/**
 * Accessible progress bar (Polaris web components have none). Uses the
 * admin's success and critical colours.
 */
export function ProgressBar({ value, label, tone = "success" }: { value: number; label: string; tone?: "success" | "warning" | "critical" }) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  const colour = { success: "#29845a", warning: "#b98900", critical: "#c70a24" }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      style={{ background: "#e3e3e3", borderRadius: 4, height: 8, width: "100%", minWidth: 80, overflow: "hidden" }}
    >
      <div style={{ background: colour, height: "100%", width: `${percent}%`, transition: "width 0.3s ease" }} />
    </div>
  );
}
