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
      { property: "og:title", content: "Contact Zerah Baby And Kids — Orders, Returns & Product Help" },
      { property: "og:description", content: "Order tracking, returns, sizing advice and product questions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const [sent, setSent] = useState(false);
  const { contactEmail, contactPhone, brandName, storeAddress, storeHours, mapsUrl, instagramUrl } = useSettings();



  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="font-display text-4xl font-bold">Talk to us</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Questions about an order, a size or which stroller fits your car boot? Our parent-support team replies
        within one working day.
      </p>

      <div className="mt-10 grid gap-10 md:grid-cols-[1fr_280px]">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
            toast.success("Message sent", { description: "We'll get back to you within a day." });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              Name
              <input
                required
                className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-normal outline-none focus:border-primary"
              />
            </label>
            <label className="block text-sm font-medium">
              Email
              <input
                type="email"
                required
                className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-normal outline-none focus:border-primary"
              />
            </label>
          </div>
          <label className="block text-sm font-medium">
            Order number (optional)
            <input className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-normal outline-none focus:border-primary" />
          </label>
          <label className="block text-sm font-medium">
            How can we help?
            <textarea
              required
              rows={5}
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
            <span>{contactEmail}</span>
          </div>
          <div className="flex gap-3">
            <Phone className="size-4 shrink-0 text-primary" />
            <span>{contactPhone}<br />{storeHours}</span>
          </div>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="flex gap-3 transition hover:text-primary">
            <MapPin className="size-4 shrink-0 text-primary" />
            <span>{storeAddress}</span>
          </a>
          {instagramUrl && (
            <a href={instagramUrl} target="_blank" rel="noopener noreferrer" className="flex gap-3 transition hover:text-primary">
              <Instagram className="size-4 shrink-0 text-primary" />
              <span>@zerah_kids on Instagram</span>
            </a>
          )}

        </aside>
      </div>
    </div>
  );
}
