import JSZip from "jszip";
import { debugWarn } from "../utils/debug.ts";

let loadedImages: Record<string, HTMLImageElement> = {};
/** In-flight loads: same `src` shares one `Image` and one profiler span. */
const inFlight = new Map<string, Promise<HTMLImageElement>>();

export type ImageLoadStats = { cacheHits: number; loads: number };
let imageLoadStats: ImageLoadStats = { cacheHits: 0, loads: 0 };

type LoadImageFn = (src: string) => Promise<HTMLImageElement>;
let loadImageForTests: LoadImageFn | null = null;

type NativeBridge = { isNativePlatform?: () => boolean };
type WindowWithNativeBridge = Window & { Capacitor?: NativeBridge };
type WindowWithProfiler = Window & {
  profiler?: {
    mark: (name: string) => void;
    measure: (name: string, start: string, end: string) => void;
  };
};

type SpriteArchiveIndex = { files: Record<string, string> };
let spriteIndexPromise: Promise<SpriteArchiveIndex> | null = null;
const spriteZipCache = new Map<string, Promise<JSZip>>();
const MAX_CACHED_SPRITE_ARCHIVES = 2;

export function getImageLoadStats(): ImageLoadStats {
  return { ...imageLoadStats };
}
export function resetImageLoadStats(): void {
  imageLoadStats = { cacheHits: 0, loads: 0 };
}
export function setLoadImageForTests(fn: LoadImageFn | null): void {
  loadImageForTests = fn;
}

function isNativeAndroid(): boolean {
  try {
    return (
      (window as WindowWithNativeBridge).Capacitor?.isNativePlatform?.() === true
    );
  } catch {
    return false;
  }
}

function getSpriteIndex(): Promise<SpriteArchiveIndex> {
  if (!spriteIndexPromise) {
    spriteIndexPromise = fetch("sprite-archives/index.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Sprite index HTTP ${response.status}`);
        return response.json() as Promise<SpriteArchiveIndex>;
      })
      .catch((error: unknown) => {
        spriteIndexPromise = null;
        throw error;
      });
  }
  return spriteIndexPromise;
}

function getSpriteArchive(name: string): Promise<JSZip> {
  const existing = spriteZipCache.get(name);
  if (existing) {
    // Refresh insertion order for a small LRU cache.
    spriteZipCache.delete(name);
    spriteZipCache.set(name, existing);
    return existing;
  }

  const pending = fetch(`sprite-archives/${name}`)
    .then((response) => {
      if (!response.ok) throw new Error(`Sprite archive HTTP ${response.status}: ${name}`);
      return response.arrayBuffer();
    })
    .then((bytes) => JSZip.loadAsync(bytes));

  spriteZipCache.set(name, pending);
  while (spriteZipCache.size > MAX_CACHED_SPRITE_ARCHIVES) {
    const oldest = spriteZipCache.keys().next().value;
    if (oldest) spriteZipCache.delete(oldest);
  }
  pending.catch(() => {
    if (spriteZipCache.get(name) === pending) spriteZipCache.delete(name);
  });
  return pending;
}

/**
 * Return the path relative to the spritesheets directory for either URL form
 * used by the app ("/spritesheets/..." or "spritesheets/..."). Other URLs are
 * left untouched so web loading and non-sprite assets retain their old path.
 */
export function getSpriteArchiveRelativePath(src: string): string | null {
  let normalized = src;
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  while (normalized.startsWith("/")) normalized = normalized.slice(1);
  if (!normalized.startsWith("spritesheets/")) return null;
  return normalized.slice("spritesheets/".length);
}

/** Resolve a sprite from a sharded archive on Android; keep ordinary URLs on web. */
async function resolveSpriteSource(src: string): Promise<{ url: string; revoke: boolean }> {
  const relativePath = getSpriteArchiveRelativePath(src);
  if (!isNativeAndroid() || relativePath === null) {
    return { url: src, revoke: false };
  }
  const index = await getSpriteIndex();
  const archiveName = index.files[relativePath];
  if (!archiveName) throw new Error(`Sprite not found in archive index: ${relativePath}`);

  const zip = await getSpriteArchive(archiveName);
  const entry = zip.file(relativePath);
  if (!entry) throw new Error(`Sprite missing from archive ${archiveName}: ${relativePath}`);

  const blob = await entry.async("blob");
  return { url: URL.createObjectURL(blob), revoke: true };
}

/**
 * Clears in-memory images and archive lookup state. Browser tests call this
 * so injected Image constructors and archive fetches cannot leak between specs.
 */
export function resetImageLoadCache(): void {
  loadedImages = {};
  inFlight.clear();
  spriteIndexPromise = null;
  spriteZipCache.clear();
  resetImageLoadStats();
  loadImageForTests = null;
}

/** Load an image. Rejects with `Error("Failed to load <src>")` on error. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  if (loadImageForTests) return loadImageForTests(src);
  if (loadedImages[src]) {
    imageLoadStats.cacheHits++;
    return Promise.resolve(loadedImages[src]);
  }
  const existing = inFlight.get(src);
  if (existing) return existing;
  imageLoadStats.loads++;

  let resolve!: (img: HTMLImageElement) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<HTMLImageElement>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  inFlight.set(src, promise);

  const profiler = (window as WindowWithProfiler).profiler;
  if (profiler) profiler.mark(`image-load:${src}:start`);

  const img = new Image();
  img.onload = () => {
    loadedImages[src] = img;
    inFlight.delete(src);
    if (profiler) {
      profiler.mark(`image-load:${src}:end`);
      profiler.measure(
        `image-load:${src}`,
        `image-load:${src}:start`,
        `image-load:${src}:end`,
      );
    }
    resolve(img);
  };
  img.onerror = () => {
    inFlight.delete(src);
    console.error(`Failed to load image: ${src}`);
    reject(new Error(`Failed to load ${src}`));
  };

  void resolveSpriteSource(src)
    .then(({ url, revoke }) => {
      img.onload = () => {
        if (revoke) URL.revokeObjectURL(url);
        loadedImages[src] = img;
        inFlight.delete(src);
        if (profiler) {
          profiler.mark(`image-load:${src}:end`);
          profiler.measure(`image-load:${src}`, `image-load:${src}:start`, `image-load:${src}:end`);
        }
        resolve(img);
      };
      img.onerror = () => {
        if (revoke) URL.revokeObjectURL(url);
        inFlight.delete(src);
        console.error(`Failed to load image: ${src}`);
        reject(new Error(`Failed to load ${src}`));
      };
      img.src = url;
    })
    .catch((error: unknown) => {
      inFlight.delete(src);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to load image: ${src}`, message);
      reject(new Error(`Failed to load ${src}: ${message}`));
    });

  return promise;
}

export type LoadedImage<T> = { item: T; img: HTMLImageElement | null; success: boolean };

export async function loadImagesInParallel<T>(
  items: T[],
  getPath: (item: T) => string = (item) =>
    (item as { spritePath: string }).spritePath,
): Promise<LoadedImage<T>[]> {
  const promises = items.map((item): Promise<LoadedImage<T>> =>
    loadImage(getPath(item))
      .then((img): LoadedImage<T> => ({ item, img, success: true }))
      .catch(() => {
        debugWarn(`Failed to load sprite: ${getPath(item)}`);
        return { item, img: null, success: false };
      }),
  );
  return Promise.all(promises);
}
