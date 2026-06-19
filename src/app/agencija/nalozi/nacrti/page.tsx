import { redirect } from "next/navigation";

export default function NacrtiNalogaPage() {
  redirect("/agencija/nalozi?status=DRAFT");
}
