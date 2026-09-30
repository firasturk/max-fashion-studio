/** Downsized JPEG used for inference and thumbnails so large originals never leave the browser twice. */
export async function makeReference(file: Blob, maxEdge = 1600, quality = 0.94): Promise<Blob> {
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Unable to prepare image."))),
        "image/jpeg",
        quality,
      ),
    );
  } finally {
    image.close();
  }
}
