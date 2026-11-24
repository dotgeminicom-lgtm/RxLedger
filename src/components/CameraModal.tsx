import React, { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, Upload, X } from 'lucide-react';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaptureBlob: (blob: Blob) => void;
  onFallbackFilePick: () => void;
}

export const CameraModal: React.FC<CameraModalProps> = ({
  isOpen,
  onClose,
  onCaptureBlob,
  onFallbackFilePick,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setIsReady(false);
      setCameraError(null);
      return;
    }

    let cancelled = false;

    async function startCamera() {
      setCameraError(null);
      setIsReady(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Live browser camera is unavailable on this device. Use the device camera upload button below.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setIsReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Camera access denied.';
          setCameraError(
            `Unable to open live camera (${msg}). You can still use your phone's native camera or gallery picker.`
          );
        }
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [isOpen, facingMode]);

  if (!isOpen) return null;

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || !isReady) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCaptureBlob(blob);
          onClose();
        }
      },
      'image/jpeg',
      0.92
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/90 flex flex-col justify-between"
      role="dialog"
      aria-modal="true"
      aria-label="Prescription Camera Scanner"
    >
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950/80 text-white border-b border-slate-800">
        <div>
          <h2 className="text-sm font-semibold">Capture Prescription</h2>
          <p className="text-xs text-slate-400">Align the entire prescription flat inside the frame</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700"
            aria-label="Switch camera"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700"
            aria-label="Close camera"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 relative flex items-center justify-center overflow-hidden p-4">
        {cameraError ? (
          <div className="max-w-sm w-full bg-slate-900 border border-slate-700 rounded-2xl p-6 text-center text-white space-y-4">
            <p className="text-sm text-slate-200 leading-relaxed">{cameraError}</p>
            <button
              type="button"
              onClick={() => {
                onClose();
                onFallbackFilePick();
              }}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
            >
              <Upload className="w-4 h-4" />
              Use Native Camera / Gallery
            </button>
          </div>
        ) : (
          <div className="relative w-full max-w-2xl aspect-[3/4] sm:aspect-video rounded-2xl overflow-hidden bg-black border border-slate-800">
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <div className="pointer-events-none absolute inset-4 border-2 border-dashed border-emerald-400/70 rounded-xl" />
          </div>
        )}
      </div>

      {!cameraError && (
        <div className="px-6 py-5 bg-slate-950/90 border-t border-slate-800 flex items-center justify-center gap-4 pb-safe">
          <button
            type="button"
            onClick={() => {
              onClose();
              onFallbackFilePick();
            }}
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 text-slate-200 text-sm font-medium hover:bg-slate-700 inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Upload className="w-4 h-4" />
            Native Camera
          </button>
          <button
            type="button"
            disabled={!isReady}
            onClick={handleCapture}
            className="min-h-[52px] px-7 py-3 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2 shadow-lg whitespace-nowrap"
          >
            <Camera className="w-5 h-5" />
            Capture Photo
          </button>
        </div>
      )}
    </div>
  );
};
