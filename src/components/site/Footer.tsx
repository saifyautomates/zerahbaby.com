import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { MapPin, Star } from "lucide-react";
import { WhatsAppIcon, InstagramIcon, FacebookIcon } from "@/components/ui/BrandIcons";
import logo from "@/assets/zerah-logo-official.png";
import { BrandName } from "@/components/site/BrandName";
import { useCategories, useSettings } from "@/lib/store";
import { DeveloperContactModal } from "@/components/site/DeveloperContactModal";

export function Footer() {
  const [isDevModalOpen, setIsDevModalOpen] = useState(false);
  const { data: categories } = useCategories();
  const {
    brandName,
    contactEmail,
    contactPhone,
    storeAddress,
    storeHours,
    mapsUrl,
    instagramUrl,
    facebookUrl,
    whatsappUrl,
  } = useSettings();

  const waLink =
    whatsappUrl || (contactPhone ? `https://wa.me/${contactPhone.replace(/[^0-9]/g, "")}` : "");

  const socials = [
    {
      href: instagramUrl,
      label: "Instagram",
      Icon: InstagramIcon,
      colorClass:
        "bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-white shadow-[0_4px_16px_rgba(220,39,67,0.35)] hover:shadow-[0_6px_22px_rgba(220,39,67,0.5)]",
    },
    {
      href: waLink,
      label: "WhatsApp",
      Icon: WhatsAppIcon,
      colorClass:
        "bg-[#25D366] text-white shadow-[0_4px_16px_rgba(37,211,102,0.35)] hover:shadow-[0_6px_22px_rgba(37,211,102,0.5)]",
    },
    {
      href: facebookUrl,
      label: "Facebook",
      Icon: FacebookIcon,
      colorClass:
        "bg-[#1877F2] text-white shadow-[0_4px_16px_rgba(24,119,242,0.35)] hover:shadow-[0_6px_22px_rgba(24,119,242,0.5)]",
    },
  ].filter((s) => s.href);

  return (
    <footer className="mt-6 border-t border-border bg-muted/40">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Brand & Bio */}
          <div className="flex flex-col gap-2.5 lg:col-span-2">
            <Link
              to="/"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="flex items-center gap-3 w-fit focus-ring rounded-lg group transition-opacity hover:opacity-90"
            >
              <img
                src={logo}
                alt={`${brandName} logo`}
                loading="lazy"
                className="size-11 sm:size-12 object-contain drop-shadow-sm flex-shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.opacity = "0";
                }}
              />
              <BrandName size="lg" />
            </Link>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground text-pretty">
              A gentle little shop for babies and kids — clothing, toys, care and gear, chosen by
              parents.
            </p>
            {socials.length > 0 && (
              <div className="mt-2 flex gap-3">
                {socials.map(({ href, label, Icon, colorClass }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className={`group relative flex size-9 items-center justify-center rounded-full transition-all duration-300 hover:-translate-y-1 hover:scale-110 active:scale-95 ${colorClass}`}
                  >
                    <Icon className="size-4 transition-transform group-hover:scale-110" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Links & Contact */}
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:col-span-3">
            <div className="col-span-1">
              <h2 className="text-xs font-bold uppercase tracking-widest text-foreground">
                Shop & Company
              </h2>
              <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                {(categories ?? []).map((c) => (
                  <li key={c.slug}>
                    <Link
                      to="/shop"
                      search={{ category: c.slug }}
                      className="transition hover:text-primary"
                    >
                      {c.name}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link to="/about" className="transition hover:text-primary">
                    About us
                  </Link>
                </li>
                <li>
                  <Link to="/contact" className="transition hover:text-primary">
                    Contact
                  </Link>
                </li>
              </ul>
            </div>

            <div className="col-span-1">
              <h2 className="text-xs font-bold uppercase tracking-widest text-foreground">
                Legal Policies
              </h2>
              <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                <li>
                  <Link to="/privacy-policy" className="transition hover:text-primary">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link to="/terms-conditions" className="transition hover:text-primary">
                    Terms and Conditions
                  </Link>
                </li>
                <li>
                  <Link to="/cancellation-refund" className="transition hover:text-primary">
                    Cancellation and Refund
                  </Link>
                </li>
                <li>
                  <Link to="/shipping-delivery" className="transition hover:text-primary">
                    Shipping and Delivery
                  </Link>
                </li>
              </ul>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <h2 className="text-xs font-bold uppercase tracking-widest text-foreground">
                Contact Us
              </h2>
              <div className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
                <div>
                  <span className="font-semibold text-foreground">Email:</span>{" "}
                  <a
                    href={`mailto:${contactEmail}`}
                    className="transition-colors hover:text-primary"
                  >
                    {contactEmail}
                  </a>
                </div>
                <div>
                  <span className="font-semibold text-foreground">Phone:</span>{" "}
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
                </div>
                <div className="mt-2 flex flex-col items-start gap-1.5">
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-center gap-2.5 rounded-full border border-border bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground shadow-sm transition-all hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                  >
                    <MapPin className="size-4 shrink-0 text-primary transition-transform group-hover:scale-110" />
                    <span>Store Location</span>
                  </a>

                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-center gap-2.5 rounded-full border border-border bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground shadow-sm transition-all hover:border-amber-500/30 hover:bg-amber-500/5 hover:text-amber-600 dark:hover:text-amber-500"
                  >
                    <Star
                      className="size-4 shrink-0 text-amber-500 transition-transform group-hover:scale-110"
                      fill="currentColor"
                    />
                    <span>Leave a Google Review</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground">
        <div className="flex flex-col items-center justify-center gap-2 sm:flex-row sm:gap-3">
          <span>
            © {new Date().getFullYear()} {brandName}. All rights reserved.
          </span>
          <span className="hidden sm:inline">·</span>
          <button
            type="button"
            onClick={() => setIsDevModalOpen(true)}
            id="developed-by-saify-automates-btn"
            className="font-medium transition hover:text-primary underline-offset-4 hover:underline cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-sm"
            aria-haspopup="dialog"
            aria-expanded={isDevModalOpen}
          >
            Developed by Saify Automates
          </button>
        </div>
      </div>

      <DeveloperContactModal
        isOpen={isDevModalOpen}
        onClose={() => setIsDevModalOpen(false)}
      />
    </footer>
  );
}
