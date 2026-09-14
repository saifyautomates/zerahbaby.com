import React, { useEffect, useRef, useState, useCallback } from "react";
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser";
import { Camera, X, RefreshCw, Zap, ZapOff, AlertCircle, CheckCircle2, Volume2 } from "lucide-react";
import { sanitizeBarcode } from "@/lib/barcode-scanner";

interface POSCameraScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}

export function POSCameraScanner({ isOpen, onClose, onScan }: POSCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastScannedCodeRef = useRef<{ code: string; time: number }>({ code: "", time: 0 });

  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [torchActive, setTorchActive] = useState<boolean>(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState<string>("");

  const stopScanning = useCallback(() => {
    // 1. Stop ZXing detector controls
    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
      } catch (e) {
        console.warn("[POS Camera] Error stopping reader controls:", e);
      }
      controlsRef.current = null;
    }

    // 2. Stop all media stream tracks cleanly
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
      } catch (e) {
        console.warn("[POS Camera] Error stopping tracks:", e);
      }
      streamRef.current = null;
    }

    // 3. Detach from video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setTorchActive(false);
    setTorchSupported(false);
  }, []);

  const startScanning = useCallback(async () => {
    stopScanning();
    setIsInitializing(true);
    setErrorMessage(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setHasCamera(false);
      setErrorMessage("Camera access is not supported by this browser or device.");
      setIsInitializing(false);
      return;
    }

    try {
      // 1. Request camera stream with back camera preference
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setHasCamera(true);

      // Check if torch/flashlight is supported
      const track = stream.getVideoTracks()[0];
      if (track) {
        const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as Record<string, unknown>;
        if (capabilities.torch) {
          setTorchSupported(true);
        }
      }

      if (!videoRef.current) {
        setIsInitializing(false);
        return;
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});

      // 2. Attach ZXing Multi-Format Reader
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoElement(
        videoRef.current,
        (result, error) => {
          if (result) {
            const rawText = result.getText();
            const cleanCode = sanitizeBarcode(rawText || "");
            if (!cleanCode) return;

            const now = Date.now();
            // Suppress rapid duplicate scans of the exact same code within 1500ms
            if (
              lastScannedCodeRef.current.code === cleanCode &&
              now - lastScannedCodeRef.current.time < 1500
            ) {
              return;
            }

            lastScannedCodeRef.current = { code: cleanCode, time: now };
            setLastScanned(cleanCode);

            // Forward to POS barcode handler immediately
            onScan(cleanCode);
          }
        },
      );

      controlsRef.current = controls;
      setIsInitializing(false);
    } catch (err: unknown) {
      console.warn("[POS Camera] Initialization failure:", err);
      const errName = (err as { name?: string })?.name;
      if (errName === "NotAllowedError" || errName === "PermissionDeniedError") {
        setErrorMessage("Camera permission denied. Please allow camera access in your browser settings.");
      } else if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
        setErrorMessage("No video input devices found on this device.");
      } else {
        setErrorMessage(
          err instanceof Error ? err.message : "Unable to initialize camera video stream.",
        );
      }
      setIsInitializing(false);
    }
  }, [onScan, stopScanning]);

  // Torch Toggle
  const toggleTorch = async () => {
    if (!streamRef.current || !torchSupported) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const nextTorch = !torchActive;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextTorch }],
      });
      setTorchActive(nextTorch);
    } catch (e) {
      console.warn("[POS Camera] Could not toggle torch:", e);
    }
  };

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Lifecycle: start when opened, stop completely when closed
  useEffect(() => {
    if (isOpen) {
      startScanning();
    } else {
      stopScanning();
      setLastScanned(null);
      setErrorMessage(null);
    }

    return () => {
      stopScanning();
    };
  }, [isOpen, startScanning, stopScanning]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pos-camera-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
    >
      <div className="relative flex flex-col w-full max-w-lg bg-card rounded-2xl border border-border shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 bg-muted/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Camera className="size-5" />
            </div>
            <div>
              <h2 id="pos-camera-title" className="text-base font-bold text-foreground">
                Camera Barcode Scanner
              </h2>
              <p className="text-xs text-muted-foreground">
                Point camera at 1D retail barcode (EAN, UPC, Code 128)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Camera Scanner"
            className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Viewfinder Area */}
        <div className="relative aspect-4/3 w-full bg-black overflow-hidden flex items-center justify-center">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="size-full object-cover"
          />

          {/* Laser & Target Overlay */}
          {!errorMessage && !isInitializing && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-8">
              {/* Targeting box */}
              <div className="relative w-4/5 h-2/3 border-2 border-primary/70 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                {/* Corner markers */}
                <div className="absolute -top-1 -left-1 size-5 border-t-4 border-l-4 border-primary rounded-tl-md" />
                <div className="absolute -top-1 -right-1 size-5 border-t-4 border-r-4 border-primary rounded-tr-md" />
                <div className="absolute -bottom-1 -left-1 size-5 border-b-4 border-l-4 border-primary rounded-bl-md" />
                <div className="absolute -bottom-1 -right-1 size-5 border-b-4 border-r-4 border-primary rounded-br-md" />

                {/* Animated scanning laser */}
                <div className="absolute left-2 right-2 top-1/2 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_12px_rgba(239,68,68,0.9)] animate-pulse" />
              </div>
            </div>
          )}

          {/* Initializing Spinner */}
          {isInitializing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white gap-3 z-10">
              <RefreshCw className="size-8 animate-spin text-primary" />
              <span className="text-sm font-semibold">Starting camera feed…</span>
            </div>
          )}

          {/* Error Message Display */}
          {errorMessage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/95 p-6 text-center gap-3 z-10">
              <AlertCircle className="size-10 text-destructive" />
              <p className="text-sm font-semibold text-foreground max-w-xs">{errorMessage}</p>
              <button
                type="button"
                onClick={startScanning}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-xs shadow-md hover:bg-primary/90 transition-all cursor-pointer"
              >
                <RefreshCw className="size-4" />
                Retry Camera
              </button>
            </div>
          )}

          {/* Successful Scan Feedback Banner */}
          {lastScanned && (
            <div className="absolute bottom-3 inset-x-4 flex items-center justify-between px-4 py-2.5 rounded-xl bg-emerald-600/90 text-white backdrop-blur-md shadow-lg animate-in slide-in-from-bottom-2 duration-150 z-20">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="size-4 shrink-0 text-white" />
                <span className="text-xs font-bold truncate">Detected: {lastScanned}</span>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-md">
                Added
              </span>
            </div>
          )}

          {/* Torch Button (if supported) */}
          {torchSupported && (
            <button
              type="button"
              onClick={toggleTorch}
              className={`absolute top-3 right-3 p-2.5 rounded-full backdrop-blur-md transition-all cursor-pointer z-20 ${
                torchActive
                  ? "bg-amber-400 text-black shadow-lg"
                  : "bg-black/60 text-white hover:bg-black/80"
              }`}
              title={torchActive ? "Turn Flash Off" : "Turn Flash On"}
              aria-label={torchActive ? "Turn Flash Off" : "Turn Flash On"}
            >
              {torchActive ? <ZapOff className="size-5" /> : <Zap className="size-5" />}
            </button>
          )}
        </div>

        {/* Footer & Manual Entry Fallback */}
        <div className="p-4 bg-muted/20 border-t border-border/60 flex flex-col gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const code = manualCode.trim();
              if (code) {
                onScan(code);
                setManualCode("");
                setLastScanned(code);
              }
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Or enter barcode manually here…"
              className="flex-1 rounded-xl border border-border bg-background px-3.5 py-2 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="submit"
              disabled={!manualCode.trim()}
              className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs shadow hover:bg-primary/90 disabled:opacity-50 transition-all cursor-pointer"
            >
              Add
            </button>
          </form>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
            <span className="flex items-center gap-1">
              <Volume2 className="size-3 text-primary" /> Audio confirmation on scan
            </span>
            <button
              type="button"
              onClick={onClose}
              className="font-semibold text-foreground hover:underline cursor-pointer"
            >
              Done Scanning
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
