//
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Mail, Phone, X } from "lucide-react";
import logo from "@/assets/zerah-logo-official.png";
import { BrandName } from "@/components/site/BrandName";
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
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useSession();
  const { items } = useCart();

  // ─── Hydration Determinism ──────────────────────────────────────────────────
  // Ensures SSR initial render === first client hydration render.
  // Auth resolution and redirects take place cleanly after hydration.
  const [isHydrated, setIsHydrated] = useState(false);
  const [isOAuthRedirect, setIsOAuthRedirect] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    from: "phone" | "email" | "google";
    title: string;
    text: string;
    preferredAlternative: "phone" | "email" | "google";
  } | null>(null);

  useEffect(() => {
    setIsHydrated(true);
    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const errorDesc =
        searchParams.get("error_description") ||
        hashParams.get("error_description") ||
        searchParams.get("error") ||
        hashParams.get("error");
      if (errorDesc) {
        toast.error(`Sign in failed: ${decodeURIComponent(errorDesc.replace(/\+/g, " "))}`);
        setSuggestion({
          from: "google",
          title: "Google sign-in was interrupted or unavailable",
          text: "No worries! You can sign in right away using your Mobile Number (SMS) or Email OTP.",
          preferredAlternative: "phone",
        });
      }
      if (searchParams.has("code") || window.location.hash.includes("access_token")) {
        setIsOAuthRedirect(true);
      }
    }
  }, []);

  // ─── UI State ─────────────────────────────────────────────────────────────────
  // otpLength: 6 for email (Supabase standard), 4 for phone (MSG91)
  const [mode, setMode] = useState<"input" | "verify">("input");
  const [contact, setContact] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [otpExpired, setOtpExpired] = useState(false);
  const otpInputRef = useRef<HTMLInputElement | null>(null);
  // contactInputRef: read the live DOM value as authoritative source.
  // This makes the button reliably reflect what's in the input even after
  // HMR resets React state (dev) or when Playwright fills the field.
  const contactInputRef = useRef<HTMLInputElement | null>(null);

  // ─── Interval-based countdown (avoids setTimeout chain / StrictMode double-fire)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownRef = useRef(0); // mirrors cooldown state, readable inside the interval cb

  function startCooldown(seconds: number) {
    // Always stop any existing interval before starting a new one
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    cooldownRef.current = seconds;
    setCooldown(seconds);
    intervalRef.current = setInterval(() => {
      cooldownRef.current -= 1;
      setCooldown(cooldownRef.current);
      if (cooldownRef.current <= 0) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
      }
    }, 1000);
  }

  // Clear interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Auto-focus OTP input when entering verify mode
  useEffect(() => {
    if (mode === "verify") {
      setTimeout(() => otpInputRef.current?.focus(), 100);
    }
  }, [mode]);

  // ─── Derived ──────────────────────────────────────────────────────────────────
  const isEmail = contact.includes("@");

  // Normalise phone → E.164 (+91XXXXXXXXXX for India)
  function normalisePhone(raw: string): string {
    const t = raw.trim();
    if (t.startsWith("+")) return t;
    return `+91${t.replace(/^0+/, "")}`;
  }

  // ─── Redirect when session arrives ────────────────────────────────────────────
  useEffect(() => {
    if (!isHydrated) return;
    if (!loading && user) {
      const searchParams =
        typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      const redirectTarget = searchParams?.get("redirect");

      if (
        redirectTarget &&
        redirectTarget.startsWith("/") &&
        !redirectTarget.startsWith("//") &&
        !redirectTarget.startsWith("/auth")
      ) {
        try {
          const parsed = new URL(redirectTarget, window.location.origin);
          const searchEntries = Object.fromEntries(parsed.searchParams.entries());
          navigate({
            to: parsed.pathname,
            search: Object.keys(searchEntries).length > 0 ? searchEntries : undefined,
            replace: true,
          });
        } catch {
          navigate({ to: redirectTarget, replace: true });
        }
      } else {
        navigate({ to: items.length > 0 ? "/checkout" : "/", replace: true });
      }
    }
  }, [isHydrated, user, loading, items.length, navigate]);

  // ─── SEND OTP (first time) ────────────────────────────────────────────────────
  async function onSendOtp(e: React.FormEvent) {
    e.preventDefault();
    // Use DOM value as authoritative source in case React state was reset by HMR
    const raw = (contactInputRef.current?.value ?? contact).trim();
    if (!raw || busy) return;
    if (raw !== contact) setContact(raw);

    const isRawEmail = raw.includes("@");

    if (isRawEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(raw)) {
        toast.error("Please enter a valid email address");
        return;
      }
    } else {
      const cleanPhone = raw.replace(/\D/g, "");
      if (cleanPhone.length < 10) {
        toast.error("Please enter a valid 10-digit mobile number");
        return;
      }
    }

    setBusy(true);
    try {
      if (isRawEmail) {
        const { error } = await supabase.auth.signInWithOtp({
          email: raw,
          options: { shouldCreateUser: true },
        });
        if (error) throw error;
      } else {
        const phone = normalisePhone(raw);
        const { data, error } = await supabase.functions.invoke("msg91-auth", {
          body: { action: "send", phone },
        });

        if (error) {
          throw new Error("Failed to reach auth service. Please try again.");
        }

        if (!data?.success || !data?.request_id) {
          throw new Error(
            data?.error ||
              data?.message ||
              "SMS delivery could not be confirmed by provider. Please try again.",
          );
        }
      }
      // Success: transition to verify screen
      setOtp("");
      setOtpExpired(false);
      setMode("verify");
      startCooldown(60);
      toast.success(isRawEmail ? "6-digit OTP sent to your email!" : "4-digit code sent to your mobile!");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send OTP. Please try again.");
      setSuggestion({
        from: isRawEmail ? "email" : "phone",
        title: isRawEmail ? "Email verification issue?" : "SMS delivery issue?",
        text: isRawEmail
          ? "Email delivery might be experiencing delays. You can instantly sign in using your 10-digit Mobile Number or Google 1-Click."
          : "SMS network service may be experiencing delays. You can sign in using your Email address or Google 1-Click.",
        preferredAlternative: isRawEmail ? "phone" : "email",
      });
    } finally {
      setBusy(false);
    }
  }

  // ─── RESEND OTP ───────────────────────────────────────────────────────────────
  async function onResendOtp() {
    // Hard guards — button is also disabled in JSX, this is a safety net
    if (busy || cooldown > 0) return;

    setBusy(true);
    try {
      const isContactEmail = contact.includes("@");
      // Direct call — no shared helper — guarantees a real new HTTP request
      if (isContactEmail) {
        const { error } = await supabase.auth.signInWithOtp({
          email: contact.trim(),
          options: { shouldCreateUser: true },
        });
        if (error) throw error;
      } else {
        const phone = normalisePhone(contact);
        const { data, error } = await supabase.functions.invoke("msg91-auth", {
          body: { action: "resend", phone },
        });

        if (error) {
          throw new Error("Failed to reach auth service. Please try again.");
        }

        if (!data?.success) {
          throw new Error(data?.error || data?.message || "Failed to resend OTP.");
        }
      }
      // Success: clear old state, restart countdown
      setOtp("");
      setOtpExpired(false);
      startCooldown(60);
      toast.success(isContactEmail ? "New 6-digit OTP sent to your email!" : "New 4-digit code sent to your mobile!");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to resend OTP. Please try again.");
      const isContactEmail = contact.includes("@");
      setSuggestion({
        from: isContactEmail ? "email" : "phone",
        title: isContactEmail ? "Still waiting for the email code?" : "Still waiting for SMS?",
        text: isContactEmail
          ? "Switch to your Mobile Number for an instant SMS OTP, or continue with Google."
          : "Switch to your Email Address for an instant OTP, or continue with Google.",
        preferredAlternative: isContactEmail ? "phone" : "email",
      });
    } finally {
      // Always unblock, even on error — so user can retry
      setBusy(false);
    }
  }

  // ─── VERIFY OTP ───────────────────────────────────────────────────────────────
  async function onVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    const token = otp.trim();
    const isContactEmail = contact.includes("@");
    const expectedLen = isContactEmail ? 6 : 4;
    const digitRegex = isContactEmail ? /^\d{6}$/ : /^\d{4}$/;
    if (!digitRegex.test(token) || busy) {
      if (token.length > 0 && token.length !== expectedLen) {
        toast.error(`Please enter the ${expectedLen}-digit code.`);
      }
      return;
    }

    setBusy(true);
    try {
      if (isContactEmail) {
        const { error } = await supabase.auth.verifyOtp({
          email: contact.trim(),
          token,
          type: "email",
        });
        if (error) {
          const m = error.message.toLowerCase();
          if (m.includes("expired") || m.includes("otp_expired")) {
            setOtpExpired(true);
            setOtp("");
            throw new Error("OTP has expired. Tap “Resend OTP” to get a fresh one.");
          }
          if (m.includes("already used") || m.includes("already been used")) {
            setOtpExpired(true);
            setOtp("");
            throw new Error("This OTP has already been used. Tap “Resend OTP” for a new one.");
          }
          if (
            m.includes("invalid") ||
            m.includes("incorrect") ||
            m.includes("does not match") ||
            m.includes("token")
          ) {
            throw new Error("Incorrect OTP. Please check your verification code and try again.");
          }
          if (m.includes("attempts") || m.includes("too many")) {
            throw new Error("Too many incorrect attempts. Please request a new OTP.");
          }
          throw error;
        }
      } else {
        const phone = normalisePhone(contact);
        const { data, error } = await supabase.functions.invoke("msg91-auth", {
          body: { action: "verify", phone, otp: token },
        });

        if (error) {
          let serverMsg = "";
          try {
            if ("context" in error && typeof (error as any).context?.json === "function") {
              const body = await (error as any).context.json();
              serverMsg = body?.error || body?.message || "";
            }
          } catch {
            // fallback if json parsing fails
          }

          if (serverMsg) {
            const m = serverMsg.toLowerCase();
            if (m.includes("expired")) {
              setOtpExpired(true);
              setOtp("");
              throw new Error("OTP has expired. Tap “Resend OTP” to get a fresh one.");
            }
            if (m.includes("incorrect") || m.includes("invalid") || m.includes("double-check")) {
              throw new Error("Incorrect OTP. Please double-check and try again.");
            }
            if (m.includes("too many")) {
              throw new Error("Too many incorrect attempts. Please request a new OTP.");
            }
            throw new Error(serverMsg);
          }
          throw new Error("Failed to verify OTP with server. Please try again.");
        }

        if (!data?.success) {
          const m = (data?.error || data?.message || "").toLowerCase();
          if (m.includes("expired")) {
            setOtpExpired(true);
            setOtp("");
            throw new Error("OTP has expired. Tap “Resend OTP” to get a fresh one.");
          }
          if (m.includes("invalid") || m.includes("incorrect") || m.includes("double-check")) {
            throw new Error("Incorrect OTP. Please double-check and try again.");
          }
          throw new Error(data?.error || data?.message || "Failed to verify OTP.");
        }

        if (data.session) {
          const { error: sessionError } = await supabase.auth.setSession(data.session);
          if (sessionError) throw sessionError;
        } else {
          throw new Error("Authentication failed. No session returned.");
        }
      }
      // Session is set by Supabase — useEffect watching `user` will redirect
      setSuccess(true);
      toast.success("Signed in successfully! Welcome to Zerah 🎉");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Invalid OTP. Please try again.");
      const isContactEmail = contact.includes("@");
      setSuggestion({
        from: isContactEmail ? "email" : "phone",
        title: isContactEmail
          ? "Trouble with email verification?"
          : "Trouble with SMS verification?",
        text: isContactEmail
          ? "You can also receive an OTP on your Mobile Number, or sign in directly with Google."
          : "You can also receive an OTP on your Email address, or sign in directly with Google.",
        preferredAlternative: isContactEmail ? "phone" : "email",
      });
    } finally {
      setBusy(false);
    }
  }

  // ─── CHANGE NUMBER (complete reset) ───────────────────────────────────────────
  function onChangeContact() {
    // Stop the interval first
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    cooldownRef.current = 0;
    // Reset all OTP state
    setMode("input");
    setOtp("");
    setCooldown(0);
    setOtpExpired(false);
    // Keep `contact` so user can edit rather than retype
  }

  function switchToPhone() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    cooldownRef.current = 0;
    setSuggestion(null);
    setMode("input");
    setContact("");
    setOtp("");
    setCooldown(0);
    setOtpExpired(false);
    setTimeout(() => {
      contactInputRef.current?.focus();
    }, 50);
  }

  function switchToEmail() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    cooldownRef.current = 0;
    setSuggestion(null);
    setMode("input");
    setContact("");
    setOtp("");
    setCooldown(0);
    setOtpExpired(false);
    setTimeout(() => {
      contactInputRef.current?.focus();
    }, 50);
  }

  // ─── GOOGLE SIGN-IN ───────────────────────────────────────────────────────────
  async function onGoogleSignIn() {
    if (busy) return;
    setBusy(true);
    setSuccess(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth`,
        queryParams: { access_type: "offline", prompt: "select_account" },
      },
    });
    if (error) {
      setBusy(false);
      setSuccess(false);
      toast.error("Google sign-in failed: " + error.message);
      setSuggestion({
        from: "google",
        title: "Google sign-in unavailable?",
        text: "You can sign in right away using your 10-digit Mobile Number (SMS) or Email OTP.",
        preferredAlternative: "phone",
      });
    }
    // Google will redirect — no further action needed
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────────
  // During SSR and first client hydration render (isHydrated === false),
  // always render the deterministic auth form. Client-side auth resolution / redirect
  // takes place smoothly after mount without hydration mismatch.
  if ((isHydrated && user) || (busy && mode === "verify") || success || isOAuthRedirect) {
    return (
      <div className="mx-auto flex min-h-[70vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="size-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-muted-foreground animate-pulse">
            {user ? "Redirecting..." : "Signing in..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-3xl border border-border bg-card p-8 shadow-xl">
        <div className="flex flex-col items-center justify-center mb-6">
          <img
            src={logo}
            alt="Zérah Baby & Kids"
            className="size-16 object-contain drop-shadow-md mb-3"
            onError={(e) => {
              (e.target as HTMLImageElement).style.opacity = "0";
            }}
          />
          <BrandName size="lg" align="center" />
        </div>
        <h1 className="text-center font-display text-xl font-bold">
          {mode === "input" ? "Sign In to Your Account" : `Enter ${isEmail ? "6" : "4"}-digit code`}
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {mode === "input"
            ? "Enter your email or mobile number to continue"
            : `We sent a ${isEmail ? "6" : "4"}-digit code to ${contact}`}
        </p>

        {/* ── INTELLIGENT ALTERNATIVE AUTH SUGGESTION ── */}
        {suggestion && (
          <div className="mt-5 rounded-2xl border border-primary/25 bg-primary/5 p-4 text-left transition-all duration-300 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 font-bold text-sm text-foreground">
                <Sparkles className="size-4 text-primary shrink-0" />
                <span>{suggestion.title}</span>
              </div>
              <button
                type="button"
                onClick={() => setSuggestion(null)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition"
                aria-label="Dismiss suggestion"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
              {suggestion.text}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestion.preferredAlternative === "phone" ? (
                <button
                  type="button"
                  id="auth-suggest-phone-btn"
                  onClick={switchToPhone}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground shadow-xs hover:bg-muted transition"
                >
                  <Phone className="size-3.5 text-primary" />
                  Use Mobile Number
                </button>
              ) : (
                <button
                  type="button"
                  id="auth-suggest-email-btn"
                  onClick={switchToEmail}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground shadow-xs hover:bg-muted transition"
                >
                  <Mail className="size-3.5 text-primary" />
                  Use Email Address
                </button>
              )}
              {suggestion.from !== "google" && (
                <button
                  type="button"
                  id="auth-suggest-google-btn"
                  onClick={onGoogleSignIn}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground shadow-xs hover:bg-muted transition"
                >
                  <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true">
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
                  Google 1-Click
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── INPUT MODE ── */}
        {mode === "input" ? (
          <form onSubmit={onSendOtp} className="mt-6 space-y-4">
            <div className="relative flex items-center overflow-hidden rounded-xl border border-border bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all">
              {contact.length > 0 && /^[\d+]/.test(contact) && (
                <div className="flex items-center justify-center bg-muted/30 px-3 py-3 border-r border-border text-sm font-medium text-foreground/80">
                  +91
                </div>
              )}
              <input
                id="auth-contact-input"
                ref={contactInputRef}
                type="text"
                required
                value={contact}
                onChange={(e) => {
                  let val = e.target.value;
                  if (/^[\d+]/.test(val)) {
                    val = val.replace(/^\+91\s*/, "").replace(/^\+/, "");
                  }
                  setContact(val);
                }}
                placeholder="Email or Mobile Number"
                aria-label="Email or Mobile Number"
                className="w-full bg-transparent px-4 py-3 text-sm outline-none"
              />
            </div>

            <button
              id="auth-send-otp-btn"
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Sending OTP…" : "Get OTP"}
            </button>
          </form>
        ) : (
          /* ── VERIFY MODE ── */
          <form onSubmit={onVerifyOtp} className="mt-6 space-y-4">
            {/* Expired OTP banner */}
            {otpExpired && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive text-center">
                Your OTP has expired.{" "}
                <button
                  type="button"
                  id="auth-resend-from-banner-btn"
                  onClick={onResendOtp}
                  disabled={busy || cooldown > 0}
                  className="font-semibold underline disabled:opacity-50"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Tap here to get a new one"}
                </button>
              </div>
            )}

            {isEmail && !otpExpired && (
              <div className="rounded-xl bg-amber-50 border border-amber-200/60 p-3 text-xs text-amber-800 text-center">
                📬 <strong>Check Spam / Junk Folder:</strong> If the code doesn&apos;t appear in
                your Primary inbox within 1 minute, please check your Spam or Promotions folder.
              </div>
            )}

            <input
              ref={otpInputRef}
              id="auth-otp-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              required
              maxLength={isEmail ? 6 : 4}
              value={otp}
              onChange={(e) => {
                setOtpExpired(false); // typing dismisses the banner
                const maxLen = isEmail ? 6 : 4;
                setOtp(e.target.value.replace(/\D/g, "").slice(0, maxLen));
              }}
              placeholder={`Enter ${isEmail ? "6" : "4"}-digit code`}
              aria-label={`Enter ${isEmail ? "6" : "4"}-digit code`}
              autoComplete="one-time-code"
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-center text-xl tracking-widest outline-none focus:border-primary"
            />

            <button
              id="auth-verify-otp-btn"
              type="submit"
              disabled={busy || otp.length !== (isEmail ? 6 : 4)}
              className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Verifying…" : "Verify & Sign In"}
            </button>

            <div className="flex items-center justify-between px-2 pt-2 text-sm text-muted-foreground">
              <button
                type="button"
                id="auth-change-contact-btn"
                onClick={onChangeContact}
                className="font-medium hover:text-primary"
              >
                Change {isEmail ? "email" : "number"}
              </button>
              <button
                type="button"
                id="auth-resend-otp-btn"
                onClick={onResendOtp}
                disabled={busy || cooldown > 0}
                className="font-medium text-primary hover:underline disabled:opacity-50 disabled:hover:no-underline"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
              </button>
            </div>

            {/* Quick alternative switch hint in verify mode */}
            <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <span>Didn&apos;t receive the code?</span>
              <button
                type="button"
                id="auth-verify-switch-alt-btn"
                onClick={isEmail ? switchToPhone : switchToEmail}
                className="font-semibold text-primary hover:underline"
              >
                Try {isEmail ? "Mobile SMS" : "Email"} instead
              </button>
            </div>
          </form>
        )}

        {/* ── GOOGLE 1-CLICK AUTH ── */}
        <div className="mt-8 space-y-4">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-card px-2 text-muted-foreground">
                {mode === "verify" ? "Or bypass OTP with" : "Or continue with"}
              </span>
            </div>
          </div>

          <button
            type="button"
            id="auth-google-btn"
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
            Continue with Google (1-Click)
          </button>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-primary">
            ← Back to the store
          </Link>
        </p>
      </div>
    </div>
  );
}
