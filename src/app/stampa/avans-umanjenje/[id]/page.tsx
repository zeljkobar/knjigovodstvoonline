import { AdvanceSettlementPrint } from "@/components/AdvanceSettlementPrint";
export default async function Page({params}:{params:Promise<{id:string}>}) { const {id}=await params;return <AdvanceSettlementPrint id={id}/>; }
