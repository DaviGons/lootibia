import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api/discord (ver abaixo)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     *
     * `api/discord` PRECISA ficar de fora, e não é preferência: o proxy redireciona
     * quem não tem sessão para /auth/login, e o Discord não manda cookie nenhum.
     * Com ele no matcher, toda interação levava 307 e o bot nunca respondia —
     * falha silenciosa, porque o Discord só mostra "a aplicação não respondeu".
     *
     * Quem autentica aquele endpoint é a assinatura Ed25519 (diretriz 36), não o
     * cookie. De quebra, some uma ida ao Supabase por interação — e esse tempo sai
     * direto da janela de 3 s.
     */
    "/((?!api/discord|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
