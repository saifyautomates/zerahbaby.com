import { useEffect, useState } from "react";
import logo from "@/assets/zerah-logo.png";
import { useSettings } from "@/lib/store";

export function SplashScreen() {
  const [show, setShow] = useState(true);
  const [fade, setFade] = useState(false);
  const { brandName } = useSettings();

  useEffect(() => {
    const hasSeen = sessionStorage.getItem("splash_seen");
    const isAdmin = window.location.pathname.startsWith("/admin");

    let fadeTimer: NodeJS.Timeout;
    let unmountTimer: NodeJS.Timeout;

    if (hasSeen || isAdmin) {
      setShow(false);
      return;
    }

    if (!hasSeen && !isAdmin) {
      sessionStorage.setItem("splash_seen", "true");

      fadeTimer = setTimeout(() => {
        setFade(true);
      }, 500); // 0.5 seconds

      unmountTimer = setTimeout(() => {
        setShow(false);
      }, 1000); // Wait for fade out
    }

    return () => {
      if (fadeTimer) clearTimeout(fadeTimer);
      if (unmountTimer) clearTimeout(unmountTimer);
    };
  }, []);

  if (!show) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background transition-opacity duration-500 ease-in-out ${
        fade ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <div className="flex flex-col items-center justify-center">
        <div className="relative splash-logo-fast flex justify-center">
          <img
            src={logo}
            alt={brandName}
            width={120}
            height={120}
            className="size-24 object-contain drop-shadow-xl sm:size-32"
          />
        </div>
        <div className="mt-8 h-1 w-32 overflow-hidden rounded-full bg-primary/20 relative splash-text-fast">
          <div className="absolute top-0 bottom-0 left-0 w-1/2 bg-primary rounded-full splash-loader" />
        </div>
      </div>
    </div>
  );
}
