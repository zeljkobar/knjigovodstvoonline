import PdvPage from "../../pdv/page";

type PageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

export default function ReportsPdvPage({ searchParams }: PageProps) {
  return <PdvPage searchParams={searchParams} />;
}
