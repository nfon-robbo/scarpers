import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface Props {
  onDetected: (code: string) => void;
  onCancel: () => void;
  onError: (reason: "camera_unavailable" | "scanner_unavailable") => void;
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

export default function BarcodeScanner({ onDetected, onCancel, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stoppedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  const [status, setStatus] = useState("Point your camera at the barcode");

  useEffect(() => {
    stoppedRef.current = false;

    const fire = (code: string) => {
      if (stoppedRef.current) return;
      stoppedRef.current = true;
      cleanup();
      onDetected(code);
    };

    const cleanup = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      try { zxingControlsRef.current?.stop(); } catch { /* noop */ }
      zxingControlsRef.current = null;
      const s = streamRef.current;
      if (s) {
        s.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };

    async function startNative(): Promise<boolean> {
      const Anyw = window as any;
      if (!("BarcodeDetector" in Anyw)) return false;
      try {
        const supported: string[] = await Anyw.BarcodeDetector.getSupportedFormats?.() ?? [];
        const formats = FORMATS.filter((f) => supported.length === 0 || supported.includes(f));
        if (!formats.length) return false;
        const detector = new Anyw.BarcodeDetector({ formats });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) { stream.getTracks().forEach((t) => t.stop()); return false; }
        video.srcObject = stream;
        await video.play().catch(() => {});

        const tick = async () => {
          if (stoppedRef.current) return;
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length) {
              const raw = String(codes[0].rawValue || "").trim();
              if (raw) return fire(raw);
            }
          } catch { /* ignore frame errors */ }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return true;
      } catch (e: any) {
        if (e?.name === "NotAllowedError" || e?.name === "NotFoundError") {
          onError("camera_unavailable");
          return true; // handled
        }
        return false;
      }
    }

    async function startZxing() {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const { DecodeHintType, BarcodeFormat } = await import("@zxing/library");
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ]);
        const reader = new BrowserMultiFormatReader(hints);
        const video = videoRef.current;
        if (!video) return;
        const controls = await reader.decodeFromVideoDevice(undefined, video, (result, _err, ctl) => {
          if (result) {
            const text = result.getText();
            try { ctl.stop(); } catch { /* noop */ }
            // Capture underlying stream so cleanup releases the camera.
            const s = (video.srcObject as MediaStream | null) ?? null;
            if (s) streamRef.current = s;
            if (text) fire(text);
          }
        });
        zxingControlsRef.current = controls;
        const s = (video.srcObject as MediaStream | null) ?? null;
        if (s) streamRef.current = s;
      } catch (e: any) {
        if (e?.name === "NotAllowedError" || e?.name === "NotFoundError") {
          onError("camera_unavailable");
        } else {
          onError("scanner_unavailable");
        }
      }
    }

    (async () => {
      const ok = await startNative();
      if (!ok && !stoppedRef.current) {
        setStatus("Starting scanner…");
        await startZxing();
        setStatus("Point your camera at the barcode");
      }
    })();

    return () => {
      stoppedRef.current = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full overflow-hidden rounded-md border border-border bg-black aspect-[4/3]">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-24 w-3/4 rounded-md border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      </div>
      <div className="absolute bottom-2 left-0 right-0 text-center text-xs text-white/90">
        {status}
      </div>
      <button
        onClick={onCancel}
        aria-label="Close scanner"
        className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
