import { NextResponse, type NextRequest } from "next/server";

// Hızlı ön kontrol: oturum cookie'si hiç yoksa panel sayfası render edilmeden girişe
// yönlendirilir. Asıl doğrulama API'dedir (/auth/me); süresi dolmuş cookie'yi panel yakalar.
const SESSION_COOKIES = ["trendy_session", "__Host-trendy_session"];

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/giris";
  url.search = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // API, statik dosyalar ve giriş/kayıt sayfaları hariç her şey
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|giris|kayit).*)"],
};
