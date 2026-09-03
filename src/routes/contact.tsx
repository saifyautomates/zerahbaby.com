import { useState, useId } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/lib/store";
import {
  Mail,
  Phone,
  MapPin,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { InstagramIcon, FacebookIcon, WhatsAppIcon } from "@/components/ui/BrandIcons";


export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact Us | Zérah Baby & Kids" },
      {
        name: "description",
        content:
          "Questions about sizes, delivery or products? Contact the Zérah team. We're here to help parents with every step.",
      },
    ],
    links: [{ rel: "canonical", href: "https://zerahkids.com/contact" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: "Zérah Baby And Kid's",
          url: "https://zerahkids.com",
          email: "hello@zerahkids.com",
          telephone: ["+919057074777", "+919667571712"],
          address: {
            "@type": "PostalAddress",
            streetAddress: "80 Feet Link Rd, near Bajot Restaurant, Atwal Nagar, Gordhanpura",
            addressLocality: "Kota",
            addressRegion: "Rajasthan",
            postalCode: "324001",
            addressCountry: "IN",
          },
          openingHoursSpecification: [
            {
              "@type": "OpeningHoursSpecification",
              dayOfWeek: [
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
                "Sunday",
              ],
              opens: "10:30",
              closes: "22:00",
            },
          ],
          sameAs: ["https://www.instagram.com/zerah_kids/"],
        }),
      },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const formSessionId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [message, setMessage] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    contactEmail,
    contactPhone,
    brandName,
    storeAddress,
    storeHours,
    mapsUrl,
    instagramUrl,
    facebookUrl,
    whatsappUrl,
  } = useSettings();

  const waLink =
    whatsappUrl || (contactPhone ? `https://wa.me/${contactPhone.replace(/[^0-9]/g, "")}` : "");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;

    setFormError(null);

    const form = e.currentTarget;
    const formData = new FormData(form);
    const cleanName = (name || (formData.get("name") as string) || "").trim();
    const cleanEmail = (email || (formData.get("email") as string) || "").trim().toLowerCase();
    const cleanPhone = (phone || (formData.get("phone") as string) || "").trim();
    const cleanOrder = (orderNumber || (formData.get("orderNumber") as string) || "").trim();
    const cleanMessage = (message || (formData.get("message") as string) || "").trim();

    if (cleanName.length < 2) {
      setFormError("Please enter your full name (minimum 2 characters).");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setFormError("Please enter a valid email address.");
      return;
    }
    if (cleanMessage.length < 5) {
      setFormError("Please write your message (minimum 5 characters).");
      return;
    }

    setIsSubmitting(true);
    const idempotencyKey = `query_${formSessionId.replace(/:/g, "")}_${Date.now()}`;

    try {
      // 2. Server-side validation & persistence via RPC
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{
          data: {
            success: boolean;
            query_id: string;
            status: string;
            message?: string;
          } | null;
          error: { message: string } | null;
        }>
      )("submit_customer_query", {
        _name: cleanName,
        _email: cleanEmail,
        _message: cleanMessage,
        _order_number: cleanOrder || null,
        _phone: cleanPhone || null,
        _idempotency_key: idempotencyKey,
      });

      if (error) {
        throw new Error(error.message || "Failed to submit customer query");
      }

      const queryId = data?.query_id || "NEW";

      // Trigger asynchronous owner notification email (non-blocking)
      try {
        supabase.functions
          .invoke("send-owner-sale-notification", {
            body: {
              type: "customer_query",
              reference_id: queryId,
              customer_name: cleanName,
              customer_email: cleanEmail,
              order_number: cleanOrder || null,
              message: cleanMessage,
            },
          })
          .catch(console.error);
      } catch (err) {
        console.error(err);
      }

      setSubmittedQuery({
        id: queryId,
        name: cleanName,
        email: cleanEmail,
      });

      toast.success("Message received!", {
        description: "Our parent-support team will get back to you within 24 hours.",
      });

      // Reset form fields
      setName("");
      setEmail("");
      setPhone("");
      setOrderNumber("");
      setMessage("");
    } catch (err: unknown) {
      const errorMsg = (err as Error).message || "Could not submit your message. Please try again.";
      setFormError(errorMsg);
      toast.error("Submission failed", { description: errorMsg });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setSubmittedQuery(null);
    setFormError(null);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="font-display text-4xl font-bold tracking-tight">Talk to us</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Questions about an order, sizing, or finding the right product for your baby? Our
        parent-support team replies within one working day.
      </p>

      <div className="mt-10 grid gap-10 md:grid-cols-[1fr_300px]">
        {/* Customer Form or Success Card */}
        {submittedQuery ? (
          <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/5 p-8 shadow-sm space-y-6">
            <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-8 shrink-0" />
              <div>
                <h3 className="font-display text-xl font-bold text-foreground">
                  Thanks, {submittedQuery.name}! Your message has been received.
                </h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Reference Ticket:{" "}
                  <span className="font-mono font-semibold text-foreground">
                    #{submittedQuery.id.substring(0, 8).toUpperCase()}
                  </span>
                </p>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-muted-foreground">
              We've registered your inquiry in our support system. Our team will review your message
              and reply directly to{" "}
              <strong className="text-foreground">{submittedQuery.email}</strong> within 24 hours.
            </p>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-2.5 text-sm font-semibold transition hover:bg-muted focus:outline-none"
              >
                <MessageSquare className="size-4" />
                Send another message
              </button>
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            {formError && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs font-medium text-destructive">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Full Name <span className="text-destructive">*</span>
                <input
                  required
                  name="name"
                  type="text"
                  maxLength={150}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="e.g. Priyanshu Sharma"
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                />
              </label>

              <label className="block text-sm font-medium">
                Email Address <span className="text-destructive">*</span>
                <input
                  type="email"
                  name="email"
                  required
                  maxLength={255}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="e.g. parent@example.com"
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Phone Number (optional)
                <input
                  type="tel"
                  name="phone"
                  maxLength={20}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="e.g. 9876543210"
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                />
              </label>

              <label className="block text-sm font-medium">
                Order Number (optional)
                <input
                  type="text"
                  name="orderNumber"
                  maxLength={60}
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="e.g. ORD-1234 or POS-5678"
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                />
              </label>
            </div>

            <label className="block text-sm font-medium">
              How can we help? <span className="text-destructive">*</span>
              <textarea
                required
                name="message"
                rows={5}
                maxLength={3000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={isSubmitting}
                placeholder="Write your question, feedback or inquiry here..."
                className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60 resize-y"
              />
            </label>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60 shadow-xs cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    <span>Send message</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Contact Info Sidebar */}
        <aside className="h-fit space-y-4 rounded-3xl border border-border bg-card p-6 text-sm shadow-xs">
          <p className="font-display font-bold text-base text-foreground">{brandName}</p>
          <div className="flex gap-3 text-muted-foreground">
            <Mail className="size-4 shrink-0 text-primary mt-0.5" />
            <a
              href={`mailto:${contactEmail}`}
              className="transition-colors hover:text-primary break-all"
            >
              {contactEmail}
            </a>
          </div>
          <div className="flex gap-3 text-muted-foreground">
            <Phone className="size-4 shrink-0 text-primary mt-0.5" />
            <div className="flex flex-col">
              <span className="leading-relaxed">
                {(contactPhone || "").split(",").map((p, i, arr) => (
                  <span key={p}>
                    <a href={`tel:${p.trim()}`} className="transition-colors hover:text-primary">
                      {p.trim()}
                    </a>
                    {i < arr.length - 1 && ", "}
                  </span>
                ))}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5">{storeHours}</span>
            </div>
          </div>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex gap-3 text-muted-foreground transition hover:text-primary"
          >
            <MapPin className="size-4 shrink-0 text-primary mt-0.5" />
            <span className="text-xs leading-relaxed">{storeAddress}</span>
          </a>
          {instagramUrl && (
            <a
              href={instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 text-muted-foreground transition hover:text-[#E1306C]"
            >
              <InstagramIcon className="size-4 shrink-0 text-[#E1306C]" />
              <span>Follow us on Instagram</span>
            </a>
          )}
          {facebookUrl && (
            <a
              href={facebookUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 text-muted-foreground transition hover:text-[#1877F2]"
            >
              <FacebookIcon className="size-4 shrink-0 text-[#1877F2]" />
              <span>Connect on Facebook</span>
            </a>
          )}
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 text-muted-foreground transition hover:text-[#25D366]"
            >
              <WhatsAppIcon className="size-4 shrink-0 text-[#25D366]" />
              <span>Chat with us on WhatsApp</span>
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}
