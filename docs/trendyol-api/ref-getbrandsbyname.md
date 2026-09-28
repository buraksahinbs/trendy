<!-- indirildi: 2026-09-28 — https://developers.trendyol.com/reference/getbrandsbyname.md -->

---
updatedAt: 2026-06-09T08:58:38.000Z
---

Fetch the complete documentation index at: https://developers.trendyol.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Marka Arama (getBrandsByName)

İsme göre marka arama. BÜYÜK/küçük harf ayrımına dikkat edilmelidir.

# OpenAPI definition

```json
{
  "openapi": "3.0.3",
  "x-owner-team": "spm-core",
  "x-readme": {
    "proxy-enabled": false
  },
  "info": {
    "title": "Trendyol Marketplace - Ürün Entegrasyonu API",
    "description": "Trendyol Marketplace ürün entegrasyonu API servisleri. Ürün yaratma (V2), filtreleme, güncelleme, silme, arşivleme, stok-fiyat güncelleme, buybox, kilit kaldırma ve toplu işlem kontrolü servislerini kapsar.\n",
    "version": "2.0.0",
    "contact": {
      "name": "Trendyol Entegrasyon Destek",
      "email": "entegrasyon@trendyol.com"
    }
  },
  "x-domain-key": "marketplace-product",
  "servers": [
    {
      "url": "https://apigw.trendyol.com/integration",
      "description": "Canlı Ortam"
    },
    {
      "url": "https://stageapigw.trendyol.com/integration",
      "description": "Test Ortamı"
    }
  ],
  "tags": [
    {
      "name": "Brands",
      "description": "Marka listeleme servisleri",
      "x-module-key": "brands"
    }
  ],
  "paths": {
    "/product/brands/by-name": {
      "get": {
        "tags": [
          "Brands"
        ],
        "x-module-key": "brands",
        "summary": "Marka Arama (getBrandsByName)",
        "description": "İsme göre marka arama. BÜYÜK/küçük harf ayrımına dikkat edilmelidir.",
        "operationId": "getBrandsByName",
        "parameters": [
          {
            "name": "name",
            "in": "query",
            "required": true,
            "description": "Aranacak marka adı (büyük/küçük harf duyarlı)",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Başarılı",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/Brand"
                  }
                },
                "example": [
                  {
                    "id": 40,
                    "name": "TRENDYOLMİLLA"
                  }
                ]
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "basicAuth": {
        "type": "http",
        "scheme": "basic",
        "description": "Basic Auth ile Satıcı API Key ve API Secret"
      }
    },
    "responses": {
      "Unauthorized": {
        "description": "supplierID, API Key veya API Secure Key bilgilerinden birisi eksik/yanlış."
      }
    },
    "schemas": {
      "Brand": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "name": {
            "type": "string"
          }
        }
      }
    }
  },
  "security": [
    {
      "basicAuth": []
    }
  ]
}
```