import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read export"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected export encoding"));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Save an export through Android's native share sheet on device.
 * In browsers, use a normal download link and keep its object URL alive long
 * enough for the browser to start consuming it.
 */
export async function saveExportBlob(blob: Blob, filename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const data = await blobToBase64(blob);
    const saved = await Filesystem.writeFile({
      path: filename,
      data,
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({
      title: filename,
      dialogTitle: "Save or share exported file",
      files: [saved.uri],
    });
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 2000);
}
