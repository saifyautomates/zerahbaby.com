import { Link } from "@tanstack/react-router";
import { Instagram, Facebook, MapPin, MessageCircle } from "lucide-react";
import logo from "@/assets/zerah-logo.png";
import { useCategories, useSettings } from "@/lib/store";

export function Footer() {
  const { data: categories } = useCategories();
  const { brandName, contactEmail, contactPhone, storeAddress, storeHours, mapsUrl, instagramUrl, facebookUrl, whatsappUrl } =
    useSettings();

  const socials = [
    { href: instagramUrl, label: "Instagram", Icon: Instagram },
    { href: facebookUrl, label: "Facebook", Icon: Facebook },
    { href: whatsappUrl, label: "WhatsApp", Icon: MessageCircle },
  ].filter((s) => s.href);

  return (
    <footer className="mt-20 border-t border-border bg-muted/50">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <img src={logo} alt={`${brandName} logo`} loading="lazy" width={40} height={40} className="size-10 object-contain" />
            <span className="font-display text-lg font-bold">{brandName}</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            A gentle little shop for babies and kids — clothing, toys, care and gear, chosen by parents.
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
          <h2 className="text-sm font-semibold">Shop</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {(categories ?? []).map((c) => (
              <li key={c.slug}>
                <Link to="/shop" search={{ category: c.slug }} className="transition hover:text-primary">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-semibold">Company</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link to="/about" className="transition hover:text-primary">About us</Link></li>
            <li><Link to="/contact" className="transition hover:text-primary">Contact</Link></li>
            <li><Link to="/shop" className="transition hover:text-primary">All products</Link></li>
            <li><Link to="/cart" className="transition hover:text-primary">Your bag</Link></li>
            <li><Link to="/returns" className="transition hover:text-primary">Refund &amp; Return Policy</Link></li>
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-semibold">Stay in the loop</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Weekly parenting tips and early access to sales.
          </p>
          <form className="mt-4 flex gap-2" onSubmit={(e) => e.preventDefault()}>
            <input
              type="email"
              required
              placeholder="you@email.com"
              aria-label="Email address"
              className="w-full rounded-full border border-border bg-background px-4 py-2 text-sm outline-none focus:border-primary"
            />
            <button className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">
              Join
            </button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            {contactEmail} · {contactPhone}
          </p>
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

      <div className="border-t border-border py-5 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} {brandName}. All rights reserved.
      </div>
    </footer>
  );
}
