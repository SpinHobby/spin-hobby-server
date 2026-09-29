-- These tables are intentionally private to Edge Functions. Explicit policies
-- make the service-only data path clear to the Supabase Security Advisor.
create policy "Edge Functions manage admin logs" on public.admin_logs
  for all to service_role using (true) with check (true);
create policy "Edge Functions manage catalog products" on public.catalog_products
  for all to service_role using (true) with check (true);
create policy "Edge Functions manage catalog variations" on public.catalog_variations
  for all to service_role using (true) with check (true);
create policy "Edge Functions manage hero slides" on public.hero_slides
  for all to service_role using (true) with check (true);
create policy "Edge Functions manage inventory snapshots" on public.inventory_snapshots
  for all to service_role using (true) with check (true);
create policy "Edge Functions manage product images" on public.product_images
  for all to service_role using (true) with check (true);
create policy "Edge Functions manage product metadata" on public.product_metadata
  for all to service_role using (true) with check (true);
create policy "Edge Functions manage sales statistics" on public.sales_stats
  for all to service_role using (true) with check (true);
create policy "Edge Functions manage store events" on public.store_events
  for all to service_role using (true) with check (true);
create policy "Edge Functions manage store settings" on public.store_settings
  for all to service_role using (true) with check (true);
create policy "Edge Functions manage tax rates" on public.tax_rates
  for all to service_role using (true) with check (true);
create policy "Edge Functions manage webhook events" on public.webhook_events
  for all to service_role using (true) with check (true);
