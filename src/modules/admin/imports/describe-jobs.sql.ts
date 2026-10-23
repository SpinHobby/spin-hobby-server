// SQL shared by DescribeJobsService (next to this file). A query lives here when it is long or used more than once;
// a short query used once stays in the service, next to the code that reads its rows.

/**
 * Each description job with what its product has now (description, series, maker, category, character), for the admin's
 * review screen and for the photo computer's hints. Add `where`, `order by` and `limit` after it.
 */
export const JOBS_WITH_PRODUCT = `
  select j.*, p.description as current_description, m.series as current_series, m.manufacturer as current_manufacturer,
         p.category, m.character
    from public.describe_jobs j
    join public.catalog_products p on p.square_item_id = j.square_item_id
    left join public.product_metadata m on m.square_item_id = j.square_item_id`;
