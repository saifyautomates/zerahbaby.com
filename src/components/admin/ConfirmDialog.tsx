import { AlertTriangle } from "lucide-react";

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Yes, do it",
  cancelLabel = "No, cancel",
  busy = false,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-foreground/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm max-h-[90dvh] overflow-y-auto overflow-x-hidden rounded-3xl border border-border bg-card p-6 text-center shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className={`mx-auto grid size-12 place-items-center rounded-full ${
            destructive ? "bg-destructive/10 text-destructive" : "bg-secondary text-primary"
          }`}
        >
          <AlertTriangle className="size-6" />
        </span>
        <h2 className="mt-4 font-display text-lg font-bold">{title}</h2>
        {message && <p className="mt-2 text-sm text-muted-foreground">{message}</p>}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-full border border-border py-2.5 text-sm font-semibold transition hover:bg-muted disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 rounded-full py-2.5 text-sm font-semibold transition disabled:opacity-60 ${
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
