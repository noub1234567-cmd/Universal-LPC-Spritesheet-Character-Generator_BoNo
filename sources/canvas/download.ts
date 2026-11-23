import { saveExportBlob } from "../utils/save-export.ts";
import type { ResultAsync } from "neverthrow";
import { canvasToBlob } from "./canvas-utils.ts";
import { getCanvas, type CanvasNotInitialized } from "./renderer.ts";

type GetCanvasBlobFn = () => ResultAsync<Blob, CanvasNotInitialized>;

export async function downloadAsPNG(
  filename: string = "character-spritesheet.png",
  getCanvasBlobFunc: GetCanvasBlobFn = () => getCanvas().asyncMap(canvasToBlob),
): Promise<void> {
  const blobResult = await getCanvasBlobFunc();
  if (blobResult.isErr()) {
    console.error("Error downloading PNG:", blobResult.error);
    alert("Could not create the PNG export.");
    return;
  }
  try {
    await saveExportBlob(blobResult.value, filename);
  } catch (error) {
    console.error("Error saving PNG export:", error);
    alert("Could not save the PNG. Please choose a save location from the Android share menu and try again.");
  }
}

export async function downloadFile(
  content: string,
  filename: string,
  type: string = "text/plain",
): Promise<void> {
  try {
    await saveExportBlob(new Blob([content], { type }), filename);
  } catch (error) {
    console.error("Error saving file export:", error);
    alert("Could not save the file. Please try again.");
  }
}
