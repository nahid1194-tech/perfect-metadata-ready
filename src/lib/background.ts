export type BackgroundKind =
  | "transparent"
  | "white"
  | "black"
  | "solid"
  | "complex";

export type BackgroundDetection = {
  transparent: boolean;
  kind: BackgroundKind;
  color: string;
  hex: string;
};

const TRANSPARENT_RATIO = 0.5;
const NEUTRAL_RATIO = 0.6;
const SOLID_SPREAD = 26;

const IS_WORKER =
  typeof document === "undefined" && typeof window === "undefined";

function loadImage(src: string): Promise<HTMLImageElement | ImageBitmap> {
  if (IS_WORKER) {
    return (async () => {
      const blob = await (await fetch(src)).blob();
      return createImageBitmap(blob);
    })();
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("Could not load the image for background detection."));
    img.src = src;
  });
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) =>
    Math.round(value).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToName(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (255 - Math.abs(2 * l - 255));

  if (s < 0.12) {
    if (l >= 235) return "white";
    if (l <= 20) return "black";
    if (l < 60) return "dark gray";
    if (l > 200) return "light gray";
    return "gray";
  }

  let h = 0;
  if (delta === 0) h = 0;
  else if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h = (h * 60 + 360) % 360;

  const dark = l < 45;
  const light = l > 205;
  const muted = s < 0.3;

  let name: string;
  if (h < 15 || h >= 345) name = "red";
  else if (h < 40) name = "orange";
  else if (h < 70) name = "yellow";
  else if (h < 160) name = "green";
  else if (h < 200) name = "teal";
  else if (h < 250) name = "blue";
  else if (h < 290) name = "purple";
  else if (h < 335) name = "pink";
  else name = "red";

  if (muted) {
    if (h >= 15 && h < 70) return dark ? "brown" : light ? "beige" : "tan";
    return `muted ${name}`;
  }
  if (dark) return `dark ${name}`;
  if (light) return `light ${name}`;
  return name;
}

export async function detectBackground(
  dataUrl: string
): Promise<BackgroundDetection> {
  const fallback: BackgroundDetection = {
    transparent: false,
    kind: "complex",
    color: "",
    hex: "",
  };
  try {
    const image = await loadImage(dataUrl);
    if (!image.width || !image.height) return fallback;

    const maxDim = 160;
    const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = IS_WORKER
      ? new OffscreenCanvas(width, height)
      : document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.drawImage(image, 0, 0, width, height);

    const { data } = ctx.getImageData(0, 0, width, height);

    const step = Math.max(1, Math.floor(Math.min(width, height) / 12));
    const points: Array<[number, number]> = [];
    for (let x = 0; x < width; x += step) {
      points.push([x, 0], [x, height - 1]);
    }
    for (let y = step; y < height; y += step) {
      points.push([0, y], [width - 1, y]);
    }

    let borderSamples = 0;
    let borderTransparent = 0;
    let opaque = 0;
    let nearWhite = 0;
    let nearBlack = 0;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let rMin = 255;
    let gMin = 255;
    let bMin = 255;
    let rMax = 0;
    let gMax = 0;
    let bMax = 0;

    for (const [x, y] of points) {
      const index = (y * width + x) * 4;
      const a = data[index + 3];
      borderSamples++;
      if (a < 128) {
        borderTransparent++;
        continue;
      }
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      opaque++;
      if (r >= 235 && g >= 235 && b >= 235) nearWhite++;
      else if (r <= 20 && g <= 20 && b <= 20) nearBlack++;
      rSum += r;
      gSum += g;
      bSum += b;
      rMin = Math.min(rMin, r);
      gMin = Math.min(gMin, g);
      bMin = Math.min(bMin, b);
      rMax = Math.max(rMax, r);
      gMax = Math.max(gMax, g);
      bMax = Math.max(bMax, b);
    }

    if (borderSamples === 0) return fallback;
    if (borderTransparent / borderSamples > TRANSPARENT_RATIO) {
      return {
        transparent: true,
        kind: "transparent",
        color: "",
        hex: "",
      };
    }
    if (opaque === 0) {
      return {
        transparent: true,
        kind: "transparent",
        color: "",
        hex: "",
      };
    }

    if (nearWhite / opaque > NEUTRAL_RATIO) {
      return {
        transparent: false,
        kind: "white",
        color: "white",
        hex: "#ffffff",
      };
    }
    if (nearBlack / opaque > NEUTRAL_RATIO) {
      return {
        transparent: false,
        kind: "black",
        color: "black",
        hex: "#000000",
      };
    }

    const r = Math.round(rSum / opaque);
    const g = Math.round(gSum / opaque);
    const b = Math.round(bSum / opaque);
    const spread = Math.max(rMax - rMin, gMax - gMin, bMax - bMin);

    if (spread < SOLID_SPREAD) {
      return {
        transparent: false,
        kind: "solid",
        color: rgbToName(r, g, b),
        hex: rgbToHex(r, g, b),
      };
    }

    return fallback;
  } catch (error) {
    console.warn(
      "[Background] Detection failed, defaulting to complex",
      error
    );
    return fallback;
  }
}

export function describeBackground(detection: BackgroundDetection): string {
  switch (detection.kind) {
    case "transparent":
      return 'The image has a TRANSPARENT background (alpha channel confirmed by pixel analysis). Set "transparent": true, "isolated": true, "whiteBackground": false, "blackBackground": false.';
    case "white":
      return 'The image has a plain WHITE background (confirmed by pixel analysis). Set "whiteBackground": true, "isolated": true, "transparent": false, "blackBackground": false.';
    case "black":
      return 'The image has a plain BLACK background (confirmed by pixel analysis). Set "blackBackground": true, "isolated": true, "transparent": false, "whiteBackground": false.';
    case "solid":
      return `The image has a plain SOLID ${detection.color.toUpperCase()} background (confirmed by pixel analysis). Set "isolated": true, "transparent": false, "whiteBackground": false, "blackBackground": false.`;
    default:
      return 'The image background is a real scene with visible detail (non-uniform). Set "transparent": false, "whiteBackground": false, "blackBackground": false, "isolated": false.';
  }
}

export function backgroundRules(detection: BackgroundDetection): string {
  switch (detection.kind) {
    case "transparent":
      return "- The image has a transparent background: include the terms 'isolated', 'transparent background', 'cut out', and 'PNG'. Do NOT describe the background as white, black, or a solid color.";
    case "white":
      return "- The image has a plain white background: use 'isolated on white background' and 'white background' where natural. NEVER use 'transparent background'.";
    case "black":
      return "- The image has a plain black background: use 'isolated on black background' and 'black background' where natural. NEVER use 'transparent background'.";
    case "solid":
      return `- The image has a plain solid ${detection.color} background: use 'isolated on ${detection.color} background' and '${detection.color} background' where natural. NEVER use 'transparent background'.`;
    default:
      return "- The image background is a real scene: describe it from the analysis. Do NOT use 'isolated', 'cut out', or 'transparent background'.";
  }
}
