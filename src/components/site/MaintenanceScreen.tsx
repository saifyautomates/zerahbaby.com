import { useSettings } from "@/lib/store";
import { Mail, Phone, Lock, X } from "lucide-react";
import logoUrl from "@/assets/zerah-logo.png"; // Fallback logo
import { useState, useEffect } from "react";

export function MaintenanceScreen({ onBypass }: { onBypass?: () => void }) {
  const { contactEmail: email, contactPhone: phone, settings } = useSettings();
  const [clicks, setClicks] = useState(0);
  const [showPrompt, setShowPrompt] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (clicks > 0) {
      const timer = setTimeout(() => setClicks(0), 1000); // reset clicks after 1 second
      return () => clearTimeout(timer);
    }
  }, [clicks]);

  const handleLogoClick = () => {
    const newClicks = clicks + 1;
    setClicks(newClicks);
    if (newClicks >= 5) {
      setShowPrompt(true);
      setClicks(0);
    }
  };

  const handlePasscodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passcode.trim().toLowerCase() === "saif") {
      if (onBypass) onBypass();
    } else {
      setErrorMsg("Incorrect passcode");
      setPasscode("");
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <div className="max-w-md w-full animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out flex flex-col items-center">
        {/* Logo */}
        <div
          className="mb-8 overflow-hidden rounded-2xl bg-white p-4 shadow-sm border border-border cursor-pointer select-none"
          title="Admin access"
          onClick={handleLogoClick}
        >
          <img
            src={settings?.logo_url || logoUrl}
            alt="Store Logo"
            className="h-16 w-auto object-contain"
          />
        </div>

        {/* Maintenance Message */}
        <h1 className="font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          We're upgrading!
        </h1>
        <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
          Our store is currently under maintenance as we roll out exciting new features and
          improvements. We'll be back online shortly.
        </p>

        {/* Contact Info Box */}
        <div className="mt-10 w-full rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Get in touch
          </h2>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:justify-center sm:gap-8">
            <a
              href={`mailto:${email}`}
              className="group flex items-center justify-center gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm font-medium transition hover:bg-muted"
            >
              <Mail className="size-4 text-primary group-hover:scale-110 transition-transform" />
              {email}
            </a>
            <a
              href={`tel:${phone}`}
              className="group flex items-center justify-center gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm font-medium transition hover:bg-muted"
            >
              <Phone className="size-4 text-primary group-hover:scale-110 transition-transform" />
              {phone}
            </a>
          </div>
        </div>
      </div>

      {/* Background Pattern (Subtle) */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background"></div>

      {showPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-sm rounded-3xl bg-background p-6 shadow-2xl border border-border relative">
            <button
              onClick={() => {
                setShowPrompt(false);
                setErrorMsg("");
                setPasscode("");
              }}
              className="absolute right-4 top-4 rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="size-5" />
            </button>
            <div className="mb-6 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Lock className="size-5" />
              </div>
              <h2 className="text-xl font-bold">Admin Access</h2>
            </div>
            <form onSubmit={handlePasscodeSubmit}>
              <input
                type="password"
                placeholder="Enter passcode"
                className="w-full rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/20 transition-all mb-4"
                value={passcode}
                onChange={(e) => {
                  setPasscode(e.target.value);
                  setErrorMsg("");
                }}
                autoFocus
              />
              {errorMsg && (
                <p className="mb-4 text-sm font-semibold text-destructive text-left">{errorMsg}</p>
              )}
              <button
                type="submit"
                disabled={!passcode.trim()}
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50"
              >
                Unlock
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
