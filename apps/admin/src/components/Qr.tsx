import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import QrScanner from "qr-scanner";

// QR display and camera scanning for the gate scanner and the food counter.

/** Renders text as a QR code. Error correction "M", as the guide recommends. */
export function QrImage({ text, size = 320 }: { text: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) void QRCode.toCanvas(ref.current, text, { errorCorrectionLevel: "M", width: size, margin: 2 });
  }, [text, size]);
  // data-text is what the code encodes (used by end-to-end tests; nothing secret).
  return <canvas ref={ref} className="qr-canvas" aria-label="QR code" data-text={text} />;
}

/**
 * Opens the back camera and calls onScan once per decoded code. If the camera
 * isn't available (permission denied, no camera, desktop testing), the text can
 * be pasted or typed instead (guide section 8: "manual code entry fallback").
 */
export function QrCamera({ onScan, paused = false, hint }: { onScan: (text: string) => void; paused?: boolean; hint?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<QrScanner | null>(null);
  const handler = useRef(onScan);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  useEffect(() => {
    handler.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!video.current) return;
    let last = "";
    let lastAt = 0;
    const s = new QrScanner(
      video.current,
      (r) => {
        // The same code stays in view for a while; report it once.
        if (r.data === last && Date.now() - lastAt < 3000) return;
        last = r.data;
        lastAt = Date.now();
        handler.current(r.data);
      },
      { preferredCamera: "environment", highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 8 },
    );
    scanner.current = s;
    s.start().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      s.stop();
      s.destroy();
      scanner.current = null;
    };
  }, []);

  useEffect(() => {
    const s = scanner.current;
    if (!s) return;
    if (paused) s.pause();
    else s.start().catch(() => {});
  }, [paused]);

  return (
    <div className="qr-camera">
      <video ref={video} muted playsInline />
      {hint && <p className="camera-hint">{hint}</p>}
      {error && <div className="notice">Camera unavailable: {error}. Paste or type the code below.</div>}
      <details className="type-code" open={Boolean(error)}>
        <summary>Can't scan? Enter the code</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) handler.current(typed.trim());
            setTyped("");
          }}
        >
          <textarea rows={3} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Paste the code text here" />
          <button className="secondary full">Use this code</button>
        </form>
      </details>
    </div>
  );
}
