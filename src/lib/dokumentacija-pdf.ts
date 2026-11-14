// The camera supplies JPEG pages. Build a PDF without moving image data to the server.
export async function cameraPdf(images: File[]) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const offsets = [0];
  let size = 0;
  function write(value: string | Uint8Array<ArrayBuffer>) {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    chunks.push(bytes);
    size += bytes.length;
  }
  function object(id: number, data: string) {
    offsets[id] = size;
    write(`${id} 0 obj\n${data}\nendobj\n`);
  }

  write("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Count ${images.length} /Kids [${images.map((_, i) => `${i * 3 + 3} 0 R`).join(" ")}] >>`);
  for (const [index, image] of images.entries()) {
    const bitmap = await createImageBitmap(image);
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 2100 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) { bitmap.close(); throw new Error("Obrada fotografije nije dostupna."); }
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!jpeg) throw new Error("Fotografija nije obrađena.");
    const id = index * 3 + 3;
    const width = +(canvas.width / 3).toFixed(2);
    const height = +(canvas.height / 3).toFixed(2);
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    offsets[id + 1] = size;
    write(`${id + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.size} >>\nstream\n`);
    write(new Uint8Array(await jpeg.arrayBuffer()));
    write("\nendstream\nendobj\n");
    const drawing = `q ${width} 0 0 ${height} 0 0 cm /Im Do Q`;
    object(id + 2, `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`);
  }
  const xref = size;
  write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) write(`${String(offset).padStart(10, "0")} 00000 n \n`);
  write(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new File(chunks, "Sken računa.pdf", { type: "application/pdf" });
}
