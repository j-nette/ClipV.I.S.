/**
 * Webcam access for the gesture pipeline. Wraps getUserMedia + a <video>
 * element, with explicit permission/error handling so the rest of the app can
 * degrade gracefully (keyboard fallback) when there's no camera.
 */
export interface CameraHandle {
  video: HTMLVideoElement;
  stop: () => void;
}

export interface CameraOptions {
  width?: number;
  height?: number;
}

export class CameraError extends Error {
  constructor(
    message: string,
    readonly kind: 'unsupported' | 'denied' | 'not-found' | 'unknown',
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

/**
 * Request the webcam and return a playing <video>. Throws CameraError on any
 * failure so callers can fall back to keyboard-only.
 */
export async function startCamera(opts: CameraOptions = {}): Promise<CameraHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('getUserMedia is not available in this browser', 'unsupported');
  }

  const { width = 640, height = 480 } = opts;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: width }, height: { ideal: height }, facingMode: 'user' },
    });
  } catch (err) {
    throw toCameraError(err);
  }

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new CameraError('video element failed to load', 'unknown'));
  });
  await video.play();

  return {
    video,
    stop: () => {
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}

function toCameraError(err: unknown): CameraError {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return new CameraError('camera permission denied', 'denied');
      case 'NotFoundError':
      case 'OverconstrainedError':
        return new CameraError('no suitable camera found', 'not-found');
    }
  }
  return new CameraError('failed to start camera', 'unknown');
}
