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

## 2026-09-28 — Kimlik doğrulama ve oturum

**Karar:** Sunucu tarafı oturum (`sessions` tablosu) + HttpOnly, `SameSite=Lax` cookie; üretimde `Secure` ve `__Host-` önekli. Veritabanında token'ın yalnızca SHA-256 özeti tutulur. Şifre hash'i argon2id (`@node-rs/argon2`, OWASP varsayılanları).
**Ayrıntılar:**

- Giriş hatası tek tip ("E-posta veya şifre hatalı"); kullanıcı yoksa da sahte hash doğrulanır, yanıt süresinden e-postanın kayıtlı olup olmadığı anlaşılmaz.
- Giriş, kayıt ve şifre değiştirme denemeleri e-posta başına 10, IP başına 50 / 15 dk ile sınırlı (`RateLimiter`; üretimde Redis).
- Şifre değişince kullanıcının tüm oturumları silinir.
- Aktif tenant oturumda tutulur; üyelik her istekte kontrol edilir, kullanıcı mağazadan çıkarılınca erişimi hemen kesilir.
- CSRF: `SameSite=Lax` başka siteden gelen POST isteklerinde cookie'yi göndermez. Panel farklı bir alan adına taşınırsa ek CSRF token'ı değerlendirilmeli.

**Gerekçe:** JWT'ye göre oturum anında iptal edilebilir (çıkış, şifre değişikliği, mağazadan çıkarılma); token sızıntısında veritabanı özetinden oturum üretilemez.
**Alternatif:** JWT + refresh token.

## 2026-09-28 — Log maskeleme yalnızca düz nesnelerde

**Karar:** `redact` yalnızca düz nesneleri, dizileri ve Error'ları tarar. Date, URL, Buffer ve Fastify req/res gibi sınıf örneklerini olduğu gibi bırakır; bunları pino serializer'ları güvenli alanlarla yazar.
**Gerekçe:** Önceki hâli bu nesneleri boş nesneye çeviriyordu (istek logları `"req":{}` çıkıyordu). Fastify'ın req serializer'ı header ve cookie yazmadığı için gizli bilgi riski yok; testle doğrulandı.

## 2026-09-28 — Tedarikçi XML çekimi ve kuyruk

**Karar:** `apps/worker` BullMQ (v6) ile `xml-fetch` kuyruğunu işler; kuyruk tanımları ve zamanlama `packages/jobs`'ta, API ve worker ortak kullanır. Zamanlayıcı her dakika zamanı gelen tedarikçileri kuyruğa ekler; iş kimliği `supplier-{id}` olduğundan aynı tedarikçi için aynı anda tek çekim olur.
**Ayrıntılar:**

- Her ürünün feed içinde tekil bir kimliği olmalı (`suppliers.external_id_path`, ör. `UrunKodu`, `@id`). Tanımlı değilse çekim "yapılandırma eksik" olarak atlanır. `POST /suppliers/detect` ürün düğümü yolu ve kimlik alanı önerir.
- Kaybolan ürün işaretlemesi (`missing_since`) yalnızca feed hatasız sonuna kadar okunduğunda ve güvenlik freni devrede değilken yapılır. Yarıda kesilen veya bozuk feed ürünleri kayıp göstermez.
- Güvenlik freni devredeyken `last_item_count` güncellenmez: art arda gelen bozuk feed'ler de frene takılır.
- Zamanlayıcı `last_attempt_at`'e bakar (başarısız feed dakikada bir denenmesin). Cron ifadeleri Türkiye saatiyle yorumlanır; en kısa aralık 15 dakika.
- Kalıcı hatalar (bozuk XML, 4xx, engelli adres) tekrar denenmez; ağ hatası, zaman aşımı ve 5xx 3 kez üstel geri çekilmeyle denenir. Kalıcı geçmiş `job_logs`'ta, Redis'te bitmiş iş tutulmaz.
- Stok değişikliği bu job'un işi değil; kanonik ürün ve senkron job'ları (Faz 5, 9) `missing_since` ve ham veriye bakar.

**Alternatif:** Tedarikçi başına BullMQ Job Scheduler. Tedarikçi her değiştiğinde zamanlayıcıyla senkron tutmak gerekirdi; tek bir tarayıcı daha basit ve kendini onarır.

