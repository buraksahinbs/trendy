-- Tenant izolasyonu (ROADMAP §4, §7).
--
-- 1) Row Level Security: Uygulama tenant işlemlerini `trendy_app` rolüne geçerek yapar
--    (`withTenant`). Bu rol için her tenant tablosunda yalnızca
--    `tenant_id = current_setting('app.tenant_id')` satırları görünür ve yazılabilir.
--    Tablo sahibi (migration kullanıcısı) RLS'e tabi değildir; kayıt, giriş ve tüm tenant'ları
--    tarayan zamanlayıcı gibi sistem işlemleri bu bağlantıyla yapılır.
--
-- 2) Bileşik foreign key'ler: FK kontrolü RLS'i atlar. Tek sütunlu FK ile bir tenant kendi
--    satırını başka tenant'ın kaydına bağlayabilirdi. `(tenant_id, x_id)` → `(tenant_id, id)`
--    FK'leri bunu veritabanı seviyesinde imkânsız kılar.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trendy_app') THEN
    CREATE ROLE trendy_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('GRANT trendy_app TO %I', current_user);
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO trendy_app;
--> statement-breakpoint
GRANT SELECT ON tenants TO trendy_app;
--> statement-breakpoint
GRANT SELECT (id, email, created_at) ON users TO trendy_app;
--> statement-breakpoint
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'tenant_members', 'trendyol_credentials', 'suppliers', 'supplier_field_mappings',
    'supplier_products', 'products', 'variants', 'pricing_rules', 'channel_listings',
    'price_reviews', 'ty_batches', 'orders', 'order_lines', 'sync_cursors', 'job_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO trendy_app
         USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::bigint)
         WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::bigint)',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO trendy_app', t);
  END LOOP;
END
$$;
--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO trendy_app;
--> statement-breakpoint
-- Tenant-içi tutarlılık için üst tablolarda (tenant_id, id) benzersizliği.
ALTER TABLE suppliers ADD CONSTRAINT suppliers_tenant_id_uq UNIQUE (tenant_id, id);
--> statement-breakpoint
ALTER TABLE supplier_products ADD CONSTRAINT supplier_products_tenant_id_uq UNIQUE (tenant_id, id);
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_tenant_id_uq UNIQUE (tenant_id, id);
--> statement-breakpoint
ALTER TABLE variants ADD CONSTRAINT variants_tenant_id_uq UNIQUE (tenant_id, id);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_tenant_id_uq UNIQUE (tenant_id, id);
--> statement-breakpoint
ALTER TABLE supplier_field_mappings ADD CONSTRAINT supplier_field_mappings_tenant_supplier_fk
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers (tenant_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE supplier_products ADD CONSTRAINT supplier_products_tenant_supplier_fk
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers (tenant_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_tenant_supplier_fk
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers (tenant_id, id)
  ON DELETE SET NULL (supplier_id);
--> statement-breakpoint
ALTER TABLE variants ADD CONSTRAINT variants_tenant_product_fk
  FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE variants ADD CONSTRAINT variants_tenant_supplier_product_fk
  FOREIGN KEY (tenant_id, supplier_product_id) REFERENCES supplier_products (tenant_id, id)
  ON DELETE SET NULL (supplier_product_id);
--> statement-breakpoint
ALTER TABLE channel_listings ADD CONSTRAINT channel_listings_tenant_variant_fk
  FOREIGN KEY (tenant_id, variant_id) REFERENCES variants (tenant_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE price_reviews ADD CONSTRAINT price_reviews_tenant_variant_fk
  FOREIGN KEY (tenant_id, variant_id) REFERENCES variants (tenant_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE order_lines ADD CONSTRAINT order_lines_tenant_order_fk
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders (tenant_id, id) ON DELETE CASCADE;
