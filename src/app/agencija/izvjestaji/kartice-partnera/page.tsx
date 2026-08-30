import AnalitickeKarticePage from "../../nalozi/analiticke-kartice/page";

type PageProps = {
  searchParams?: Promise<{
    datum_do?: string;
    datum_od?: string;
    konto?: string;
    konto_q?: string;
    konto_prefix?: string;
    partner?: string;
    partner_q?: string;
    sva_konta?: string;
  }>;
};

export default async function ReportsPartnerCardsPage({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <AnalitickeKarticePage
      searchParams={Promise.resolve({ ...params, prikaz: "partner" })}
    />
  );
}