## 2026-09-28 — API bilgisi doğrulama çağrısı

**Karar:** Doğrulama `GET .../products/approved/inventory-and-price?page=0&size=1` ile yapılır (Product Integration Read grubu, salt-okuma). Sunucu hatasında tekrar denenmez (kullanıcı bekliyor); 401 → bilgiler hatalı, 403 → yetki, stage 503 → IP yetkilendirmesi yok olarak ayrıştırılır. Başarıda `verified_at` yazılır ve onaylı content sayısı gösterilir.
**Gerekçe:** Hiçbir veri değiştirmez; canlı ortamda güvenle çalışır. Aynı zamanda senkronun kullanacağı servise erişimi de kanıtlar.
**Alternatif:** Marka/kategori listesi. Satıcıya özel değil, satıcı yetkisini kanıtlamaz.

## 2026-09-28 — Alan eşleştirme ve normalizasyon

**Karar:** Eşleştirme tedarikçi başına tek bir doğrulanmış JSON (`suppliers.mapping`, `MappingConfig` v1). Kullanılmayan `supplier_field_mappings` tablosu kaldırıldı. Normalizasyon çekimin sonunda çalışır ve yalnızca `hash` veya eşleştirmesi değişen ham ürünleri işler (`normalized_hash = hash:eşleştirmeÖzeti`).
**Ayrıntılar:**

