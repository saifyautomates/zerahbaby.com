import { WhatsAppIcon, InstagramIcon } from "@/components/ui/BrandIcons";
import { useSettings } from "@/lib/store";

export function FloatingSocials() {
  const { instagramUrl, whatsappUrl, contactPhone } = useSettings();

  const phoneOnly = (contactPhone || "").split(",")[0]?.replace(/[^0-9]/g, "") || "919057074777";
  const formattedPhone = phoneOnly.startsWith("91") ? phoneOnly : `91${phoneOnly}`;
  const waLink =
    whatsappUrl && whatsappUrl.trim().length > 0
      ? whatsappUrl.startsWith("http") || whatsappUrl.startsWith("wa.me")
        ? whatsappUrl.startsWith("http")
          ? whatsappUrl
          : `https://${whatsappUrl}`
        : `https://wa.me/${whatsappUrl.replace(/[^0-9]/g, "")}`
      : `https://wa.me/${formattedPhone}`;

  const igLink = instagramUrl || "https://www.instagram.com/zerah_kids/";

  return (
    <aside
      aria-label="Social and messaging quick links"
      className="fixed bottom-6 left-6 z-40 flex flex-col items-center gap-3 print:hidden"
    >
      {/* Instagram Floating Button */}
      {igLink && (
        <a
          href={igLink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Follow Zérah on Instagram"
          title="Follow us on Instagram"
          className="group relative flex size-12 items-center justify-center rounded-full bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-white shadow-[0_4px_16px_rgba(220,39,67,0.35)] transition-all duration-300 hover:scale-110 hover:shadow-[0_6px_22px_rgba(220,39,67,0.5)] active:scale-95"
        >
          <InstagramIcon className="size-6 transition-transform group-hover:scale-110" />
          <span className="pointer-events-none absolute left-14 whitespace-nowrap rounded-lg bg-black/80 px-2.5 py-1 text-xs font-semibold text-white opacity-0 shadow-md backdrop-blur-xs transition-opacity duration-200 group-hover:opacity-100">
            Follow on Instagram
          </span>
        </a>
      )}

      {/* WhatsApp Floating Button */}
      {waLink && (
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat with Zérah on WhatsApp"
          title="Chat on WhatsApp"
          className="group relative flex size-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_4px_16px_rgba(37,211,102,0.35)] transition-all duration-300 hover:scale-110 hover:shadow-[0_6px_22px_rgba(37,211,102,0.5)] active:scale-95"
        >
          <WhatsAppIcon className="size-6 transition-transform group-hover:scale-110" />
          <span className="pointer-events-none absolute left-14 whitespace-nowrap rounded-lg bg-black/80 px-2.5 py-1 text-xs font-semibold text-white opacity-0 shadow-md backdrop-blur-xs transition-opacity duration-200 group-hover:opacity-100">
            Chat on WhatsApp
          </span>
        </a>
      )}
    </aside>
  );
}
