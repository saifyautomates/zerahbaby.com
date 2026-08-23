//
import { Link } from "@tanstack/react-router";
import { Instagram, Facebook, MapPin, MessageCircle } from "lucide-react";
import logo from "@/assets/zerah-logo.png";
import { useCategories, useSettings } from "@/lib/store";

export function Footer() {
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

  const socials = [
    { href: instagramUrl, label: "Instagram", Icon: Instagram },
    { href: facebookUrl, label: "Facebook", Icon: Facebook },
    { href: whatsappUrl, label: "WhatsApp", Icon: MessageCircle },
  ].filter((s) => s.href);

  return (
    <footer className="mt-20 border-t border-border bg-muted/40">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2">
            <img
              src={logo}
              alt={`${brandName} logo`}
              loading="lazy"
              width={40}
              height={40}
              className="size-10 object-contain rounded-full"
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0";
              }}
            />
            <span className="font-display text-lg font-bold">{brandName}</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground text-pretty">
            A gentle little shop for babies and kids — clothing, toys, care and gear, chosen by
            parents.
          </p>
          {socials.length > 0 && (
            <div className="mt-4 flex gap-2">
              {socials.map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="rounded-full border border-border p-2 transition hover:bg-primary hover:text-primary-foreground"
                >
                  <Icon className="size-4" />
                </a>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-foreground">
            Shop & Company
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
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

        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-foreground">
            Legal Policies
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
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

        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-foreground">
            Contact Us
          </h2>
          <div className="mt-4 flex flex-col gap-2.5 text-sm text-muted-foreground">
            <div>
              <span className="font-semibold text-foreground">Email:</span>{" "}
              <a href={`mailto:${contactEmail}`} className="transition-colors hover:text-primary">
                {contactEmail}
              </a>
            </div>
            <div>
              <span className="font-semibold text-foreground">Contact NO. :</span>{" "}
              {(contactPhone || "").split(",").map((phone, i, arr) => (
                <span key={phone}>
                  <a href={`tel:${phone.trim()}`} className="transition-colors hover:text-primary">
                    {phone.trim()}
                  </a>
                  {i < arr.length - 1 && ", "}
                </span>
              ))}
            </div>
          </div>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex gap-2 text-xs text-muted-foreground transition hover:text-primary"
          >
            <MapPin className="size-4 shrink-0 text-primary" />
            <span>
              {storeAddress}
              <br />
              {storeHours}
            </span>
          </a>
        </div>
      </div>

      <div className="border-t border-border px-4 py-6 text-center text-xs text-muted-foreground">
        <div className="flex flex-col items-center justify-center gap-2 sm:flex-row sm:gap-3">
          <span>
            © {new Date().getFullYear()} {brandName}. All rights reserved.
          </span>
          <span className="hidden sm:inline">·</span>
          <a
            href="mailto:saifyautomates@gmail.com?subject=Inquiry%20for%20Website%20Services&body=Hi%20Saify%20Automates,%0D%0A%0D%0AI%20am%20interested%20in%20getting%20a%20world-class%20website%20built.%20Please%20let%20me%20know%20how%20we%20can%20proceed.%0D%0A%0D%0AThanks!"
            className="font-medium transition hover:text-primary"
          >
            Developed by Saify Automates
          </a>
        </div>
      </div>
    </footer>
  );
}
