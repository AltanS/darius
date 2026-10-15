/**
 * The iOS startup images (0.99.0): the picture a home screen app shows while it
 * starts. iOS takes no size from the manifest. It picks the `apple-touch-startup-image`
 * link whose media query names the device, so each device size has one image and one
 * link. `bun run icons` (web/scripts/icons.ts) renders the images from this list and
 * `root.tsx` links them from it, so the two never differ. Portrait only: the app is a
 * phone app, and a tablet in landscape shows the plain ground colour until the page paints.
 */

/** One device size: the CSS pixels of its screen and its pixel ratio. */
export interface SplashSize {
  /** CSS pixels. */
  cssWidth: number;
  cssHeight: number;
  ratio: 2 | 3;
  /** The devices that have it, for the next person who updates the list. */
  devices: string;
}

export const SPLASH_SIZES: readonly SplashSize[] = [
  { cssWidth: 440, cssHeight: 956, ratio: 3, devices: "iPhone 17 Pro Max, 16 Pro Max" },
  { cssWidth: 402, cssHeight: 874, ratio: 3, devices: "iPhone 17, 17 Pro, 16 Pro" },
  { cssWidth: 420, cssHeight: 912, ratio: 3, devices: "iPhone Air" },
  { cssWidth: 430, cssHeight: 932, ratio: 3, devices: "iPhone 16 Plus, 15 Plus, 15 Pro Max, 14 Pro Max" },
  { cssWidth: 393, cssHeight: 852, ratio: 3, devices: "iPhone 16, 16e, 15, 15 Pro, 14 Pro" },
  { cssWidth: 428, cssHeight: 926, ratio: 3, devices: "iPhone 14 Plus, 13 Pro Max, 12 Pro Max" },
  { cssWidth: 390, cssHeight: 844, ratio: 3, devices: "iPhone 14, 13, 13 Pro, 12, 12 Pro" },
  { cssWidth: 375, cssHeight: 812, ratio: 3, devices: "iPhone 13 mini, 12 mini, 11 Pro, XS, X" },
  { cssWidth: 414, cssHeight: 896, ratio: 3, devices: "iPhone 11 Pro Max, XS Max" },
  { cssWidth: 414, cssHeight: 896, ratio: 2, devices: "iPhone 11, XR" },
  { cssWidth: 414, cssHeight: 736, ratio: 3, devices: "iPhone 8 Plus" },
  { cssWidth: 375, cssHeight: 667, ratio: 2, devices: "iPhone SE (2nd, 3rd generation), 8" },
  { cssWidth: 1032, cssHeight: 1376, ratio: 2, devices: "iPad Pro 13 inch (M4)" },
  { cssWidth: 1024, cssHeight: 1366, ratio: 2, devices: "iPad Pro 12.9 inch, iPad Air 13 inch" },
  { cssWidth: 834, cssHeight: 1210, ratio: 2, devices: "iPad Pro 11 inch (M4)" },
  { cssWidth: 834, cssHeight: 1194, ratio: 2, devices: "iPad Pro 11 inch (earlier models)" },
  { cssWidth: 834, cssHeight: 1112, ratio: 2, devices: "iPad Pro 10.5 inch, iPad Air 3" },
  { cssWidth: 820, cssHeight: 1180, ratio: 2, devices: "iPad Air 4, 5, iPad Air 11 inch, iPad 10, iPad (A16)" },
  { cssWidth: 768, cssHeight: 1024, ratio: 2, devices: "iPad 5, 6, iPad Air 2, iPad mini 4, 5" },
  { cssWidth: 810, cssHeight: 1080, ratio: 2, devices: "iPad 7, 8, 9" },
  { cssWidth: 744, cssHeight: 1133, ratio: 2, devices: "iPad mini 6" },
];

/** A size in device pixels. */
export interface Pixels {
  width: number;
  height: number;
}

/** The image's size in device pixels. */
export function splashPixels(size: SplashSize): Pixels {
  return { width: size.cssWidth * size.ratio, height: size.cssHeight * size.ratio };
}

/** The file name in `web/public`: `splash-1170x2532.png`. */
export function splashFile(size: SplashSize): string {
  const { width, height } = splashPixels(size);
  return `splash-${String(width)}x${String(height)}.png`;
}

/** The media query that picks the image for this device, portrait. */
export function splashMedia(size: SplashSize): string {
  return `(device-width: ${String(size.cssWidth)}px) and (device-height: ${String(size.cssHeight)}px) and (-webkit-device-pixel-ratio: ${String(size.ratio)}) and (orientation: portrait)`;
}
