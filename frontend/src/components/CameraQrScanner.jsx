import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';

// Audio chirp synthesizer using standard Web Audio API (no external sound files required)
function playScanSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Two-tone rising chime (880Hz -> 1320Hz)
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  } catch {
    // AudioContext blocked by browser autoplay policy until interaction
  }
}

// Global set of all live video tracks opened by the browser
const activeCameraTracks = new Set();

// Intercept navigator.mediaDevices.getUserMedia to ensure every track is tracked and can be forcibly terminated
if (typeof window !== 'undefined' && navigator?.mediaDevices?.getUserMedia) {
  if (!navigator.mediaDevices.__isSihTracked) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function (constraints) {
      const stream = await originalGetUserMedia(constraints);
      if (stream && typeof stream.getVideoTracks === 'function') {
        stream.getVideoTracks().forEach((track) => {
          activeCameraTracks.add(track);
          track.addEventListener('ended', () => {
            activeCameraTracks.delete(track);
          });
        });
      }
      return stream;
    };
    navigator.mediaDevices.__isSihTracked = true;
  }
}

/**
 * Global helper to stop all active video/camera hardware streams across document
 */
export function stopAllCameraStreams() {
  // 1. Force stop all active media stream tracks recorded by our interceptor
  activeCameraTracks.forEach((track) => {
    try {
      track.enabled = false;
      if (track.readyState !== 'ended') {
        track.stop();
      }
    } catch {
      // ignore track stop error
    }
  });
  activeCameraTracks.clear();

  // 2. Also search all video elements in DOM and stop their stream tracks
  try {
    if (typeof document !== 'undefined') {
      document.querySelectorAll('video').forEach((v) => {
        try {
          if (v.srcObject && typeof v.srcObject.getTracks === 'function') {
            v.srcObject.getTracks().forEach((track) => {
              try {
                track.enabled = false;
                track.stop();
              } catch {}
            });
            v.srcObject = null;
          }
          v.pause();
          v.removeAttribute('src');
          v.load();
        } catch {}
      });
    }
  } catch (err) {
    console.warn("Global camera stop notice:", err);
  }
}

/**
 * CameraQrScanner:
 * Complete, production-grade QR code camera scanner for faculty attendance verification.
 * Supports:
 * - Direct webcam/camera access with HTML5 MediaDevices
 * - Clean hardware shutdown when tabs switch (stops all tracks, camera LED turns off)
 * - Automatic reopening when tab is revisited or browser window is focused
 * - Auto-switch rear/front camera on mobile (facingMode: environment / user)
 * - Camera device selector (if multiple cameras available)
 * - Permission guidance with friendly retry flow
 * - Live animated laser viewfinder with corner target brackets
 * - Torch / Flashlight toggle (on devices with camera flash)
 * - Fallback image upload for saved QR screenshots
 * - Web Audio acoustic chime + haptic vibration on successful detection
 */
