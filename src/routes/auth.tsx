//
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import logo from "@/assets/zerah-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import { useCart } from "@/lib/cart";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Zerah Baby And Kid's" },
      {
        name: "description",
        content: "Sign in securely with a one-time password.",
      },
      { property: "og:title", content: "Sign in — Zerah Baby And Kid's" },
      { property: "og:description", content: "Sign in securely with a one-time password." },
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

  // States: 'input' -> entering contact info, 'verify' -> entering OTP
  const [mode, setMode] = useState<"input" | "verify">("input");

  // We use a single input for both Email and Phone
  const [contact, setContact] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [cooldown]);

  // We determine if it's an email or phone based on a simple regex
  const isEmail = contact.includes("@");

  useEffect(() => {
    // If the user is logged in, redirect them
    if (user) navigate({ to: items.length > 0 ? "/checkout" : "/", replace: true });
  }, [user, items.length, navigate]);

  async function onResendOtp() {
    if (cooldown > 0) return;

    setBusy(true);
    try {
      let phone = contact.trim();
      if (!isEmail && !phone.startsWith("+")) {
        phone = `+91${phone}`;
      }

      if (isEmail) {
        const { error } = await supabase.auth.signInWithOtp({
          email: contact.trim(),
          options: { shouldCreateUser: true },
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.functions.invoke("msg91-auth", {
          body: { action: "resend", phone },
        });

        if (error) throw error;
        if (data.error) throw new Error(data.error);
      }

      toast.success("OTP resent successfully!");
      setCooldown(60);
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to resend OTP");
    } finally {
      setBusy(false);
    }
  }

  async function onSendOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!contact.trim()) {
      toast.error("Please enter an email or phone number");
      return;
    }

    setBusy(true);
    try {
      if (isEmail) {
        const { error } = await supabase.auth.signInWithOtp({
          email: contact.trim(),
          options: {
            // No redirect, we handle it purely in-app with the code
            shouldCreateUser: true,
          },
        });
        if (error) throw error;
        toast.success("OTP sent to your email!");
      } else {
        // Assume phone number.
        let phone = contact.trim();
        if (!phone.startsWith("+")) {
          phone = `+91${phone}`; // Default to India for this store
        }

        const { data, error } = await supabase.functions.invoke("msg91-auth", {
          body: { action: "send", phone },
        });

        if (error) throw error;
        if (data.error) throw new Error(data.error);

        toast.success("OTP sent to your phone via SMS!");
        setCooldown(60); // 60 seconds cooldown for resend
      }
      setMode("verify");
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to send OTP");
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!otp.trim()) {
      toast.error("Please enter the OTP");
      return;
    }

    setBusy(true);
    try {
      let phone = contact.trim();
      if (!isEmail && !phone.startsWith("+")) {
        phone = `+91${phone}`;
      }

      if (isEmail) {
        const { error } = await supabase.auth.verifyOtp({
          email: contact.trim(),
          token: otp.trim(),
          type: "email",
        });
        if (error) throw error;
      } else {
        // Phone OTP verification via Edge Function
        const { data, error } = await supabase.functions.invoke("msg91-auth", {
          body: { action: "verify", phone, otp: otp.trim() },
        });

        if (error) throw error;
        if (data.error) throw new Error(data.error);

        // Edge function returns the session object. We set it locally.
        const sessionError = await supabase.auth.setSession(data.session);
        if (sessionError.error) throw sessionError.error;
      }
      toast.success("Signed in successfully!");
      // The session hook will automatically redirect them in the useEffect
    } catch (err: unknown) {
      toast.error((err as Error).message || "Invalid OTP code");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogleSignIn() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Redirect back to /auth so the session listener picks it up
        redirectTo: `${window.location.origin}/auth`,
        queryParams: {
          access_type: "offline",
          prompt: "select_account",
        },
      },
    });

    if (error) {
      setBusy(false);
      toast.error("Google sign-in failed: " + error.message);
    }
    // Google will redirect the page — no further action needed here
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-3xl border border-border bg-card p-8">
        <img
          src={logo}
          alt="Zerah Baby And Kid's logo"
          width={64}
          height={64}
          className="mx-auto mb-6 size-16 object-contain rounded-full"
          onError={(e) => {
            (e.target as HTMLImageElement).style.opacity = "0";
          }}
        />
        <h1 className="mt-4 text-center font-display text-2xl font-bold">
          {mode === "input" ? "Sign in to Zerah" : "Enter OTP"}
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {mode === "input"
            ? "Enter your email or mobile number to continue"
            : `We sent a secure code to ${contact}`}
        </p>

        {mode === "input" ? (
          <form onSubmit={onSendOtp} className="mt-6 space-y-4">
            <input
              type="text"
              required
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Email or Mobile Number"
              aria-label="Email or Mobile Number"
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
            />

            <button
              disabled={busy || !contact}
              className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Sending OTP..." : "Get OTP"}
            </button>
          </form>
        ) : (
          <form onSubmit={onVerifyOtp} className="mt-6 space-y-4">
            <input
              type="text"
              required
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="6-digit code"
              aria-label="OTP Code"
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-center text-xl tracking-widest outline-none focus:border-primary"
            />

            <button
              disabled={busy || otp.length < 6}
              className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Verifying..." : "Verify & Sign In"}
            </button>

            <div className="flex items-center justify-between px-2 pt-2 text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => setMode("input")}
                className="font-medium hover:text-primary"
              >
                Change {isEmail ? "email" : "number"}
              </button>
              <button
                type="button"
                onClick={onResendOtp}
                disabled={busy || cooldown > 0}
                className="font-medium text-primary hover:underline disabled:opacity-50 disabled:hover:no-underline"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
              </button>
            </div>
          </form>
        )}

        {mode === "input" && (
          <div className="mt-8 space-y-4">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onGoogleSignIn}
              disabled={busy}
              className="w-full rounded-full border border-border bg-background py-3 text-sm font-semibold transition hover:bg-muted disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                <path
                  d="M12.0003 4.75C13.7703 4.75 15.3553 5.36002 16.6053 6.54998L20.0303 3.125C17.9502 1.19 15.2353 0 12.0003 0C7.31028 0 3.25527 2.69 1.28027 6.60998L5.27028 9.70498C6.21525 6.86002 8.87028 4.75 12.0003 4.75Z"
                  fill="#EA4335"
                />
                <path
                  d="M23.49 12.275C23.49 11.49 23.415 10.73 23.3 10H12V14.51H18.47C18.18 15.99 17.34 17.25 16.08 18.1L19.945 21.1C22.2 19.01 23.49 15.92 23.49 12.275Z"
                  fill="#4285F4"
                />
                <path
                  d="M5.26498 14.2949C5.02498 13.5699 4.88501 12.7999 4.88501 11.9999C4.88501 11.1999 5.01998 10.4299 5.26498 9.7049L1.275 6.60986C0.46 8.22986 0 10.0599 0 11.9999C0 13.9399 0.46 15.7699 1.28 17.3899L5.26498 14.2949Z"
                  fill="#FBBC05"
                />
                <path
                  d="M12.0004 24.0001C15.2404 24.0001 17.9654 22.935 19.9454 21.095L16.0804 18.095C15.0054 18.82 13.6204 19.245 12.0004 19.245C8.8704 19.245 6.21537 17.135 5.26538 14.29L1.27539 17.385C3.25539 21.31 7.3104 24.0001 12.0004 24.0001Z"
                  fill="#34A853"
                />
              </svg>
              Google
            </button>
          </div>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-primary">
            ← Back to the store
          </Link>
        </p>
      </div>
    </div>
  );
}
