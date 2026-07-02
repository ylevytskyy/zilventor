import { useEffect, useRef, useState } from 'react';
import { decodeQrFromImageData } from './qrDecode';

interface BarcodeDetectorResult {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<BarcodeDetectorResult[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

const POLL_INTERVAL_MS = 200;

export interface QrScanButtonProps {
  onScan: (payload: string) => void;
  label?: string;
}

/**
 * Camera-driven QR scan button. Prefers the native `BarcodeDetector` API where
 * available, falling back to polling video frames through `decodeQrFromImageData`
 * (Safari/Firefox lack `BarcodeDetector`). Renders a disabled, inert button —
 * never touching `getUserMedia` — when `navigator.mediaDevices` is unavailable
 * (e.g. jsdom/CI). Stops all camera tracks on close and on unmount.
 */
export function QrScanButton({ onScan, label }: QrScanButtonProps): JSX.Element {
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices;
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);

  function stopStream(): void {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    detectorRef.current = null;
  }

  // Guarantee cleanup on unmount regardless of open/close path.
  useEffect(() => stopStream, []);

  useEffect(() => {
    if (!open) return;
    const stream = streamRef.current;
    const video = videoRef.current;
    if (!stream || !video) return;

    video.srcObject = stream;
    void video.play();

    if (typeof window !== 'undefined' && window.BarcodeDetector) {
      detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
    }

    const scan = async (): Promise<void> => {
      if (video.readyState < 2) return;

      if (detectorRef.current) {
        try {
          const [first] = await detectorRef.current.detect(video);
          if (first) {
            onScan(first.rawValue);
            setOpen(false);
          }
        } catch {
          // Transient detector failure (e.g. frame mid-decode) — keep polling.
        }
        return;
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || !video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const payload = decodeQrFromImageData(frame.data, frame.width, frame.height);
      if (payload) {
        onScan(payload);
        setOpen(false);
      }
    };

    const id = window.setInterval(() => {
      void scan();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [open, onScan]);

  async function handleOpen(): Promise<void> {
    if (!supported) return;
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      setOpen(true);
    } catch {
      stopStream();
    }
  }

  function handleClose(): void {
    stopStream();
    setOpen(false);
  }

  const buttonLabel = label ?? 'Scan QR code';

  return (
    <>
      <button type="button" onClick={() => void handleOpen()} disabled={!supported}>
        {buttonLabel}
      </button>
      {open && (
        <div role="dialog" aria-label={buttonLabel}>
          <video ref={videoRef} muted playsInline data-testid="qr-scan-video" />
          <canvas ref={canvasRef} data-testid="qr-scan-canvas" style={{ display: 'none' }} />
          <button type="button" onClick={handleClose}>
            Close
          </button>
        </div>
      )}
    </>
  );
}
