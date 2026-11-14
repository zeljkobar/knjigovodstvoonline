import { NextRequest, NextResponse } from "next/server";
import { completeDocument, dokumentaContext, DokumentaError, prepareDocument } from "@/lib/dokumentacija";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body?.yearId !== "string") throw new DokumentaError("Izaberite poslovnu godinu.");
    const context = await dokumentaContext("create", body.yearId);
    if (body.operation === "complete") {
      await completeDocument(context, body.id);
      return NextResponse.json({ ok: true });
    }
    if (body.operation !== "prepare") throw new DokumentaError("Nepoznata radnja.");
    return NextResponse.json(await prepareDocument(context, body));
  } catch (error) {
    return NextResponse.json({ message: error instanceof DokumentaError ? error.message :
      "OneDrive nije potvrdio prijem. Pokušajte ponovo." }, { status: error instanceof DokumentaError ? error.status : 502 });
  }
}