- İki varyant yapısı: `flat` (her düğüm bir varyant, model koduyla gruplanır) ve `nested` (`variantPath` altında liste; `../` üst düğümden okur).
- Kullanıcı tanımlı **regex desteklenmez**: felaket geri izleme (ReDoS) worker'ı kilitleyebilir. Yerine bul-değiştir, böl-al, değer eşleme vardır.
- Stok tamsayı: "1.500" ve "1,500" (3 haneli gruplar) 1500 okunur.
- Çakışma: başka tedarikçinin model kodu veya başka ham ürünün barkodu gelirse mevcut kayıt korunur, sorun raporlanır. Sahipsiz kayıtlar (Trendyol'dan içe aktarılan) sahiplenilir.
- Üründen çıkan veya geçersizleşen varyant silinmez: sahipliği bırakılır, stoğu 0 yapılır (Trendyol'a 0 gider, gönderim geçmişi korunur).
- Kaybolan ham ürünler normalize edilmez; stokları senkronda `missingPolicy`'e göre (varsayılan 0) belirlenir.

**Gerekçe:** Tek JSON atomik kaydedilir ve sürümlenir; önizleme aynı motoru kullandığı için "ekranda gördüğün = senkrona giden".
**Alternatif:** Alan başına satır (eski tablo). Varyant modu, dönüşüm zinciri ve özellik listesi için ek tablolar gerekirdi.

## 2026-09-28 — Stok/fiyat senkronu ve Trendyol içe aktarma

**Karar:** Senkron (`ty_sync`), içe aktarma (`ty_import`) ve batch takibi (`poll`) `trendyol` kuyruğunda çalışır. Karar mantığı saf `planSync` fonksiyonundadır.
**Kurallar:**

- Yalnızca **yönetilen** varyantlar (`variants.managed`, bir feed'den normalize edilmiş) senkronlanır. Trendyol'dan içe aktarılıp hiçbir feed'de olmayan ürünlere dokunulmaz; artık varyantlar yönetilen kalır ve 0 gönderilir.
- Yalnızca `approved` durumdaki kayıtlar; kilitli, arşivli, kara listedeki, onaysız ve Trendyol'da artık görünmeyen (`unknown`) kayıtlara istek gitmez.
- Hedef stok: sahipsiz → 0; kaybolan → `missingPolicy` (varsayılan 0); güvenlik stoğunun altı → 0; üst sınır 20.000.
- Fiyat yalnızca fiyat kuralı, maliyet ve (TRY dışı için) elle girilmiş kur varsa gönderilir; yoksa yalnızca stok. Büyük değişim `price_reviews`'a düşer, onaylanırsa bir sonraki turda gönderilir. Maliyet altı fiyat hiçbir koşulda gönderilmez.
- Diff: `last_sent_*` ile karşılaştırılır, yalnızca değişen alan gönderilir. Gönderim kaydı Trendyol çağrısından hemen sonra yazılır (başarısız olmaması için batch kaydı çakışmaya dayanıklı).
- Zamanlama: içe aktarma günlük ve API bilgileri doğrulanınca; senkron 15 dk'da bir ve feed değişince hemen; batch takibi bekleyen batch varsa dakikada bir. İlk içe aktarma yapılmadan senkron yapılmaz.

**Gerekçe:** Yanlış stok/fiyat doğrudan para kaybı ve ürün kilidi demektir; her kural tek bir saf fonksiyonda test edilebilir hâlde tutulur.

## 2026-09-28 — Siparişler

**Karar:** Sipariş çekme `ty_orders` job'u (5 dk'da bir, `getShipmentPackagesStream`), webhook alıcısı ve backfill aynı `upsertOrder` fonksiyonunu kullanır. Anahtar `shipmentPackageId`; daha eski `lastModifiedDate` daha yenisinin üzerine yazmaz.
**Ayrıntılar:**

- İmleç (`sync_cursors.orders`) yalnızca tüm pencereler hatasız bitince ilerler; her tur 4 saat örtüşmeyle başlar (tekrar gelen paket idempotent).
- Sipariş çekme salt-okumadır; stok/fiyat acil durdurmasından etkilenmez.
- **KVKK:** T.C. kimlik no (`identityNumber`, `customerTckn`) hiç saklanmaz (dropshipping için gerekmez). Liste uçları kişisel veri döndürmez; teslimat/fatura adresi yalnızca owner'a gösterilir. Saklama süresi politikası ayrıca uygulanacak.
- Webhook: tenant başına 24 baytlık rastgele URL token'ı + 32 baytlık `x-api-key` (şifreli saklanır, yalnızca oluşturulurken bir kez gösterilir, sabit zamanlı karşılaştırılır). Yol `/hooks/o/:token` ("trendyol" kelimesi geçmez). Webhook yalnızca hızlandırıcıdır; asıl güvence polling'dir.
- Sipariş sonrası yerel stok düşürme (opsiyonel) henüz yok: dropshipping'de kaynak tedarikçi stoğudur, bir sonraki feed çekimi günceller.

**Not:** Tek tablolu drizzle sorgularında alt sorgudan dış sütuna başvururken sütun açıkça nitelenir (`"orders"."id"`); drizzle niteleme yapmadığında iç tablonun sütununa bağlanıp yanlış sonuç veriyordu (testle yakalandı).

## 2026-09-28 — Operasyon: sağlık, uyarılar, KVKK saklama

**Karar:**

- `/health` yalnızca canlılık; `/health/ready` veritabanı, Redis ve worker'ı kontrol eder (worker her dakika Redis'e `worker:heartbeat` yazar, 3 dakikadan eskiyse hazır değil). Yanıtta iç ayrıntı yoktur.
- Uyarılar ayrı tabloda tutulmaz; `tenantAlerts` iş logları (hata sınıfı `summary.errorCode`: auth, rate_limit, validation, deprecated_endpoint, server), tedarikçiler ve kanal durumundan her istekte hesaplar. Sorun düzelince uyarı kendiliğinden kaybolur. Dış bildirim (e-posta) sonraki adım.
- KVKK: kapanmış siparişlerde (Delivered, Cancelled, Returned, UnSupplied) `order_pii_retention_days` gün sonra adres, iletişim ve müşteri adı silinir; sipariş, satır ve tutarlar korunur. Varsayılan 180 gün; hukuki danışmanlıkla belirlenmeli (ROADMAP §7).

**Not:** Ham SQL'de tarih parametreleri ISO metin olarak geçirilir (postgres.js `Date` kabul etmiyor) ve enum dizileri `::text` ile çevrilir (aksi hâlde sürücü diziye çevirmiyor). İkisi de testlerle yakalandı.

## 2026-09-28 — Canlı kurulum: Docker Compose + Caddy

**Karar:** Tek VPS'e Docker Compose ile kurulum (`deploy/`, kılavuz `docs/DEPLOY.md`). Servisler: PostgreSQL 17, Redis 8 (`noeviction`, AOF), `migrate` (her başlatmada migration, sonra biter), API, worker, Next.js paneli (standalone) ve otomatik HTTPS için Caddy.
**Ayrıntılar:**

- Dışarıya yalnızca Caddy açılır (80/443): `/api/*` önek silinerek API'ye, `/hooks/*` ve `/health/ready` API'ye, gerisi panele gider. Veritabanı ve Redis yalnızca iç ağdadır.
- API ve worker TypeScript'i `tsx` ile doğrudan çalıştırır (ayrı derleme adımı yok); bu yüzden `tsx` üretim bağımlılığıdır. İmaj yalnızca `--prod` bağımlılıklarla kurulur ve `node` kullanıcısıyla çalışır.
- API ters proxy arkasında `TRUST_PROXY=true` ile çalışır (gerçek istemci IP'si rate limit ve loglar için).
- `install.sh` rastgele veritabanı şifresi ve `SECRETS_ENCRYPTION_KEY` üretir; `deploy/.env` git'e girmez ve sunucu dışına yedeklenmelidir.
- Yedek: günlük `pg_dump` (14 gün), geri yükleme onay ister. Yedekten dönüş tam kurulumda denendi.

## 2026-09-28 — Güvenilirlik turu ve uçtan uca doğrulama

**Karar:** `pnpm e2e` (`apps/api/e2e/`) platformu gerçek süreçlerle doğrular: boş veritabanına migration, API ve worker (tsx), sahte Trendyol (resmi yol/alan adları, Basic auth ve User-Agent kontrolü) ve ETag destekli sahte XML feed. Akış: kayıt/giriş → Trendyol doğrulama → içe aktarma → tedarikçi + eşleştirme → stok senkronu → batch sonucu → fiyat kuralı + kur → onay kuyruğu → hata/uyarı → 304 → güvenlik freni → siparişler (T.C. kimlik no yok) → webhook → acil durdurma → tenant izolasyonu → loglarda sır yok → SIGTERM ile temiz kapanış. CI'da her push'ta çalışır.
**Test yönlendirmeleri:** `TRENDYOL_BASE_URL` ve `FEED_ALLOW_PRIVATE_NETWORK` yalnızca geliştirme/test içindir; `NODE_ENV=production` iken `loadEnv` reddeder. Kontrol `envSchema` üzerinde değil `loadEnv`'dedir: şema düz nesne kalmalı (migration CLI `.pick()` kullanıyor; zod 4 refinement'lı şemada `.pick()` hata verir — e2e yakaladı).
**Bulunan ve düzeltilen hatalar:**

- Fiyat kurallarını yönetecek API/ekran yoktu; fiyat senkronu fiilen kullanılamıyordu → `/pricing-rules` + Fiyat Kuralları ekranı (senkronla aynı motorla canlı önizleme).
- Yeni tedarikçide ilk çekim zamanlamayı bekliyordu (eşleştirme ekranı boş kalıyordu) → oluşturulunca hemen kuyruğa eklenir.
- Veritabanı hata logları sorgu parametrelerini (e-posta, parola özeti) içeriyordu → `redact` sorgu hatalarında `params` alanını ve mesaj/stack'teki `params:` satırını maskeler.
- Şifre içeren formlar JavaScript yüklenmeden gönderilirse değerler URL'ye (GET) düşüyordu → `method="post"`.
- Kurulum kılavuzundaki ufw adımı özel SSH portlu sunucuda erişimi kesebilirdi → `deploy/bootstrap.sh` mevcut SSH portunu korur.

**Süreç sağlamlığı:** API ve worker'da yakalanmamış hata/promise reddinde loglayıp kontrollü çıkış (Docker yeniden başlatır), kapanışa süre sınırı (API 25 sn, worker 50 sn; compose `stop_grace_period` 60 sn), zamanlayıcı turları üst üste binmez, veritabanı havuzunda bağlantı/boşta/ömür zaman aşımları, Trendyol'dan JSON olmayan 2xx yanıt (bakım sayfası) geçici hata sayılıp tekrar denenir.
