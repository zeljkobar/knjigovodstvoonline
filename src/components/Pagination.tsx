type PaginationProps = {
  total: number;
  pageSize: number;
  currentPage: number;
  searchParams: Record<string, string | undefined>;
};

function buildUrl(
  searchParams: Record<string, string | undefined>,
  page: number
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (value && key !== "stranica") {
      params.set(key, value);
    }
  }

  if (page > 1) {
    params.set("stranica", String(page));
  }

  const query = params.toString();
  return query ? `?${query}` : "?";
}

function pageNumbers(total: number, current: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "...")[] = [1];

  if (current > 3) {
    pages.push("...");
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push("...");
  }

  pages.push(total);
  return pages;
}

export function Pagination({
  total,
  pageSize,
  currentPage,
  searchParams
}: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);

  if (totalPages <= 1) {
    return null;
  }

  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <nav aria-label="Stranice" className="pagination">
      {hasPrev ? (
        <a className="pagination-btn" href={buildUrl(searchParams, currentPage - 1)}>
          ← Prethodna
        </a>
      ) : (
        <span aria-disabled className="pagination-btn pagination-btn--disabled">
          ← Prethodna
        </span>
      )}

      <div className="pagination-pages">
        {pageNumbers(totalPages, currentPage).map((page, i) =>
          page === "..." ? (
            <span className="pagination-ellipsis" key={`ellipsis-${i}`}>…</span>
          ) : (
            <a
              aria-current={page === currentPage ? "page" : undefined}
              className={
                page === currentPage
                  ? "pagination-page pagination-page--active"
                  : "pagination-page"
              }
              href={buildUrl(searchParams, page)}
              key={page}
            >
              {page}
            </a>
          )
        )}
      </div>

      {hasNext ? (
        <a className="pagination-btn" href={buildUrl(searchParams, currentPage + 1)}>
          Sljedeća →
        </a>
      ) : (
        <span aria-disabled className="pagination-btn pagination-btn--disabled">
          Sljedeća →
        </span>
      )}
    </nav>
  );
}
