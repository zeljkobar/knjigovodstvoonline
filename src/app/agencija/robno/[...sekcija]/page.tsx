import { ModulePlaceholder } from "@/components/ModulePlaceholder";
import { notFound } from "next/navigation";

type RobnoPlaceholderPageProps = {
  params: Promise<{
    sekcija: string[];
  }>;
};

const robnoPlaceholders: Record<
  string,
  {
    eyebrow: string;
    title: string;
  }
> = {
  sifarnici: { eyebrow: "Robno / Šifarnici", title: "Šifarnici" },
  artikli: { eyebrow: "Robno / Šifarnici", title: "Artikli" },
  grupe: { eyebrow: "Robno / Šifarnici", title: "Grupe artikala" },
  cijene: { eyebrow: "Robno / Šifarnici", title: "Cijene artikala" },
  magacini: { eyebrow: "Robno / Šifarnici", title: "Magacini" },
  nabavka: { eyebrow: "Robno / Nabavka", title: "Nabavka" },
  kalkulacije: { eyebrow: "Robno / Nabavka", title: "Kalkulacije" },
  "uvozne-kalkulacije": {
    eyebrow: "Robno / Nabavka",
    title: "Uvozne kalkulacije"
  },
  "povrat-dobavljacu": {
    eyebrow: "Robno / Nabavka",
    title: "Povrat dobavljaču"
  },
  prodaja: { eyebrow: "Robno / Prodaja", title: "Prodaja" },
  "izlazne-fakture": {
    eyebrow: "Robno / Prodaja",
    title: "Izlazne fakture"
  },
  "nova-izlazna-faktura": {
    eyebrow: "Robno / Prodaja",
    title: "Nova izlazna faktura"
  },
  "razduzenja-lagera": {
    eyebrow: "Robno / Prodaja",
    title: "Razduženja lagera"
  },
  "povrat-kupca": { eyebrow: "Robno / Prodaja", title: "Povrat kupca" },
  promet: { eyebrow: "Robno / Promet robe", title: "Promet robe" },
  prenos: { eyebrow: "Robno / Promet robe", title: "Prenos robe" },
  popis: { eyebrow: "Robno / Promet robe", title: "Popis robe" },
  otpis: { eyebrow: "Robno / Promet robe", title: "Otpis robe" },
  nivelacija: { eyebrow: "Robno / Promet robe", title: "Nivelacija cijena" },
  zalihe: { eyebrow: "Robno / Zalihe", title: "Zalihe" },
  lager: { eyebrow: "Robno / Zalihe", title: "Lager lista" },
  "kartica-artikla": {
    eyebrow: "Robno / Zalihe",
    title: "Kartica artikla"
  },
  "vrijednost-zaliha": {
    eyebrow: "Robno / Zalihe",
    title: "Vrijednost zaliha"
  },
  kontrole: { eyebrow: "Robno / Zalihe", title: "Kontrole zaliha" }
};

export default async function RobnoPlaceholderPage({
  params
}: RobnoPlaceholderPageProps) {
  const { sekcija } = await params;
  const placeholder = robnoPlaceholders[sekcija.join("/")];

  if (!placeholder) {
    notFound();
  }

  return (
    <ModulePlaceholder
      eyebrow={placeholder.eyebrow}
      title={placeholder.title}
    />
  );
}