export default function CameraQrScanner({
  onScanSuccess,
  onScanError,
  autoStart = true,
  className = "",
}) {
  const containerId = useRef(`qr-reader-${Math.random().toString(36).substring(2, 9)}`);
  const qrInstanceRef = useRef(null);
  const fileInputRef = useRef(null);
  const isMountedRef = useRef(true);
  const isStartingRef = useRef(false);

  // Scanner status: 'idle' | 'requesting' | 'scanning' | 'paused' | 'success' | 'permission_denied' | 'not_found' | 'error'
  const [scannerStatus, setScannerStatus] = useState('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [facingMode, setFacingMode] = useState('environment'); // 'environment' | 'user'
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [lastScannedText, setLastScannedText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Cleanly stop scanner instance and release hardware video tracks
  const stopScanner = useCallback(async () => {
    isMountedRef.current = false;

    // Immediately stop all hardware camera tracks
    stopAllCameraStreams();

    // 2. Stop Html5Qrcode instance
    const instance = qrInstanceRef.current;
    if (instance) {
      try {
        if (instance.isScanning || instance.getState() === Html5QrcodeScannerState.SCANNING) {
          await instance.stop();
        }
      } catch (err) {
        console.warn("Camera cleanup warning:", err);
      }
      try {
        instance.clear();
      } catch {
        // ignore clear error
      }
      qrInstanceRef.current = null;
    }
  }, []);

  // Fetch list of available camera devices
  const refreshCameras = useCallback(async () => {
    try {
      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length > 0) {
        setCameras(devices);
        return devices;
      }
      return [];
    } catch (err) {
      console.warn("Unable to enumerate cameras prior to permission:", err);
      return [];
    }
  }, []);

  // Start camera stream
  const startScanner = useCallback(async (cameraConfig = null) => {
    isMountedRef.current = true;
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    try {
      // Stop any existing instance first
      await stopScanner();
      isMountedRef.current = true; // reset to active after stop

      const element = document.getElementById(containerId.current);
      if (!element || !isMountedRef.current) {
        isStartingRef.current = false;
        return;
      }

      setScannerStatus('requesting');
      setStatusMessage('Requesting camera permissions...');

      const instance = new Html5Qrcode(containerId.current, {
        verbose: false,
      });
      qrInstanceRef.current = instance;

      // Determine camera target (preferred deviceId or facingMode)
      const targetConfig = cameraConfig || (selectedCameraId
        ? selectedCameraId
        : { facingMode: facingMode });

      const qrConfig = {
        fps: 15,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72);
          const size = Math.max(edge, 180);
          return { width: size, height: size };
        },
        aspectRatio: 1.0,
      };

      await instance.start(
        targetConfig,
        qrConfig,
        (decodedText) => {
          // Prevent multiple fires during rapid scanning
          if (isProcessing) return;

          playScanSound();
          if (navigator.vibrate) {
            navigator.vibrate([40, 30, 40]);
          }

          setLastScannedText(decodedText);
          setScannerStatus('success');
          setIsProcessing(true);

          if (onScanSuccess) {
            onScanSuccess(decodedText);
          }

          // Allow next scan after 2 seconds cooldown
          setTimeout(() => {
            setIsProcessing(false);
          }, 2000);
        },
        () => {
          // Frame-by-frame error (normal when no QR is in view)
        }
      );

      // If component unmounted while start was in-flight, shut it down immediately!
      if (!isMountedRef.current) {
        try {
          if (instance.isScanning || instance.getState() === Html5QrcodeScannerState.SCANNING) {
            await instance.stop();
          }
          instance.clear();
        } catch {
          // ignore
        }
        stopAllCameraStreams();
        return;
      }

      setScannerStatus('scanning');
      setStatusMessage('Camera active: Align student QR code within frame');

      // Check for torch capability
      try {
        const capabilities = instance.getRunningTrackCapabilities?.();
        if (capabilities && 'torch' in capabilities) {
          setTorchAvailable(true);
        } else {
          setTorchAvailable(false);
        }
      } catch {
        setTorchAvailable(false);
      }

      // Enumerate cameras once permission is granted so labels are populated
      refreshCameras().then(() => {});

    } catch (err) {
      if (!isMountedRef.current) return;
      console.error("Camera start error:", err);
      const errMsg = err?.toString?.() || '';

      if (errMsg.includes('NotAllowedError') || errMsg.includes('Permission') || errMsg.includes('denied')) {
        setScannerStatus('permission_denied');
        setStatusMessage('Camera access was denied by your browser.');
      } else if (errMsg.includes('NotFoundError') || errMsg.includes('DevicesNotFoundError')) {
        setScannerStatus('not_found');
        setStatusMessage('No camera device detected on your hardware.');
      } else if (errMsg.includes('NotReadableError') || errMsg.includes('TrackStartError')) {
        setScannerStatus('error');
        setStatusMessage('Camera is in use by another tab or app. Please close other camera programs.');
      } else {
        setScannerStatus('error');
        setStatusMessage(errMsg || 'Failed to initialize camera. Try uploading an image.');
      }

      if (onScanError) {
        onScanError(err);
      }
    } finally {
      isStartingRef.current = false;
    }
  }, [stopScanner, selectedCameraId, facingMode, isProcessing, onScanSuccess, onScanError, refreshCameras]);

  // Auto-start on mount & manage visibility changes (tab switching)
  useEffect(() => {
    isMountedRef.current = true;
    let timer;

    if (autoStart) {
      timer = setTimeout(() => {
        if (isMountedRef.current) {
          startScanner();
        }
      }, 50);
    }

    // Automatically turn off camera when browser tab is switched / hidden, and reopen when revisited
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopScanner();
      } else {
        if (isMountedRef.current) {
          startScanner();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopScanner();
      stopAllCameraStreams();
    };
  }, [autoStart, startScanner, stopScanner]);

  // Toggle Torch
  const toggleTorch = async () => {
    const instance = qrInstanceRef.current;
    if (!instance || !torchAvailable) return;
    try {
      const nextTorch = !torchOn;
      await instance.applyVideoConstraints({
        advanced: [{ torch: nextTorch }]
      });
      setTorchOn(nextTorch);
    } catch (err) {
      console.warn("Failed to toggle torch:", err);
    }
  };

  // Flip camera between front (user) and back (environment)
  const flipCameraFacing = async () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    setSelectedCameraId('');
    await startScanner({ facingMode: nextMode });
  };

  // Switch specific device
  const handleDeviceChange = async (e) => {
    const newId = e.target.value;
    setSelectedCameraId(newId);
    if (newId) {
      await startScanner(newId);
    } else {
      await startScanner({ facingMode: facingMode });
    }
  };

  // Handle image file scan fallback
  const handleFileScan = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setStatusMessage('Decoding QR from image...');
      let scanner = qrInstanceRef.current;
      if (!scanner) {
        scanner = new Html5Qrcode(containerId.current, { verbose: false });
        qrInstanceRef.current = scanner;
      }

      if (scanner.isScanning) {
        await scanner.stop();
      }

      const decodedText = await scanner.scanFile(file, false);
      playScanSound();
      if (navigator.vibrate) navigator.vibrate([40, 30, 40]);

      setLastScannedText(decodedText);
      setScannerStatus('success');
      setStatusMessage('QR code successfully detected from image!');

      if (onScanSuccess) {
        onScanSuccess(decodedText);
      }
    } catch (err) {
      console.error("File QR decode error:", err);
      setScannerStatus('error');
      setStatusMessage('No valid QR code found in the uploaded image. Please try a clearer photo.');
      if (onScanError) onScanError(err);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className={`camera-qr-scanner-box relative bg-slate-900 text-white rounded-xl overflow-hidden border border-slate-700 shadow-xl ${className}`}>
      {/* Top Bar: Status & Hardware Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-slate-950/80 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          {scannerStatus === 'scanning' ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Camera Active</span>
            </span>
          ) : scannerStatus === 'requesting' ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-amber-300">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>Initializing...</span>
            </span>
          ) : scannerStatus === 'success' ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-300">
              ✓ Scanned
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-slate-400">
              <span className="w-2 h-2 rounded-full bg-slate-500" />
              <span>Standby</span>
            </span>
          )}
        </div>

        {/* Action buttons: Torch, Flip Camera, File Upload, Restart */}
        <div className="flex items-center gap-1.5">
          {torchAvailable && (
            <button
              type="button"
              onClick={toggleTorch}
              title={torchOn ? "Turn flashlight off" : "Turn flashlight on"}
              className={`p-1.5 rounded transition ${torchOn ? "bg-amber-400 text-slate-950" : "bg-slate-800 hover:bg-slate-700 text-slate-200"}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6c0 2-2 4-2 6v6a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-6c0-2-2-4-2-6a6 6 0 0 1 12 0z" />
                <line x1="12" y1="12" x2="12" y2="12.01" />
              </svg>
            </button>
          )}

          {/* Flip Front / Back camera button */}
          <button
            type="button"
            onClick={flipCameraFacing}
            title={`Switch to ${facingMode === 'environment' ? 'front (user)' : 'rear (environment)'} camera`}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-medium flex items-center gap-1 transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 10c0-4.4-3.6-8-8-8s-8 3.6-8 8" />
              <path d="m4 14 4-4-4-4" />
              <path d="M4 14c0 4.4 3.6 8 8 8s8-3.6 8-8" />
              <path d="m20 10-4 4 4 4" />
            </svg>
            <span>Flip</span>
          </button>

          {/* Scan from file fallback */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Upload an image or screenshot containing a QR code"
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-medium flex items-center gap-1 transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Upload Image</span>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileScan}
            accept="image/*"
            className="hidden"
          />

          {scannerStatus === 'scanning' ? (
            <button
              type="button"
              onClick={stopScanner}
              className="px-2 py-1 bg-red-600/80 hover:bg-red-600 text-white rounded text-[11px] font-semibold transition"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => startScanner()}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-semibold transition"
            >
              Start Camera
            </button>
          )}
        </div>
      </div>

      {/* Camera Selection Dropdown (if multiple detected) */}
      {cameras.length > 1 && (
        <div className="px-3.5 py-1.5 bg-slate-950/60 border-b border-slate-800/80 flex items-center gap-2 text-xs">
          <label className="text-slate-400 text-[11px] font-medium flex-shrink-0">Device:</label>
          <select
            value={selectedCameraId}
            onChange={handleDeviceChange}
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="">Default ({facingMode === 'environment' ? 'Rear / Back Camera' : 'Front Webcam'})</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label || `Camera ${c.id.substring(0, 8)}...`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Main Viewfinder Stage */}
      <div className="relative w-full aspect-[4/3] sm:aspect-[16/10] bg-black flex items-center justify-center overflow-hidden">
        {/* HTML5 QR Container: Video element is injected here */}
        <div
          id={containerId.current}
          className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover"
        />

        {/* Viewfinder Overlay Frame (shown when scanning) */}
        {scannerStatus === 'scanning' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {/* Shaded backdrop vignette */}
            <div className="absolute inset-0 bg-slate-950/30" />

            {/* Scanning Target Box */}
            <div className="relative w-[65%] max-w-[260px] aspect-square rounded-2xl border-2 border-emerald-400/80 shadow-[0_0_25px_rgba(52,211,153,0.35)] flex items-center justify-center">
              {/* Corner reticle guides */}
              <span className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
              <span className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
              <span className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
              <span className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />

              {/* Animated Laser Scanning Beam */}
              <div className="scanner-laser-beam absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_#34d399]" />

              <span className="absolute bottom-2 text-[10px] font-mono tracking-wider uppercase text-emerald-300 bg-slate-950/70 px-2 py-0.5 rounded backdrop-blur-sm">
                Target QR Code
              </span>
            </div>
          </div>
        )}

        {/* Requesting Camera Permission State */}
        {scannerStatus === 'requesting' && (
          <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center p-6 text-center space-y-3 z-10">
            <div className="w-10 h-10 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            <div className="font-semibold text-slate-100 text-sm">Opening Camera Stream...</div>
            <p className="text-xs text-slate-400 max-w-xs">
              Please click <strong>Allow</strong> if prompted by your browser to grant webcam access.
            </p>
          </div>
        )}

        {/* Permission Denied Banner */}
        {scannerStatus === 'permission_denied' && (
          <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center space-y-3 z-10">
            <div className="w-12 h-12 rounded-full bg-red-950/60 border border-red-500/40 text-red-400 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
            </div>
            <div className="font-bold text-red-400 text-sm">Camera Permission Denied</div>
            <p className="text-xs text-slate-300 max-w-sm leading-relaxed">
              Camera access is blocked by your browser settings. To enable scanning:
            </p>
            <ol className="text-[11px] text-slate-400 text-left space-y-1 list-decimal list-inside bg-slate-900/80 p-3 rounded-lg border border-slate-800 max-w-xs">
              <li>Click the <strong>Lock / Camera icon</strong> in your browser address bar</li>
              <li>Toggle <strong>Camera</strong> permission to <strong>Allow</strong></li>
              <li>Click <strong>Retry Camera</strong> below</li>
            </ol>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={() => startScanner()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-semibold text-xs transition"
              >
                Retry Camera Access
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium text-xs transition"
              >
                Upload QR Image
              </button>
            </div>
          </div>
        )}

        {/* No Camera Found State */}
        {scannerStatus === 'not_found' && (
          <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center space-y-3 z-10">
            <div className="w-12 h-12 rounded-full bg-amber-950/50 border border-amber-500/40 text-amber-400 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            </div>
            <div className="font-bold text-amber-300 text-sm">No Camera Detected</div>
            <p className="text-xs text-slate-300 max-w-sm">
              We couldn&apos;t detect a connected camera on this device. You can upload an image of the QR code instead.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-semibold text-xs transition"
            >
              Upload QR Image File
            </button>
          </div>
        )}

        {/* Error State */}
        {scannerStatus === 'error' && (
          <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center space-y-3 z-10">
            <div className="font-bold text-red-400 text-sm">Scanner Error</div>
            <p className="text-xs text-slate-300 max-w-xs">{statusMessage}</p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => startScanner()}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold transition"
              >
                Restart Camera
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium transition"
              >
                Upload Image
              </button>
            </div>
          </div>
        )}

        {/* Scanned Success Preview Overlay */}
        {scannerStatus === 'success' && (
          <div className="absolute inset-0 bg-slate-950/85 flex flex-col items-center justify-center p-6 text-center space-y-3 z-10 animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center font-bold text-xl shadow-lg shadow-emerald-500/30">
              ✓
            </div>
            <div className="font-bold text-emerald-300 text-sm">QR Code Decoded!</div>
            <p className="text-xs font-mono text-slate-300 bg-slate-900/90 px-3 py-1.5 rounded border border-slate-700 max-w-xs truncate">
              {lastScannedText}
            </p>
            <button
              type="button"
              onClick={() => {
                setScannerStatus('scanning');
                startScanner();
              }}
              className="mt-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition shadow"
            >
              Scan Another Code
            </button>
          </div>
        )}
      </div>

      {/* Bottom helper footnote */}
      <div className="px-4 py-2 bg-slate-950/90 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Encrypted HMAC-SHA256 Token Validation
        </span>
        <span className="text-slate-500">SIH 2026 Faculty Attendance Scanner</span>
      </div>
    </div>
  );
}
