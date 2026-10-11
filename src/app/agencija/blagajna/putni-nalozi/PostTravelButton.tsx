"use client";
import { useFormStatus } from "react-dom";
export default function PostTravelButton() {
  const { pending } = useFormStatus();
  return <button disabled={pending}>{pending ? "Knjiženje…" : "Proknjiži"}</button>;
}
