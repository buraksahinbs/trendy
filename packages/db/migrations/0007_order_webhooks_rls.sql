-- order_webhooks: diğer tenant tabloları gibi RLS (bkz. 0001_rls.sql).
ALTER TABLE order_webhooks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON order_webhooks TO trendy_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON order_webhooks TO trendy_app;
