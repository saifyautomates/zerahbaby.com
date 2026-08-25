import { useSettings } from "@/lib/store";
import { Mail, Phone } from "lucide-react";
import logoUrl from "@/assets/zerah-logo.png"; // Fallback logo

export function MaintenanceScreen() {
  const { contactEmail: email, contactPhone: phone, settings } = useSettings();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <div className="max-w-md w-full animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out flex flex-col items-center">
        {/* Logo */}
        <div
          className="mb-8 overflow-hidden rounded-2xl bg-white p-4 shadow-sm border border-border cursor-pointer select-none"
          title="Double tap to login as admin"
          onDoubleClick={() => {
            localStorage.setItem("bypass_maintenance", "true");
            window.location.reload();
          }}
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
    </div>
  );
}
