import { randomUUID } from "node:crypto";
import { getDeployStatus } from "./actions";
import { DeployDashboard } from "./DeployDashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DeployPage() {
  return <DeployDashboard initial={await getDeployStatus()} requestId={randomUUID()} />;
}
