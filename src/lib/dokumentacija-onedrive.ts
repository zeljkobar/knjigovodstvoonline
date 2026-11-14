import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { prisma } from "./prisma";

export type DriveItem = {
  id: string;
  name: string;
  size?: number;
  folder?: object;
  file?: { mimeType: string };
  parentReference?: { id: string; driveId: string };
};

export function oneDriveSettings() {
  const clientId = process.env.DOKUMENTA_ONEDRIVE_CLIENT_ID;
  const secret = process.env.DOKUMENTA_ONEDRIVE_CLIENT_SECRET;
  const redirectUri = process.env.DOKUMENTA_ONEDRIVE_REDIRECT_URI;
  if (!clientId || !secret || !redirectUri) throw new Error("OneDrive integracija nije podešena.");
  return { clientId, secret, redirectUri };
}

const microsoft = "https://login.microsoftonline.com/common/oauth2/v2.0";
export const oneDriveScope = "offline_access Files.ReadWrite";

function encryptionKey() {
  const key = Buffer.from(process.env.DOKUMENTA_ONEDRIVE_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("OneDrive ključ nije podešen.");
  return key;
}

function seal(value: string, agencyId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(agencyId));
  return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString("base64");
}

function unseal(value: string, agencyId: string) {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(agencyId));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString();
}

export function oneDriveConsent(state: string) {
  const { clientId, redirectUri } = oneDriveSettings();
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state,
    scope: oneDriveScope, response_type: "code", prompt: "select_account" });
  return `${microsoft}/authorize?${query}`;
}

async function microsoftToken(parameters: Record<string, string>) {
  const { clientId, secret, redirectUri } = oneDriveSettings();
  const response = await fetch(`${microsoft}/token`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(12000),
    body: new URLSearchParams({ client_id: clientId, client_secret: secret,
      redirect_uri: redirectUri, scope: oneDriveScope, ...parameters })
  });
  if (!response.ok) throw new Error("OneDrive autorizacija nije uspjela. Provjerite vezu sa nalogom.");
  const token = await response.json() as { access_token: string; refresh_token?: string };
  if (!token.access_token) throw new Error("OneDrive nije vratio token.");
  return token;
}

export class GraphError extends Error {
  constructor(public status: number) {
    super(`OneDrive operacija nije uspjela (HTTP ${status}).`);
  }
}

const graphRoot = "https://graph.microsoft.com/v1.0";
export async function graphResponse(accessToken: string, path: string, options?: RequestInit) {
  const url = new URL(path, graphRoot + "/");
  if (url.origin !== "https://graph.microsoft.com" || !url.pathname.startsWith("/v1.0/")) {
    throw new Error("Neispravna OneDrive adresa.");
  }
  const response = await fetch(url, {
    ...options, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...options?.headers }
  });
  if (!response.ok) throw new GraphError(response.status);
  return response;
}

export async function graph<T>(accessToken: string, path: string, options?: RequestInit): Promise<T> {
  return (await graphResponse(accessToken, path, options)).json();
}

export async function connectOneDrive(agencyId: string, code: string) {
  const token = await microsoftToken({ grant_type: "authorization_code", code });
  if (!token.refresh_token) throw new Error("OneDrive nije dozvolio pozadinski pristup.");
  const drive = await graph<{ id: string }>(token.access_token, "me/drive");
  const old = await prisma.dokumentaOneDrive.findUnique({ where: { agencija_id: agencyId } });
  if (old && old.drive_id !== drive.id && await prisma.dokumentaFolder.count({ where: { agencija_id: agencyId } })) {
    throw new Error("Povežite isti OneDrive nalog koji je već dodijeljen firmama.");
  }
  await prisma.dokumentaOneDrive.upsert({
    where: { agencija_id: agencyId },
    create: { agencija_id: agencyId, drive_id: drive.id, refresh_token: seal(token.refresh_token, agencyId) },
    update: { drive_id: drive.id, refresh_token: seal(token.refresh_token, agencyId) }
  });
}

export async function oneDriveAccess(agencyId: string) {
  const connection = await prisma.dokumentaOneDrive.findUnique({ where: { agencija_id: agencyId } });
  if (!connection) throw new Error("Agencija još nije povezala OneDrive.");
  const token = await microsoftToken({ grant_type: "refresh_token", refresh_token: unseal(connection.refresh_token, agencyId) });
  if (token.refresh_token) {
    await prisma.dokumentaOneDrive.updateMany({
      where: { agencija_id: agencyId, refresh_token: connection.refresh_token },
      data: { refresh_token: seal(token.refresh_token, agencyId) }
    });
  }
  return { token: token.access_token, driveId: connection.drive_id };
}

export function driveItemPath(driveId: string, itemId: string) {
  return `drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
}

export async function driveChildren(token: string, driveId: string, parent: string) {
  const items: DriveItem[] = [];
  let path: string | undefined = `${driveItemPath(driveId, parent)}/children?$top=200`;
  while (path) {
    const page: { value: DriveItem[]; "@odata.nextLink"?: string } = await graph(token, path);
    items.push(...page.value);
    path = page["@odata.nextLink"];
  }
  return items;
}

export async function ensureDriveFolder(token: string, driveId: string, parent: string, segments: string[]) {
  for (const name of segments) {
    const base = driveItemPath(driveId, parent);
    const lookup = `${base}:/${encodeURIComponent(name)}`;
    let item: DriveItem;
    try {
      item = await graph(token, lookup);
    } catch (error) {
      if (!(error instanceof GraphError) || error.status !== 404) throw error;
      try {
        item = await graph(token, `${base}/children`, {
          method: "POST", body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
        });
      } catch (conflict) {
        if (!(conflict instanceof GraphError) || conflict.status !== 409) throw conflict;
        item = await graph(token, lookup);
      }
    }
    if (!item.folder) throw new Error("OneDrive odredište nije folder.");
    parent = item.id;
  }
  return parent;
}
