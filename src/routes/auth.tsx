import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import logo from "@/assets/zerah-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useSession } from "@/lib/auth";
import { useCart } from "@/lib/cart";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Zerah Baby And Kids" },
      { name: "description", content: "Sign in to manage the Zerah Baby And Kids store catalogue and settings." },
      { property: "og:title", content: "Sign in — Zerah Baby And Kids" },
      { property: "og:description", content: "Store team sign in for Zerah Baby And Kids." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const { items } = useCart();
  const [tab, setTab] = useState<"email" | "phone">("email");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: items.length > 0 ? "/checkout" : "/", replace: true });
  }, [user, items.length, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Signed in");
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/admin" },
        });
        if (error) throw error;
        if (!data.session) toast.success("Check your email to confirm your account");
        else toast.success("Account created");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {

  function normalizedPhone() {
    const digits = phone.replace(/[^\d]/g, "");
    if (phone.trim().startsWith("+")) return "+" + digits;
    return digits.length === 10 ? "+91" + digits : "+" + digits;
  }

  async function onSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: normalizedPhone() });
      if (error) throw error;
      setOtpSent(true);
      toast.success("OTP sent to " + normalizedPhone());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the OTP");
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: normalizedPhone(),
        token: otp,
        type: "sms",
      });
      if (error) throw error;
      toast.success("Signed in");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid or expired OTP");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogleSignIn() {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (result.error) {
      setBusy(false);
      toast.error("Google sign-in failed");
      return;
    }
    if (result.redirected) return;
    navigate({ to: items.length > 0 ? "/checkout" : "/" });
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-3xl border border-border bg-card p-8">
        <img src={logo} alt="Zerah Baby And Kids logo" width={64} height={64} className="mx-auto size-16 object-contain" />
        <h1 className="mt-4 text-center font-display text-2xl font-bold">
          {tab === "phone" ? "Sign in with your phone" : mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">Sign in to shop and track your orders</p>

        <div className="mt-6 grid grid-cols-2 gap-1 rounded-full border border-border p-1 text-sm font-semibold">
          {(["email", "phone"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                "rounded-full py-2 transition " +
                (tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")
              }
            >
              {t === "email" ? "Email" : "Phone OTP"}
            </button>
          ))}
        </div>

        {tab === "email" ? (
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            aria-label="Email"
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
          <button
            disabled={busy}
            className="w-full rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
          >
            {mode === "signin" ? "Sign in" : "Sign up"}
          </button>
        </form>
        ) : (
          <form onSubmit={otpSent ? onVerifyOtp : onSendOtp} className="mt-4 space-y-3">
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Mobile number (e.g. 9876543210)"
              aria-label="Mobile number"
              disabled={otpSent}
              className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary disabled:opacity-60"
            />
            {otpSent && (
              <input
                type="text"
                required
                inputMode="numeric"
                maxLength={8}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="6-digit OTP"
                aria-label="OTP"
                className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-center text-base tracking-[0.4em] outline-none focus:border-primary"
              />
            )}
            <button
              disabled={busy}
              className="w-full rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {otpSent ? "Verify & sign in" : "Send OTP"}
            </button>
            {otpSent && (
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setOtp("");
                }}
                className="w-full text-center text-xs text-muted-foreground hover:text-primary"
              >
                Change number
              </button>
            )}
          </form>
        )}

        <button
          onClick={onGoogleSignIn}
          disabled={busy}
          className="mt-3 w-full rounded-full border border-border py-2.5 text-sm font-semibold transition hover:bg-muted disabled:opacity-60"
        >
          Continue with Google
        </button>

        {tab === "email" && (
        <p className="mt-5 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="font-semibold text-primary hover:underline"
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
        )}
        <p className="mt-4 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-primary">← Back to the store</Link>
        </p>
      </div>
    </div>
  );
}
