import { createFileRoute } from "@tanstack/react-router";
import { Instagram, Mail, MapPin, Phone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSettings } from "@/lib/store";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact Zerah Baby And Kids — Orders, Returns & Product Help" },
      {
        name: "description",
        content:
          "Reach the Zerah Baby And Kids parent-support team for order tracking, returns, sizing advice and product questions. Reply within one working day.",
      },
      {
        property: "og:title",
        content: "Contact Zerah Baby And Kids — Orders, Returns & Product Help",
      },
      {
        property: "og:description",
        content: "Order tracking, returns, sizing advice and product questions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const [sent, setSent] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [message, setMessage] = useState("");
  const { contactEmail, contactPhone, brandName, storeAddress, storeHours, mapsUrl, instagramUrl } =
    useSettings();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const subject = encodeURIComponent(
      orderNumber
        ? `Order #${orderNumber} — Support Request from ${name}`
        : `Support Request from ${name}`,
    );
    const body = encodeURIComponent(
      `Name: ${name}\nEmail: ${email}\n${orderNumber ? `Order Number: ${orderNumber}\n` : ""}\nMessage:\n${message}`,
    );

    // Open the user's email client with pre-filled data
    window.open(`mailto:${contactEmail}?subject=${subject}&body=${body}`, "_self");

    setSent(true);
    toast.success("Opening your email client…", {
      description: "Your message details have been pre-filled. Just hit send!",
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="font-display text-4xl font-bold">Talk to us</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Questions about an order, a size or which stroller fits your car boot? Our parent-support
        team replies within one working day.
      </p>

      <div className="mt-10 grid gap-10 md:grid-cols-[1fr_280px]">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              Name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-normal outline-none focus:border-primary"
              />
            </label>
            <label className="block text-sm font-medium">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-normal outline-none focus:border-primary"
              />
            </label>
          </div>
          <label className="block text-sm font-medium">
            Order number (optional)
            <input
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-normal outline-none focus:border-primary"
            />
          </label>
          <label className="block text-sm font-medium">
            How can we help?
            <textarea
              required
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-normal outline-none focus:border-primary"
            />
          </label>
          <button className="rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">
            Send message
          </button>
          {sent && <p className="text-sm text-primary">Thanks! Your message is on its way.</p>}
        </form>

        <aside className="h-fit space-y-4 rounded-2xl border border-border p-6 text-sm">
          <p className="font-semibold">{brandName}</p>
          <div className="flex gap-3">
            <Mail className="size-4 shrink-0 text-primary" />
            <a href={`mailto:${contactEmail}`} className="transition-colors hover:text-primary">
              {contactEmail}
            </a>
          </div>
          <div className="flex gap-3">
            <Phone className="size-4 shrink-0 text-primary" />
            <div className="flex flex-col">
              <span className="leading-relaxed">
                {(contactPhone || "").split(",").map((phone, i, arr) => (
                  <span key={phone}>
                    <a
                      href={`tel:${phone.trim()}`}
                      className="transition-colors hover:text-primary"
                    >
                      {phone.trim()}
                    </a>
                    {i < arr.length - 1 && ", "}
                  </span>
                ))}
              </span>
              <span className="text-muted-foreground">{storeHours}</span>
            </div>
          </div>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex gap-3 transition hover:text-primary"
          >
            <MapPin className="size-4 shrink-0 text-primary" />
            <span>{storeAddress}</span>
          </a>
          {instagramUrl && (
            <a
              href={instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 transition hover:text-primary"
            >
              <Instagram className="size-4 shrink-0 text-primary" />
              <span>@zerah_kids on Instagram</span>
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}
