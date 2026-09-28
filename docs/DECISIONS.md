# Karar Kaydı

## 2026-09-28 — MVP sıralaması: önce stok/fiyat senkronu

**Karar:** Ürün yaratmadan (Faz 6, 8) önce "mevcut Trendyol ürünlerini içe aktar → barkodla XML'e eşle → stok/fiyat senkronu" dilimi yapılacak.
**Gerekçe:** Asıl sorun güncel olmayan stok yüzünden iptal ve ceza. Hedef satıcıların çoğunun ürünleri zaten Trendyol'da. Bu dilim, en zor kısım olan kategori/özellik eşleştirmesini beklemeden pilot kullanıcıya değer verir.
**Alternatif:** ROADMAP'teki faz sırası (1→13).

## 2026-09-28 — Teknoloji yığını

**Karar:** Node.js 24 LTS, TypeScript 6.0, pnpm workspaces, Fastify (API), Drizzle (ORM), PostgreSQL, BullMQ + Redis, Next.js (panel), Vitest, Zod.
**Gerekçe:** Fastify + Drizzle hafif ve az sihirli, SQL'e yakın. TypeScript 7 yayında ama typescript-eslint henüz <6.1 destekliyor. Vitest 5 Node 25'i desteklemiyor, bu yüzden Vitest 4 ve Node 24 LTS seçildi.
**Alternatif:** NestJS + Prisma.

## 2026-09-28 — Lokal geliştirme ortamı

**Karar:** PostgreSQL ve Redis `docker-compose.yml` ile çalışacak (OrbStack veya Docker Desktop).

## 2026-09-28 — Trendyol erişim stratejisi

**Karar:** Geliştirme mock sunucuyla yapılacak. İlk gerçek doğrulama, kendi satıcı hesabıyla **canlı ortamda salt-okuma** çağrılarıyla yapılacak (User-Agent: `"{SatıcıId} - SelfIntegration"`). Yazma çağrıları yalnızca açık onayla ve 1–5 ürünle denenecek. Stage başvurusu paralel ve acelesiz yürütülecek.
**Gerekçe:** Canlıda IP yetkilendirmesi yok; stage sabit IP ve başvuru istiyor. Authorization dokümanı, kendi yazılımını kullanan satıcı için `SelfIntegration` formatını tanımlıyor.
**Not:** Bu, ROADMAP §0 kural 7'nin ("canlıya asla test isteği atma") kullanıcı onayıyla, salt-okuma sınırında esnetilmesidir.

## 2026-09-28 — Para hesabı ve fiyat motoru

