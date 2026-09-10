import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Mail, Sparkles } from "lucide-react";
import { WhatsAppIcon } from "@/components/ui/BrandIcons";

interface DeveloperContactModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WHATSAPP_NUMBER = "919928010786";
const WHATSAPP_MESSAGE =
  "Hi Saify Automates, I am interested in your website development services.";
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

const EMAIL_ADDRESS = "saifyautomates@gmail.com";
const EMAIL_SUBJECT = "Website Development Services Inquiry";
const EMAIL_BODY =
  "Hi Saify Automates, I am interested in your website development services. Please share the details and pricing.";
const EMAIL_URL = `mailto:${EMAIL_ADDRESS}?subject=${encodeURIComponent(EMAIL_SUBJECT)}&body=${encodeURIComponent(EMAIL_BODY)}`;

export function DeveloperContactModal({ isOpen, onClose }: DeveloperContactModalProps) {
  const [mounted, setMounted] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keyboard navigation & accessibility: Escape to close
  useEffect(() => {
    if (!isOpen || !mounted) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Auto focus close button for accessibility
    setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, mounted, onClose]);

  if (!isOpen || !mounted) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      id="developer-contact-backdrop"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        id="developer-contact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="developer-contact-title"
        className="relative flex flex-col w-full max-w-sm rounded-2xl border border-border/80 bg-card p-6 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Accent Line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-primary to-blue-500" />

        {/* Close Button */}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          id="developer-modal-close-btn"
          className="absolute right-3.5 top-3.5 grid size-8 place-items-center rounded-full bg-muted/70 text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="size-4" />
        </button>

        {/* Header */}
        <div className="text-center pt-2 pb-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold tracking-wide mb-2">
            <Sparkles className="size-3" />
            <span>Developer Contact</span>
          </div>
          <h3
            id="developer-contact-title"
            className="font-display text-lg font-bold text-foreground"
          >
            Saify Automates
          </h3>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            Connect directly for website development, custom software, and automation services.
          </p>
        </div>

        {/* Contact Options: Exactly TWO options */}
        <div className="mt-5 space-y-2.5">
          {/* 1. WhatsApp */}
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            id="developer-contact-whatsapp"
            className="group flex items-center gap-3.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-3 transition-all duration-200 hover:border-emerald-500 hover:bg-emerald-500/[0.08] hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#25D366] text-white shadow-sm transition-transform group-hover:scale-105">
              <WhatsAppIcon className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">WhatsApp</span>
                <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 group-hover:translate-x-0.5 transition-transform">
                  Chat now →
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">+91 99280 10786</p>
            </div>
          </a>

          {/* 2. Email */}
          <a
            href={EMAIL_URL}
            id="developer-contact-email"
            className="group flex items-center gap-3.5 rounded-xl border border-blue-500/25 bg-blue-500/[0.04] p-3 transition-all duration-200 hover:border-blue-500 hover:bg-blue-500/[0.08] hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-600 text-white shadow-sm transition-transform group-hover:scale-105">
              <Mail className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Email</span>
                <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 group-hover:translate-x-0.5 transition-transform">
                  Compose →
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                saifyautomates@gmail.com
              </p>
            </div>
          </a>
        </div>

        {/* Footer Note */}
        <p className="mt-4 text-center text-[10px] text-muted-foreground">
          Direct communication · Quick response
        </p>
      </div>
    </div>,
    document.body,
  );
}