**Karar:** Tüm tutarlar kuruş cinsinden tamsayı. Hesap sırası: maliyet → döviz → çarpan → sabit ekleme → komisyon sonrası marj tabanı → yuvarlama (yukarı, bitiş hanesine) → min/max → guardrail'ler.
**Gerekçe:** Kayan nokta hatasının fiyata yansımaması. Yuvarlama yukarı yapıldığı için marj tabanı bozulmaz.
**Açık:** KDV yaklaşımı (⚠️ DOĞRULA #5) çözülene kadar motor KDV dönüşümü yapmıyor; maliyet olduğu gibi kullanılıyor.

## 2026-09-28 — XML indirme: yeni bağımlılık yok

**Karar:** SSRF koruması Node'un `http`/`https` modülü (`lookup` kancası) ve `net.BlockList` ile yapıldı. Yalnızca ROADMAP'te adı geçen `saxes` ve `iconv-lite` eklendi.
**Gerekçe:** Kontrol DNS çözümlemesi anında yapıldığı için DNS rebinding ile atlatılamaz. IP literal'leri ayrıca kontrol edilir. Farklı host'a yönlendirmede tedarikçi auth header'ları gönderilmez.
**Alternatif:** `undici` + `ipaddr.js`.

## 2026-09-28 — Rate limiter: kayan pencere

**Karar:** Token bucket yerine kayan pencere (sliding window log). Anahtarlar `ty:{sellerId}:group:{grup}` ve `ty:{sellerId}:endpoint:{endpoint}`.
**Gerekçe:** Trendyol limitleri "10 saniyede 50", "dakikada N" gibi pencere tanımlı; kayan pencere bu tanıma birebir uyar, patlama (burst) ile limit aşımı olmaz. Limitler API bilgisi (satıcı) bazında olduğu için anahtar tenant değil sellerId.
**Açık:** Üretim için Redis uygulaması (çok süreçli worker) BullMQ kurulumuyla yazılacak.

## 2026-09-28 — Barkod normalizasyonu

**Karar:** Boşluklar silinir. Geçersiz karakterler sessizce silinmez, hata olarak raporlanır.
**Gerekçe:** Sessiz silme iki farklı barkodu çakıştırabilir.

## 2026-09-28 — Gizli bilgi şifreleme

**Karar:** AES-256-GCM, 12 bayt rastgele IV. Biçim `v{sürüm}:{iv}:{tag}:{veri}` (base64url). Güncel anahtar `SECRETS_ENCRYPTION_KEY` + `SECRETS_ENCRYPTION_KEY_VERSION`, eski anahtarlar `SECRETS_ENCRYPTION_PREVIOUS_KEYS` ("1:base64,..."). Şifreleme bağlamı (AAD) zorunlu, ör. `tenant:{id}:trendyol_api_secret`.
**Gerekçe:** AAD sayesinde bir tenant'ın şifreli değeri başka satıra kopyalansa bile çözülemez. Sürüm alanı ile rotasyon kesintisiz yapılır: eski kayıtlar çözülür, `needsRotation` ile bulunup yeniden şifrelenir.
**Alternatif:** KMS (AWS/GCP). Barındırma yeri seçildiğinde `SecretBox` arayüzü korunarak eklenebilir.

## 2026-09-28 — Loglama

**Karar:** pino + her log nesnesinde anahtar adına göre `redact`. pino'nun yol tabanlı `redact` seçeneği kullanılmadı.
**Gerekçe:** Yol listesi yeni alanlarda unutulabilir; anahtar adı eşleşmesi derinlikten bağımsız maskeler.

## 2026-09-28 — Redis rate limiter

**Karar:** Sorted set üzerinde kayan pencere, tek Lua betiğinde atomik. Saat olarak Redis `TIME` kullanılır. Paket ioredis'e doğrudan bağımlı değildir (`eval` arayüzü).
**Gerekçe:** Çok süreçli worker'lar aynı satıcı için yarışsa da limit aşılmaz; worker saat kayması etkilemez.

## 2026-09-28 — Veritabanı ve tenant izolasyonu

**Karar:** `packages/db`: Drizzle + postgres.js. Migration'lar `drizzle-kit generate` ile üretilir, RLS ve bileşik FK'ler elle yazılmış ayrı bir migration'dadır (`0001_rls.sql`). Tenant verisine yalnızca `withTenant(db, tenantId, fn)` ile erişilir: işlem içinde `SET LOCAL ROLE trendy_app` + `app.tenant_id` ayarı yapılır. Tablo sahibi RLS'e tabi değildir; kayıt, giriş ve tüm tenant'ları tarayan zamanlayıcı gibi sistem işlemleri bu bağlantıyla yapılır.
**Ayrıntılar:**

- Tenant'a ait her tabloda (alt tablolar dahil) `tenant_id` var; politika tek tip. CI testi, `tenant_id` sütunu olup RLS listesinde olmayan tablo bırakmaz.
- FK kontrolü RLS'i atladığından, tenant içi ilişkiler `(tenant_id, x_id) → (tenant_id, id)` bileşik FK ile korunur.
- `users` global tablodur (giriş sırasında tenant bilinmez); uygulama rolü `password_hash` sütununu okuyamaz. Rol `tenant_members` tablosunda.
- Para kuruş tamsayı, barkod normalize hâliyle saklanır.
- Kategori, özellik ve marka önbellek tabloları Faz 3'te eklenecek.

**Gerekçe:** İzolasyonun uygulama kodundaki `where tenant_id = ?` disiplinine bırakılmaması; unutulan bir filtre veri sızıntısına yol açmasın.
**Alternatif:** Tenant başına şema veya veritabanı. Çok sayıda küçük tenant için migration ve bağlantı yönetimi ağır.
